// Where each chain's FurlPayRouter is configured. Dependency-free so the web
// app, scripts/check-merchant-env.mts and tests share one convention.
//
// The EIP-712 domain (chainId + verifyingContract) is per chain: a signature
// made for one chain's router can never execute on another's.
export const ROUTER_CHAINS = ["arbitrum", "arc", "base", "polygon"] as const;
export type RouterChain = typeof ROUTER_CHAINS[number];

export function routerEnvName(chain: RouterChain): string {
  return `FURLPAY_ROUTER_ADDRESS_${chain.toUpperCase()}`;
}
/** The configured router for a chain, or null. FURLPAY_ROUTER_ADDRESS is the
 *  Arbitrum router only (its historical meaning); it is never assumed to exist
 *  at the same address on another chain. */
export function configuredRouter(chain: RouterChain, env: Record<string, string | undefined> = process.env): string | null {
  const v = (env[routerEnvName(chain)] || (chain === "arbitrum" ? env.FURLPAY_ROUTER_ADDRESS : "") || "").trim();
  return v || null;
}
