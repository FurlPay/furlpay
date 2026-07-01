import { Chain } from "@furlpay/types";

// ---------------------------------------------------------------------------
// Circle CCTP V2 adapter (canonical since 2025; V1 phased out July 31 2026).
// Native 1:1 burn-and-mint for USDC — no liquidity pools or fillers. Supports:
//   - Fast Transfer: sub-30s settlement (attest before hard finality) for a
//     small USDC fee, vs standard (~13-19 min, no fee).
//   - Hooks: depositForBurnWithHook() runs a call on the destination chain
//     atomically with the mint (mint-and-swap in one tx).
// LIVE: TokenMessengerV2.depositForBurn / depositForBurnWithHook + Iris attest.
// MOCK: returns a plausible quote for supported chains.
// ---------------------------------------------------------------------------

// CCTP V2 mainnet chains (subset overlapping Furlpay's Chain union).
const CCTP_CHAINS: Chain[] = ["ethereum", "base", "arbitrum", "polygon", "solana"];

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
