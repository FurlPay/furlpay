// ---------------------------------------------------------------------------
// Server-side money-movement caps for the REAL execution rails (Li.Fi swaps,
// CCTP transfers). UI limits are advisory; these are the enforcement point.
// Conservative launch defaults, raised per-rail via env as volume/monitoring
// mature. x402 per-call pricing and the agent-spend control plane cover the
// x402 rail's budgets separately (lib/agentPolicy.ts).
// ---------------------------------------------------------------------------

function envCap(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Max single Li.Fi swap, in USD notional. */
export function maxSwapUsd(): number {
  return envCap("FURLPAY_MAX_SWAP_USD", 500);
}

/** Max single CCTP burn, in USDC. */
export function maxCctpUsd(): number {
  return envCap("FURLPAY_MAX_CCTP_USD", 500);
}

/** Max single gasless (relayed EIP-3009) transfer, in USDC. */
export function maxTransferUsd(): number {
  return envCap("FURLPAY_MAX_TRANSFER_USD", 500);
}

export function capExceeded(kind: "swap" | "cctp", amountUsd: number): { error: string; capUsd: number } | null {
  const cap = kind === "swap" ? maxSwapUsd() : maxCctpUsd();
  if (amountUsd <= cap) return null;
  return { error: `amount exceeds the per-transaction limit ($${cap})`, capUsd: cap };
}
