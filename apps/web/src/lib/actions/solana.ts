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
} from "@solana/spl-token";

export type PayAsset = "SOL" | "USDC";

// Circle USDC mint on Solana mainnet (override for devnet via env).
export const USDC_MINT =
  process.env.SOLANA_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

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
      if (Number.isFinite(price) && price > 0) {
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

function merchantWallet(): PublicKey {
  const configured = process.env.MERCHANT_SOLANA_WALLET;
  // Fall back to a well-known valid base58 address for demos (System Program).
  return new PublicKey(configured || "11111111111111111111111111111111");
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
    const mint = new PublicKey(USDC_MINT);
    const payerAta = getAssociatedTokenAddressSync(mint, payer);
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant, true);
    // Create the merchant's token account if it doesn't exist yet (idempotent —
    // a no-op when already present). Payer funds the rent. Omitting this is the
    // classic reason SPL-token Blinks fail on first payment to a fresh account.
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer, merchantAta, merchant, mint)
    );
    const amount = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
    const feeAmount = fee ? (amount * BigInt(fee.bps)) / 10_000n : 0n;
    // transferChecked validates mint + decimals on-chain (safer than transfer).
    tx.add(
      createTransferCheckedInstruction(
        payerAta,
        mint,
        merchantAta,
        payer,
        amount - feeAmount,
        USDC_DECIMALS
      )
    );
    if (fee && feeAmount > 0n) {
      const feeAta = getAssociatedTokenAddressSync(mint, fee.wallet, true);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(payer, feeAta, fee.wallet, mint)
      );
      tx.add(
        createTransferCheckedInstruction(payerAta, mint, feeAta, payer, feeAmount, USDC_DECIMALS)
      );
    }
  }

  tx.feePayer = payer;
  tx.recentBlockhash = PLACEHOLDER_BLOCKHASH;
  return tx;
}
