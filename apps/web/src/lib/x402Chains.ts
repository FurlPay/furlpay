import { defineChain, fallback, http, type Chain, type Transport } from "viem";
import { firstRpcUrl, rpcEndpointList } from "@/lib/rpcEnv";
import { arbitrum, arbitrumSepolia, base, baseSepolia, polygon, mainnet } from "viem/chains";

// Circle Arc. Defined here rather than imported from viem/chains because Arc
// mainnet launched 2026-09-16 and is not in this viem version's chain list.
// Values verified against the live RPCs on 2026-09-17 (eth_chainId -> 0x13b2
// and 0x4cef52).
//
// `nativeCurrency` is USDC at 18 decimals, and that is not a mistake: on Arc
// the gas asset IS USDC, exposed natively at 18 decimals and through ERC-20 at
// 6. viem's fee estimation works in native units, so this must stay 18 —
// lib/chains/arc.ts converts at the ERC-20 boundary.
const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

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
  arc,
  "arc-testnet": arcTestnet,
};

const RPC_ENV_PREFIX: Record<string, string> = {
  arbitrum: "ARBITRUM",
  "arbitrum-sepolia": "ARBITRUM_SEPOLIA",
  base: "BASE",
  "base-sepolia": "BASE_SEPOLIA",
  polygon: "POLYGON",
  ethereum: "ETHEREUM",
  arc: "ARC",
  "arc-testnet": "ARC_TESTNET",
};

/** Primary per-network RPC override, else undefined (caller uses the chain's
 *  public default). */
export function rpcUrl(network: string): string | undefined {
  const prefix = RPC_ENV_PREFIX[network];
  return prefix ? firstRpcUrl(process.env[`${prefix}_RPC_URL`]) : undefined;
}

/** Transport for a network: fallback(primary, secondary) when a fallback URL
 *  is configured, plain http(primary) otherwise, public default as last resort. */
/** Every configured RPC for a network, each on its own — primary, then
 *  fallback — or the chain's public default when none is set. The settlement
 *  safety probe queries these individually: a viem `fallback` transport would
 *  answer from whichever responds, which hides exactly the disagreement the
 *  probe exists to see. */
export function rpcUrls(network: string): string[] {
  const prefix = RPC_ENV_PREFIX[network];
  // `_RPC_URL` may itself be a comma-separated list (lib/rpcEnv.ts).
  const configured = prefix
    ? [...new Set([...rpcEndpointList(process.env[`${prefix}_RPC_URL`]), ...rpcEndpointList(process.env[`${prefix}_RPC_URL_FALLBACK`])])]
    : [];
  if (configured.length) return configured;
  const def = EVM_CHAINS[network]?.rpcUrls.default.http[0];
  return def ? [def] : [];
}

export function rpcTransport(network: string): Transport {
  const prefix = RPC_ENV_PREFIX[network];
  const urls = prefix
    ? [...new Set([...rpcEndpointList(process.env[`${prefix}_RPC_URL`]), ...rpcEndpointList(process.env[`${prefix}_RPC_URL_FALLBACK`])])]
    : [];
  if (urls.length > 1) return fallback(urls.map(u => http(u)));
  return urls.length ? http(urls[0]) : http();
}
