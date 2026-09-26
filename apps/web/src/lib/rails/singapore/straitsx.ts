import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { IntegrationNotConfiguredError } from "@/lib/integrations";

/**
 * Hard stop for the mock-only seams in this file.
 *
 * Deliberately stronger than `requireLive()`: that helper permits a seam to
 * run when INTEGRATION_MODE=live, which is correct for a seam that HAS a live
 * path. Nothing here has one, so INTEGRATION_MODE=live must not be able to
 * unlock a fabricated quote or a fabricated payout. Mirrors the hard stop in
 * services/payments.ts settle().
 */
function refuseInProduction(feature: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new IntegrationNotConfiguredError(`${feature} (no live StraitsX implementation exists)`);
  }
}

// ---------------------------------------------------------------------------
// StraitsX Singapore Stablecoin Rails (XSGD & XUSD) & FAST / PayNow Bridge
//
// StraitsX (Xfers Pte Ltd) is a Major Payment Institution licensed by the
// Monetary Authority of Singapore (MAS). XSGD and XUSD are fully reserved,
// 1:1 fiat-pegged stablecoins recognized under MAS's Single-Currency Stablecoin
// (SCS) regulatory framework.
//
// Mint addresses below were VERIFIED against Solana mainnet via getAccountInfo
// (2026-09-17), not copied from a document: both are initialized SPL mints with
// 6 decimals sharing StraitsX's mint/freeze authority
// CrtdStZqGrcqrpDZ5XnmaEKvzyBNLgq6uvNKCokFgo6v. Re-verify before trusting them
// in a settlement path — an issuer can migrate a mint.
//
// DECIMALS ARE 6, not 18. Writing an amount at the wrong scale is how a
// SGD 1.00 transfer becomes SGD 1,000,000.
//
// === STATUS: NO LIVE IMPLEMENTATION ===
// Nothing in this file talks to StraitsX. The quote and payout functions below
// are MOCKS, and per the repo convention in lib/integrations.ts a seam whose
// only implementation is a mock must hard-stop in production rather than
// fabricate a settlement. They now do. Before this can move money it needs:
//   - a StraitsX API credential registered in env.ts + .env.example
//   - a real quote call (the FX rate here is a placeholder, not a market rate)
//   - a real payout call with idempotency keys and webhook reconciliation
//
// Security invariants strictly enforced per AGENTS.md:
// - Zod body validation on all operations
// - Solana addresses validated via new PublicKey() in try/catch
// - EVM addresses validated against /^0x[0-9a-fA-F]{40}$/
// - Money amounts positive with upper bounds
// - Secure random values via crypto.randomUUID()
// ---------------------------------------------------------------------------

export const SOLANA_XSGD_MINT = "71S9cppWipeUEQDFngYwxjoxB6Sz1MUqX72byLsVYJqy";
export const SOLANA_XUSD_MINT = "4UbvZiomFvXDnZSz6vdHiDNiHozH2ykTEqjhhbVHiv9z";

/** On-chain decimals for both XSGD and XUSD, read from the mint accounts. */
export const XSGD_DECIMALS = 6;
export const XUSD_DECIMALS = 6;

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export const StraitsXQuoteSchema = z.object({
  sourceAsset: z.enum(["SGD", "USD", "XSGD", "XUSD", "USDC"]),
  destAsset: z.enum(["SGD", "USD", "XSGD", "XUSD", "USDC"]),
  amount: z.number().positive().max(1_000_000, "Maximum transaction amount is $1,000,000"),
  network: z.enum(["solana", "base", "ethereum", "fast"]).default("solana"),
});

export type StraitsXQuoteRequest = z.infer<typeof StraitsXQuoteSchema>;

export interface StraitsXQuoteResponse {
  quoteId: string;
  sourceAsset: string;
  destAsset: string;
  amountIn: number;
  amountOut: number;
  fxRate: number;
  feeBps: number;
  network: string;
  expiresAt: string;
}

export const StraitsXPayoutSchema = z.object({
  uenOrMobile: z.string().min(8).max(20),
  recipientName: z.string().min(1).max(100),
  amountSgd: z.number().positive().max(200_000, "Per-FAST transaction ceiling is SGD 200,000"),
  paymentReference: z.string().max(35).optional(),
  userSafeAddress: z.string().regex(EVM_ADDRESS_REGEX, "Invalid EVM Safe smart account address"),
});

export type StraitsXPayoutRequest = z.infer<typeof StraitsXPayoutSchema>;

export interface StraitsXPayoutResult {
  payoutId: string;
  clearingRail: "FAST" | "PAYNOW";
  recipient: string;
  amountSgd: number;
  status: "submitted" | "processing" | "settled";
  timestamp: string;
}

/**
 * Validates externally supplied Solana addresses safely.
 * Returns true if valid, false otherwise.
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * MOCK quote between SGD, XSGD, USD, and USDC.
 *
 * This does NOT evaluate StraitsX liquidity or DEX spreads — it applies a
 * hardcoded placeholder rate. It is useful for wiring up UI in dev and
 * previews, and it throws in production, because a made-up FX rate shown to a
 * user as a quote is worse than an outage: they can act on it.
 */
export async function getStraitsXQuote(req: StraitsXQuoteRequest): Promise<StraitsXQuoteResponse> {
  refuseInProduction("StraitsX FX quoting");
  const validated = StraitsXQuoteSchema.parse(req);

  // PLACEHOLDER rate, not a market observation. Roughly the 2026 USD/SGD area
  // so dev screens render sane numbers; it is stale the moment it is written.
  let fxRate = 1.0;
  if ((validated.sourceAsset === "USD" || validated.sourceAsset === "USDC" || validated.sourceAsset === "XUSD") && 
      (validated.destAsset === "SGD" || validated.destAsset === "XSGD")) {
    fxRate = 1.3425; // 1 USD = 1.3425 SGD
  } else if ((validated.sourceAsset === "SGD" || validated.sourceAsset === "XSGD") && 
             (validated.destAsset === "USD" || validated.destAsset === "USDC" || validated.destAsset === "XUSD")) {
    fxRate = 0.7448; // 1 SGD = 0.7448 USD
  }

  const feeBps = 15; // Placeholder margin — not a negotiated StraitsX rate card.
  const grossAmountOut = validated.amount * fxRate;
  const netAmountOut = grossAmountOut * (1 - feeBps / 10000);

  return {
    quoteId: `quote_sx_${crypto.randomUUID()}`,
    sourceAsset: validated.sourceAsset,
    destAsset: validated.destAsset,
    amountIn: validated.amount,
    amountOut: Number(netAmountOut.toFixed(4)),
    fxRate,
    feeBps,
    network: validated.network,
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(), // 60-second quote freeze
  };
}

/**
 * MOCK payout. Dispatches nothing.
 *
 * The previous version of this function returned `status: "submitted"` with a
 * freshly minted payout id while contacting no API at all — a caller, a
 * reconciliation job, or a user would all read that as "the SGD is on its
 * way". It now refuses to run in production. When the live StraitsX call is
 * implemented it needs an idempotency key derived from the caller's request,
 * not a fresh UUID per invocation, or a retry pays the recipient twice.
 */
export async function executeStraitsXFastPayout(
  req: StraitsXPayoutRequest
): Promise<StraitsXPayoutResult> {
  refuseInProduction("StraitsX FAST/PayNow payouts");
  const validated = StraitsXPayoutSchema.parse(req);

  return {
    payoutId: `payout_fast_${crypto.randomUUID()}`,
    clearingRail: validated.uenOrMobile.includes("-") || validated.uenOrMobile.length > 9 ? "PAYNOW" : "FAST",
    recipient: validated.recipientName,
    amountSgd: validated.amountSgd,
    status: "submitted",
    timestamp: new Date().toISOString(),
  };
}
