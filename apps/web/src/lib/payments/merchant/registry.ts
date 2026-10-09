import { getDepositPolicy } from "@/lib/chains/depositConfirmation";
/** Native USDC only. Sources checked 2026-10-08:
 * https://developers.circle.com/stablecoins/usdc-contract-addresses
 * https://docs.arc.io/arc/references/connect-to-arc
 * https://developers.circle.com/stablecoins/usdc-contract-addresses (Sui; metadata confirmed on-chain)
 * Arc's ERC-20 interface is 6dp; native gas is 18dp, never added to the transfer. */
export const PAYMENT_CHAINS = [
  { id: "arc", family: "evm", name: "Arc", chainId: 5042, token: "0x3600000000000000000000000000000000000000", gas: "USDC", confirmations: 1, explorer: "https://explorer.arc.io", rpc: "https://rpc.mainnet.arc.io", env: "ARC_RPC_URL", logo: null },
  { id: "base", family: "evm", name: "Base", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", gas: "ETH", confirmations: 1, explorer: "https://basescan.org", rpc: "https://base-rpc.publicnode.com", env: "BASE_RPC_URL", logo: "/logos/official-onchain/base.svg" },
  { id: "arbitrum", family: "evm", name: "Arbitrum", chainId: 42161, token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", gas: "ETH", confirmations: 1, explorer: "https://arbiscan.io", rpc: "https://arbitrum-one-rpc.publicnode.com", env: "ARBITRUM_RPC_URL", logo: "/logos/chains/arbitrum.svg" },
  { id: "solana", family: "solana", name: "Solana", chainId: null, token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", gas: "SOL", confirmations: 31, explorer: "https://solscan.io", rpc: "https://api.mainnet-beta.solana.com", env: "SOLANA_RPC_URL", logo: "/logos/chains/solana.svg" },
  { id: "polygon", family: "evm", name: "Polygon", chainId: 137, token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", gas: "POL", confirmations: 128, explorer: "https://polygonscan.com", rpc: "https://polygon-bor-rpc.publicnode.com", env: "POLYGON_RPC_URL", logo: "/logos/chains/polygon.svg" },
  { id: "ethereum", family: "evm", name: "Ethereum", chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", gas: "ETH", confirmations: 12, explorer: "https://etherscan.io", rpc: "https://ethereum-rpc.publicnode.com", env: "ETHEREUM_RPC_URL", logo: "/logos/chains/ethereum.svg" },
  { id: "optimism", family: "evm", name: "OP Mainnet", chainId: 10, token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", gas: "ETH", confirmations: 1, explorer: "https://optimistic.etherscan.io", rpc: "https://mainnet.optimism.io", env: null, logo: "/logos/chains/optimism.svg" },
  { id: "avalanche", family: "evm", name: "Avalanche", chainId: 43114, token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", gas: "AVAX", confirmations: 1, explorer: "https://snowtrace.io", rpc: "https://api.avax.network/ext/bc/C/rpc", env: null, logo: "/logos/chains/avalanche.svg" },
  // Sui: Move coin type, not an address; read over GraphQL (lib/payments/merchant/sui.ts).
  { id: "sui", family: "sui", name: "Sui", chainId: null, token: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", gas: "SUI", confirmations: 1, explorer: "https://suiscan.xyz/mainnet", rpc: "https://graphql.mainnet.sui.io/graphql", env: "SUI_GRAPHQL_URL", logo: null },
] as const;
export type PaymentChain = typeof PAYMENT_CHAINS[number];
/** Collection follows the platform's reviewed deposit policy (lib/chains/depositConfirmation):
 *  a chain with no policy is not collectable, and the depth is never lower than either table. */
export function requiredConfirmations(id: string): number | null {
  const policy = getDepositPolicy(id);
  if (!policy) return null;
  return Math.max(policy.minConfirmations, paymentChain(id).confirmations);
}
export type PaymentChainId = PaymentChain["id"];
export function paymentChain(id: string): PaymentChain {
  const chain = PAYMENT_CHAINS.find(c => c.id === id);
  if (!chain) throw new Error("Unsupported payment network");
  return chain;
}
