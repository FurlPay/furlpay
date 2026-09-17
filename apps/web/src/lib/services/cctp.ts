import { Chain } from "@furlpay/types";

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
// MOCK: returns a plausible quote for supported chains.
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
  etaSeconds: number;
  hook?: string;
  native: true;
}

export function quoteCctp(params: {
  fromChain: Chain;
  toChain: Chain;
  amount: number;
  fast?: boolean;
  hook?: string;
}): CctpQuote {
  const { fromChain, toChain, amount, fast = true, hook } = params;
  if (!isCctpSupported(fromChain) || !isCctpSupported(toChain)) {
    throw new Error(`CCTP V2 not supported for ${fromChain} -> ${toChain}`);
  }
  // Fast Transfer charges a small USDC fee (~1bps here) for faster-than-finality.
  const feeUsd = fast ? round(amount * 0.0001) : 0;
  return {
    rail: "cctp-v2",
    token: "USDC",
    fromChain,
    toChain,
    amountIn: amount,
    amountOut: round(amount - feeUsd),
    mode: fast ? "fast" : "standard",
    feeUsd,
    etaSeconds: fast ? 20 : 900,
    hook,
    native: true,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
