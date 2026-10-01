// ---------------------------------------------------------------------------
// Solana Actions / Blinks — transaction builder.
//
// Follows the Solana Actions spec (solana.com/developers/guides/advanced/actions):
// the API returns a base64-serialized transaction that a Blink client decodes,
// re-signs and submits. Per spec, clients IGNORE and replace `feePayer` and
// `recentBlockhash` on an unsigned transaction, so we can produce a fully
// spec-correct payload WITHOUT a live RPC round-trip — keeping this consistent
// with the app's mock-mode (runnable with zero credentials). Set SOLANA_RPC_URL
// / MERCHANT_SOLANA_WALLET to point at real infrastructure.
// ---------------------------------------------------------------------------

import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { FURL_MINT, FURL_DECIMALS, assertFurlMint } from "@/lib/token/furl";

export type PayAsset = "SOL" | "USDC" | "FURL";

// Circle USDC mint on Solana mainnet (override for devnet via env).
export const USDC_MINT =
  process.env.SOLANA_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

/**
 * FURL/USD price for the FURL payment path. FURL has NO oracle and NO
 * established market yet, so — unlike SOL (Pyth) — there is no honest fallback.
 * This FAILS CLOSED: FURL checkout is only possible once FURL_USD_PRICE is set
 * to a real, defensible price (e.g. sourced from a live DEX pool). We never
 * invent a rate. `furlPaymentsEnabled()` gates the UI so no broken option shows.
 */
/** Sanity bounds for a configured FURL price, in USD per FURL.
 *
 *  AGENTS.md rule 8 requires bounds on every price that sizes a transfer, and
 *  this one is riskier than the SOL oracle because it is a hand-set env var: a
 *  fat-fingered `0.0000000001` turns a $25 order into 250 billion FURL, which
 *  overflows u64 and is a transaction that either fails or moves an absurd
 *  amount. A typo'd price is rejected rather than scaled. */
const FURL_PRICE_MIN_USD = 0.000001; // $0.000001 — below this, $25 exceeds supply
const FURL_PRICE_MAX_USD = 1_000_000; // a FURL worth more than $1M is a typo

export function furlUsdPrice(): number {
  const raw = process.env.FURL_USD_PRICE;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      "FURL payments are not enabled: set FURL_USD_PRICE to a real price " +
        "(FURL has no on-chain peg/oracle; no rate is assumed).",
    );
  }
  if (n < FURL_PRICE_MIN_USD || n > FURL_PRICE_MAX_USD) {
    throw new Error(
      `FURL_USD_PRICE=${n} is outside the sane range ` +
        `[${FURL_PRICE_MIN_USD}, ${FURL_PRICE_MAX_USD}] — refusing to size a transfer from it.`,
    );
  }
  return n;
}

export function furlPaymentsEnabled(): boolean {
  const n = Number(process.env.FURL_USD_PRICE);
  return Number.isFinite(n) && n >= FURL_PRICE_MIN_USD && n <= FURL_PRICE_MAX_USD;
}

/** u64 ceiling. Every SPL amount is a u64 on-chain; a bigint above this cannot
 *  be encoded and the instruction builder would throw or truncate. */
const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * USD amount → token base units, with the overflow and precision traps closed.
 *
 * The old expression was `BigInt(Math.round(amountUsd / unitUsd * 10 ** decimals))`.
 * Three problems, all reachable from a configured price rather than from an
 * attacker: (1) `x * 1e6` on a float introduces error before rounding, (2) the
 * product can exceed Number.MAX_SAFE_INTEGER, where `Math.round` is a no-op on
 * an already-imprecise value, and (3) nothing checked the result against u64, so
 * a small price produced an amount that cannot exist.
 *
 * Here the division happens once in float (the inputs ARE floats), is then
 * pinned to the token's precision via `toFixed` — a decimal string, not a scaled
 * float — and parsed as an integer. Bounds are asserted afterwards.
 */
export function usdToTokenBaseUnits(
  amountUsd: number,
  unitUsd: number,
  decimals: number,
): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error(`Invalid payment amount: ${amountUsd}`);
  }
  if (!Number.isFinite(unitUsd) || unitUsd <= 0) {
    throw new Error(`Invalid unit price: ${unitUsd}`);
  }
  const tokens = amountUsd / unitUsd;
  if (!Number.isFinite(tokens)) {
    throw new Error("Payment amount overflowed while converting to token units");
  }
  // Range-check BEFORE formatting. `toFixed` switches to exponential notation
  // at 1e21 ("1e+24"), and `BigInt("1e+24")` throws an opaque conversion error
  // instead of the bounds error the caller can act on. Checked against the u64
  // ceiling expressed in whole tokens, so the limit follows `decimals`.
  const maxWholeTokens = Number(U64_MAX / 10n ** BigInt(decimals));
  if (tokens > maxWholeTokens) {
    throw new Error(
      `Payment of $${amountUsd} at a unit price of $${unitUsd} is ${tokens} tokens, ` +
        `which exceeds the u64 maximum for an SPL transfer (${maxWholeTokens} at ${decimals} decimals)`,
    );
  }
  // toFixed(decimals) rounds half-up at the token's own precision; splitting on
  // the decimal point keeps the integer conversion exact.
  const [whole, frac = ""] = tokens.toFixed(decimals).split(".");
  const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  if (base <= 0n) {
    throw new Error(
      `Payment of $${amountUsd} rounds to 0 token units at ${decimals} decimals — refusing to build a no-op transfer.`,
    );
  }
  if (base > U64_MAX) {
    throw new Error(`Payment amount ${base} exceeds the u64 maximum for an SPL transfer`);
  }
  return base;
}

// A syntactically valid throwaway blockhash. Clients replace it on unsigned
// transactions, so no getLatestBlockhash() call is required to serialize.
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

// SOL/USD price for the SOL payment path. LIVE: Pyth Hermes (free REST oracle),
// cached for 30s per instance. Falls back to SOLANA_SOL_USD_PRICE, then a
// last-resort constant, so a Hermes outage degrades rather than blocking pay.
const PYTH_SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const PRICE_TTL_MS = 30_000;
let priceCache: { price: number; at: number } | null = null;

export async function solUsdPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.price;
  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SOL_USD_FEED}`,
      { signal: AbortSignal.timeout(3_000), cache: "no-store" }
    );
    if (res.ok) {
      const p = (await res.json())?.parsed?.[0]?.price;
      const price = Number(p?.price) * 10 ** Number(p?.expo);
      // Sanity bounds: SOL outside $1–$2000 indicates a stale, buggy, or
      // manipulated feed — fall through to static fallback instead.
      if (Number.isFinite(price) && price > 1 && price < 2000) {
        priceCache = { price, at: Date.now() };
        return price;
      }
    }
  } catch {
    // fall through to the static fallbacks
  }
  // A stale oracle read beats a hardcoded constant — reuse past-TTL cache first.
  if (priceCache) return priceCache.price;
  return Number(process.env.SOLANA_SOL_USD_PRICE || "150");
}

/** No merchant treasury is configured: there is nowhere correct to send funds. */
export class MerchantWalletNotConfiguredError extends Error {
  constructor() {
    super("MERCHANT_SOLANA_WALLET is not configured; payment transactions are not offered.");
    this.name = "MerchantWalletNotConfiguredError";
  }
}

// Fails closed. This used to fall back to the System Program address
// (1111…1111) "for demos". These are mainnet USDC/SOL transfers that a real
// wallet signs, and nobody holds a key for the System Program, so a payment
// built without a configured treasury was unrecoverable for the payer.
function merchantWallet(): PublicKey {
  const configured = process.env.MERCHANT_SOLANA_WALLET?.trim();
  if (!configured) throw new MerchantWalletNotConfiguredError();
  const pk = new PublicKey(configured);
  if (pk.equals(SystemProgram.programId)) throw new MerchantWalletNotConfiguredError();
  return pk;
}

// Platform fee split (Stripe-style take rate). Env-gated: PLATFORM_FEE_BPS
// basis points of every checkout are routed to PLATFORM_FEE_SOLANA_WALLET as a
// second transfer in the same atomic transaction. Zero/unset BPS, no fee
// wallet, or fee wallet == merchant (first-party checkout, split is a no-op)
// all disable it — today FurlPay is its own merchant, so this stays dormant
// until third-party merchants settle through these rails.
function platformFee(): { wallet: PublicKey; bps: number } | null {
  const bps = Number(process.env.PLATFORM_FEE_BPS);
  const wallet = process.env.PLATFORM_FEE_SOLANA_WALLET;
  if (!wallet || !Number.isFinite(bps) || bps <= 0 || bps > 1000) return null;
  const pk = new PublicKey(wallet);
  return pk.equals(merchantWallet()) ? null : { wallet: pk, bps };
}

// ---------------------------------------------------------------------------
// Mock order book. A live deployment resolves the order from the ledger/DB.
// ---------------------------------------------------------------------------
export interface Order {
  orderId: string;
  amountUsd: number;
  currency: string;
}

export function getOrder(orderId: string): Order {
  return { orderId, amountUsd: 25, currency: "USD" };
}

/**
 * Build an unsigned SOL or USDC transfer transaction for `amountUsd` from the
 * paying `payer` to the merchant treasury. Amounts are always expressed in USD;
 * the SOL path converts via the current SOL/USD price.
 */
export async function buildPaymentTransaction(opts: {
  payer: PublicKey;
  amountUsd: number;
  asset: PayAsset;
}): Promise<Transaction> {
  const { payer, amountUsd, asset } = opts;
  const merchant = merchantWallet();
  const fee = platformFee();
  const tx = new Transaction();

  if (asset === "SOL") {
    const lamports = Math.round((amountUsd / (await solUsdPrice())) * LAMPORTS_PER_SOL);
    // Integer split: merchant gets the remainder so the two legs always sum
    // to the quoted total; a fee that rounds to 0 lamports is skipped.
    const feeLamports = fee ? Math.floor((lamports * fee.bps) / 10_000) : 0;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: merchant,
        lamports: lamports - feeLamports,
      })
    );
    if (fee && feeLamports > 0) {
      tx.add(
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: fee.wallet, lamports: feeLamports })
      );
    }
  } else {
    // SPL-token path, parameterised by mint/program/decimals so USDC (legacy
    // SPL) and FURL (Token-2022) share one correct implementation.
    const isFurl = asset === "FURL";
    // Defence in depth: FURL_MINT is a constant, but this is the last line
    // before real value is addressed to a mint, and a wrong mint here is an
    // unrecoverable transfer. assertFurlMint costs one string compare.
    if (isFurl) assertFurlMint(FURL_MINT);
    const mint = new PublicKey(isFurl ? FURL_MINT : USDC_MINT);
    const programId = isFurl ? TOKEN_2022_PROGRAM_ID : undefined;
    const decimals = isFurl ? FURL_DECIMALS : USDC_DECIMALS;
    // USDC is quoted 1:1 with USD; FURL converts via its (fail-closed) price.
    const unitUsd = isFurl ? furlUsdPrice() : 1;

    const ataOf = (owner: PublicKey, allowOffCurve = false) =>
      getAssociatedTokenAddressSync(mint, owner, allowOffCurve, programId);

    const payerAta = ataOf(payer);
    const merchantAta = ataOf(merchant, true);
    // Create the merchant's token account if it doesn't exist yet (idempotent —
    // a no-op when already present). Payer funds the rent. Omitting this is the
    // classic reason SPL-token Blinks fail on first payment to a fresh account.
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer, merchantAta, merchant, mint, programId)
    );
    // token units = USD amount / unit price, scaled by decimals — bounds-checked
    // against u64 and against rounding to zero (see usdToTokenBaseUnits).
    const amount = usdToTokenBaseUnits(amountUsd, unitUsd, decimals);
    const feeAmount = fee ? (amount * BigInt(fee.bps)) / 10_000n : 0n;
    // transferChecked validates mint + decimals on-chain (safer than transfer).
    tx.add(
      createTransferCheckedInstruction(
        payerAta, mint, merchantAta, payer, amount - feeAmount, decimals, [], programId
      )
    );
    if (fee && feeAmount > 0n) {
      const feeAta = ataOf(fee.wallet, true);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(payer, feeAta, fee.wallet, mint, programId)
      );
      tx.add(
        createTransferCheckedInstruction(payerAta, mint, feeAta, payer, feeAmount, decimals, [], programId)
      );
    }
  }

  tx.feePayer = payer;
  tx.recentBlockhash = PLACEHOLDER_BLOCKHASH;
  return tx;
}
