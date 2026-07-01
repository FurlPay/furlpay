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

// Mock SOL/USD price so the SOL path charges the correct *dollar* amount. A live
// deployment pulls this from a price oracle (Pyth) or an FX API.
export function solUsdPrice(): number {
  return Number(process.env.SOLANA_SOL_USD_PRICE || "150");
}

function merchantWallet(): PublicKey {
  const configured = process.env.MERCHANT_SOLANA_WALLET;
  // Fall back to a well-known valid base58 address for demos (System Program).
  return new PublicKey(configured || "11111111111111111111111111111111");
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
export function buildPaymentTransaction(opts: {
  payer: PublicKey;
  amountUsd: number;
  asset: PayAsset;
}): Transaction {
  const { payer, amountUsd, asset } = opts;
  const merchant = merchantWallet();
  const tx = new Transaction();

  if (asset === "SOL") {
    const lamports = Math.round((amountUsd / solUsdPrice()) * LAMPORTS_PER_SOL);
    tx.add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: merchant, lamports })
    );
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
    // transferChecked validates mint + decimals on-chain (safer than transfer).
    tx.add(
      createTransferCheckedInstruction(payerAta, mint, merchantAta, payer, amount, USDC_DECIMALS)
    );
  }

  tx.feePayer = payer;
  tx.recentBlockhash = PLACEHOLDER_BLOCKHASH;
  return tx;
}
