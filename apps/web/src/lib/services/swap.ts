import { Chain, Stablecoin } from "../types";

// ---------------------------------------------------------------------------
// Cross-chain swap / bridge routing (Blueprint §4.1, Playbook Gap 2).
// LIVE: Li.Fi / 1inch aggregation across Base, Solana, Arbitrum, Polygon.
// MOCK: returns a plausible best-route quote with L2-grade slippage & gas.
// ---------------------------------------------------------------------------

export interface SwapQuote {
  fromToken: Stablecoin;
  toToken: Stablecoin;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  route: string[];
  etaSeconds: number;
}

// Rough USD pegs for demo FX between stable denominations.
const USD_PEG: Record<Stablecoin, number> = {
  USDC: 1.0,
  USDT: 1.0,
  PYUSD: 1.0,
  DAI: 1.0,
  EURC: 1.09,
};

const CHEAPEST_CHAINS: Chain[] = ["solana", "base", "arbitrum"];

export function quoteSwap(params: {
  fromToken: Stablecoin;
  toToken: Stablecoin;
  fromChain: Chain;
  amountIn: number;
  toChain?: Chain;
}): SwapQuote {
  const { fromToken, toToken, fromChain, amountIn } = params;
  // Auto-select cheapest destination chain if the caller doesn't force one.
  const toChain = params.toChain ?? CHEAPEST_CHAINS[0];

  const slippagePct = 0.04; // <0.05% on L2 per playbook
  const gasUsd = 0.004;
  const usdIn = amountIn * USD_PEG[fromToken];
  const grossOut = usdIn / USD_PEG[toToken];
  const amountOut = grossOut * (1 - slippagePct / 100);

  const route =
    fromChain === toChain
      ? [`${fromToken}→${toToken} on ${fromChain}`]
      : [`${fromToken} on ${fromChain}`, `bridge → ${toChain}`, `→ ${toToken}`];

  return {
    fromToken,
    toToken,
    fromChain,
    toChain,
    amountIn,
    amountOut: round(amountOut),
    slippagePct,
    gasUsd,
    route,
    etaSeconds: fromChain === toChain ? 4 : 22,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
