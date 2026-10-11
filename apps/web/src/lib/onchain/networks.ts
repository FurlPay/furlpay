// Native USDC addresses checked against Circle's issuer registry, 2026-10-07.
// https://developers.circle.com/stablecoins/usdc-contract-addresses
export const NETWORKS = [
  { id: "ethereum", name: "Ethereum", chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io", icon: "ethereum.svg", env: "ETHEREUM_RPC_URL", publicRpc: "https://ethereum-rpc.publicnode.com" },
  { id: "base", name: "Base", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org", icon: "base.svg", env: "BASE_RPC_URL", publicRpc: "https://base-rpc.publicnode.com" },
  { id: "arbitrum", name: "Arbitrum One", chainId: 42161, token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io", icon: "arbitrum.png", env: "ARBITRUM_RPC_URL", publicRpc: "https://arbitrum-one-rpc.publicnode.com" },
  { id: "polygon", name: "Polygon PoS", chainId: 137, token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", explorer: "https://polygonscan.com", icon: "polygon.svg", env: "POLYGON_RPC_URL", publicRpc: "https://polygon-bor-rpc.publicnode.com" },
  { id: "solana", name: "Solana", chainId: null, token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", explorer: "https://explorer.solana.com", icon: "solana.svg", env: "SOLANA_RPC_URL", publicRpc: "https://api.mainnet-beta.solana.com" },
] as const;
export type Network = typeof NETWORKS[number];
export type NetworkId = Network["id"];
export const explorerLink = (network: Network, kind: "address" | "tx", value: string) => `${network.explorer}/${kind}/${encodeURIComponent(value)}`;

/** Exact decimal presentation; never round a uint256 through Number. */
export function units(raw: string, decimals = 6): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid amount");
  const digits = BigInt(raw).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}
