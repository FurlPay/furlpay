import { Chain, Stablecoin } from "@furlpay/types";
import { isCctpSupported, quoteCctp } from "./cctp";
import { quoteSwap } from "./swap";

// ---------------------------------------------------------------------------
// Intent-based cross-chain router (2026 best practice: composition, not one
// bridge). The caller submits WHAT they want, not HOW:
//   "move 100 USDC from arbitrum to solana, settle within 30s, else fall back"
// The router picks the cheapest/fastest rail per token:
//   - USDC on CCTP-supported chains  -> Circle CCTP V2 (native burn-and-mint)
//   - everything else                -> Li.Fi aggregation (swap/bridge)
// ---------------------------------------------------------------------------

export interface Intent {
  fromToken: Stablecoin;
  toToken: Stablecoin;
  fromChain: Chain;
  toChain: Chain;
  amount: number;
  settleWithinSec?: number;
  fallbackToken?: Stablecoin;
}

export interface RoutePlan {
  rail: "cctp-v2" | "lifi";
  reason: string;
  amountIn: number;
  amountOut: number;
  feeUsd: number;
  etaSeconds: number;
  steps: string[];
  fallbackUsed: boolean;
}

export async function planIntent(intent: Intent): Promise<RoutePlan> {
  const { fromToken, toToken, fromChain, toChain, amount, settleWithinSec } = intent;

  // Native USDC path: same-token USDC across CCTP chains → CCTP V2.
  const cctpEligible =
    fromToken === "USDC" &&
    toToken === "USDC" &&
    isCctpSupported(fromChain) &&
    isCctpSupported(toChain);

  if (cctpEligible) {
    const fast = settleWithinSec === undefined || settleWithinSec <= 60;
    const q = await quoteCctp({ fromChain, toChain, amount, fast });
    return {
      rail: "cctp-v2",
      reason: `Native USDC via CCTP V2 (${q.mode}) — 1:1 burn-and-mint, no liquidity pools`,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      feeUsd: q.feeUsd,
      etaSeconds: q.etaSeconds,
      steps: [
        `burn ${amount} USDC on ${fromChain}`,
        "Circle Iris attestation",
        `mint ${q.amountOut} USDC on ${toChain}`,
      ],
      fallbackUsed: false,
    };
  }

  // Everything else → Li.Fi aggregation, with optional token fallback.
  let quote;
  let fallbackUsed = false;
  let effectiveToToken = toToken;
  try {
    quote = quoteSwap({ fromToken, toToken, fromChain, amountIn: amount, toChain });
  } catch (e) {
    if (!intent.fallbackToken) throw e;
    effectiveToToken = intent.fallbackToken;
    fallbackUsed = true;
    quote = quoteSwap({ fromToken, toToken: effectiveToToken, fromChain, amountIn: amount, toChain });
  }

  return {
    rail: "lifi",
    reason: `Multi-asset route via Li.Fi (${fromToken} → ${effectiveToToken})${fallbackUsed ? " using fallback token" : ""}`,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    feeUsd: quote.gasUsd,
    etaSeconds: quote.etaSeconds,
    steps: quote.route,
    fallbackUsed,
  };
}
