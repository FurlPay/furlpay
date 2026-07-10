import { fallback, http, type Chain, type Transport } from "viem";
import { arbitrum, arbitrumSepolia, base, baseSepolia, polygon, mainnet } from "viem/chains";

// ---------------------------------------------------------------------------
// Shared EVM chain + RPC transport config for the x402 stack. Split out of
// x402Settler so the signature verifier (ERC-1271 path) can build read
// clients without importing the settler (which imports the signature module —
// a cycle otherwise).
//
// Per network: primary RPC from `<NETWORK>_RPC_URL`, optional secondary from
// `<NETWORK>_RPC_URL_FALLBACK`. With both set, viem's fallback transport
// fails over automatically when the primary errors or rate-limits — an RPC
// outage degrades to the fallback provider instead of refusing settlements.
// With neither set, the chain's public default RPC is used (dev only; public
// RPCs rate-limit).
// ---------------------------------------------------------------------------

export const EVM_CHAINS: Record<string, Chain> = {
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  base,
  "base-sepolia": baseSepolia,
  polygon,
  ethereum: mainnet,
};

const RPC_ENV_PREFIX: Record<string, string> = {
  arbitrum: "ARBITRUM",
  "arbitrum-sepolia": "ARBITRUM_SEPOLIA",
  base: "BASE",
  "base-sepolia": "BASE_SEPOLIA",
  polygon: "POLYGON",
  ethereum: "ETHEREUM",
};

/** Primary per-network RPC override, else undefined (caller uses the chain's
 *  public default). */
export function rpcUrl(network: string): string | undefined {
  const prefix = RPC_ENV_PREFIX[network];
  return prefix ? process.env[`${prefix}_RPC_URL`] : undefined;
}

/** Transport for a network: fallback(primary, secondary) when a fallback URL
 *  is configured, plain http(primary) otherwise, public default as last resort. */
export function rpcTransport(network: string): Transport {
  const prefix = RPC_ENV_PREFIX[network];
  const primary = prefix ? process.env[`${prefix}_RPC_URL`] : undefined;
  const secondary = prefix ? process.env[`${prefix}_RPC_URL_FALLBACK`] : undefined;
  if (primary && secondary) return fallback([http(primary), http(secondary)]);
  return primary ? http(primary) : http();
}
