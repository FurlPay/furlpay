import { Chain } from "@furlpay/types";
import { bpsToAtomic, fetchCctpFee } from "./cctpFees";
import { CCTP_DOMAINS } from "./cctpExecution";

// ---------------------------------------------------------------------------
// Circle CCTP V2 adapter (canonical since 2025).
//
// V1 (Legacy) deprecation — verified against Circle's own migration notice,
// NOT the "July 31 2026" date this comment used to carry, which was wrong:
//   2026-10-31  burn limits reduced, V1 performance degrades over ~1 month
//   2026-12-01  V1 contracts PAUSED — any V1 integration stops transferring
// Nothing here points at V1, so the deadline is informational for us; it is
// recorded because a wrong date in a comment is how a migration gets deferred
// past the day the contracts stop.
// Native 1:1 burn-and-mint for USDC — no liquidity pools or fillers. Supports:
//   - Fast Transfer: sub-30s settlement (attest before hard finality) for a
//     small USDC fee, vs standard (~13-19 min, no fee).
//   - Hooks: depositForBurnWithHook() runs a call on the destination chain
//     atomically with the mint (mint-and-swap in one tx).
// LIVE: TokenMessengerV2.depositForBurn / depositForBurnWithHook + Iris attest.
//
// There is no mock mode here any more. Quotes are priced from Circle's own
// published per-corridor fee (lib/services/cctpFees.ts) and refuse to return a
// number when that cannot be read — the previous "plausible quote" was a flat
// 1bp guess that was wrong on most corridors and, worse, propagated into the
// on-chain maxFee ceiling.
// ---------------------------------------------------------------------------

// CCTP V2 chains we can QUOTE — which must stay equal to the chains we can
// EXECUTE (`CCTP_DOMAINS` in cctpExecution.ts). These two lists drifting apart
// is not a cosmetic bug: `intentRouter.planIntent()` picks a rail off
// `isCctpSupported()`, so a chain quoted here but missing there gets planned,
// priced and promised at a 20s ETA, then refused by /api/intents/cctp — and it
// never falls back to Li.Fi the way a genuinely unsupported pair would.
//
// Solana is the case that was wrong: Circle does support it (CCTP domain 5,
// live on V2), but our burn leg is `encodeFunctionData` against an EVM
// TokenMessengerV2, and Solana needs a program call instead. Quoting it was
// therefore a promise we could not keep. Add it back to BOTH lists in the same
// commit that lands the SVM burn/mint path.
const CCTP_CHAINS: Chain[] = ["ethereum", "base", "arbitrum", "polygon"];

export function isCctpSupported(chain: Chain): boolean {
  return CCTP_CHAINS.includes(chain);
}

export interface CctpQuote {
  rail: "cctp-v2";
  token: "USDC";
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  amountOut: number;
  mode: "fast" | "standard";
  feeUsd: number;
  /** The rate this quote was priced at, as published by Circle. Surfaced so a
   *  receipt can show WHY the fee is what it is, and so a stale quote is
   *  recognisable rather than merely wrong. */
  feeBps: number;
  etaSeconds: number;
  hook?: string;
  native: true;
}

/**
 * Price a CCTP V2 transfer at Circle's ACTUAL published fee for the corridor.
 *
 * Async and able to throw, both deliberately. This used to return a flat
 * `amount * 0.0001` — a guessed 1bp — which was wrong on most corridors
 * (arbitrum->base is 1.4bps, polygon->base is free) and, because
 * buildBurnBundle derived its on-chain `maxFee` ceiling from the same guess,
 * quietly demoted Fast Transfers to the ~15-minute standard path on any
 * corridor priced above 1bp.
 *
 * If the fee cannot be read, this throws `CctpFeeUnavailableError` rather than
 * assuming one. See lib/services/cctpFees.ts.
 */
export async function quoteCctp(params: {
  fromChain: Chain;
  toChain: Chain;
  amount: number;
  fast?: boolean;
  hook?: string;
  signal?: AbortSignal;
}): Promise<CctpQuote> {
  const { fromChain, toChain, amount, fast = true, hook, signal } = params;
  if (!isCctpSupported(fromChain) || !isCctpSupported(toChain)) {
    throw new Error(`CCTP V2 not supported for ${fromChain} -> ${toChain}`);
  }
  const srcDomain = CCTP_DOMAINS[fromChain];
  const dstDomain = CCTP_DOMAINS[toChain];
  if (srcDomain === undefined || dstDomain === undefined) {
    // Unreachable while CCTP_CHAINS == CCTP_DOMAINS (railAdvertising.spec.ts
    // enforces that), kept so the two drifting apart throws here rather than
    // reaching Iris with an undefined domain in the URL.
    throw new Error(`CCTP V2 not supported for ${fromChain} -> ${toChain}`);
  }
  const fee = await fetchCctpFee(srcDomain, dstDomain, { signal });
  const feeBps = fast ? fee.fastBps : fee.standardBps;
  // Round the charge UP at USDC precision so the quote never promises a
  // cheaper transfer than the burn will actually take.
  const feeUsd = feeBps <= 0 ? 0 : Number(bpsToAtomic(BigInt(Math.round(amount * 1e6)), feeBps)) / 1e6;
  return {
    rail: "cctp-v2",
    token: "USDC",
    fromChain,
    toChain,
    amountIn: amount,
    amountOut: round(amount - feeUsd),
    mode: fast ? "fast" : "standard",
    feeUsd,
    feeBps,
    etaSeconds: fast ? 20 : 900,
    hook,
    native: true,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
