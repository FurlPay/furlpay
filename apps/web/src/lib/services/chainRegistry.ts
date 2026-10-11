import { firstRpcUrl } from "@/lib/rpcEnv";
// ---------------------------------------------------------------------------
// Chain registry — the settlement networks Furlpay operates on, with RPC
// endpoints, canonical USDC deployments and the Furlpay contract directory.
// Arbitrum One is the primary settlement rail (deepest L2 stablecoin
// liquidity); Robinhood Chain is the Orbit L2 used for tokenized-stock data.
//
// LIVE: gas price / block height fetched over JSON-RPC with a short timeout.
// MOCK: deterministic plausible values (INTEGRATION_MODE=mock or RPC failure —
// the registry never throws, so /api/chain/* stays up when RPCs are down).
// ---------------------------------------------------------------------------

const MODE = process.env.INTEGRATION_MODE || "mock";
const RPC_TIMEOUT_MS = 3000;

export interface ChainConfig {
  id: string; // Furlpay network slug (matches x402 + intent router slugs)
  name: string;
  chainId: number;
  vm: "evm" | "solana";
  rpcUrl: string;
  explorer: string;
  nativeToken: "ETH" | "SOL" | "POL" | "USDC";
  role: "settlement" | "testnet" | "data" | "bridge-source";
  usdc?: { native: string; bridged?: string };
}

export const CHAIN_REGISTRY: ChainConfig[] = [
  {
    id: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ARBITRUM_RPC_URL) || "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeToken: "ETH",
    role: "settlement",
    usdc: {
      native: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      bridged: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC.e
    },
  },
  {
    id: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    chainId: 421614,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ARBITRUM_SEPOLIA_RPC_URL) || "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    nativeToken: "ETH",
    role: "testnet",
    usdc: { native: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
  },
  {
    id: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ROBINHOOD_RPC_URL) || "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    nativeToken: "ETH",
    role: "data", // tokenized-stock reads for the investing hub
  },
  {
    id: "base",
    name: "Base",
    chainId: 8453,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.BASE_RPC_URL) || "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeToken: "ETH",
    role: "bridge-source",
    usdc: { native: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  },
  {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ETHEREUM_RPC_URL) || "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    nativeToken: "ETH",
    role: "bridge-source",
    usdc: { native: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  },
  {
    id: "polygon",
    name: "Polygon PoS",
    chainId: 137,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.POLYGON_RPC_URL) || "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    nativeToken: "POL",
    // Second settlement rail: native USDC + CCTP V2, deep liquidity, sub-cent gas.
    role: "settlement",
    usdc: { native: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  },
  {
    id: "solana",
    name: "Solana",
    chainId: 0, // Solana does not use EVM chain IDs
    vm: "solana",
    rpcUrl: firstRpcUrl(process.env.SOLANA_RPC_URL) || "",
    explorer: "https://explorer.solana.com",
    nativeToken: "SOL",
    role: "settlement",
    usdc: { native: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  },
  {
    id: "solana-devnet",
    name: "Solana Devnet",
    chainId: 0,
    vm: "solana",
    rpcUrl: firstRpcUrl(process.env.SOLANA_DEVNET_RPC_URL) || "https://api.devnet.solana.com",
    explorer: "https://explorer.solana.com?cluster=devnet",
    nativeToken: "SOL",
    role: "testnet",
    usdc: { native: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  },
  {
    id: "arc",
    name: "Circle Arc",
    chainId: 5042,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ARC_RPC_URL) || "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    nativeToken: "USDC" as const,
    // Arc is the chain where USDC IS the gas. Sub-second deterministic finality.
    // USDC-native gas removes the ETH float and fee-payer complexity.
    role: "settlement",
    usdc: { native: "0x3600000000000000000000000000000000000000" },
  },
  {
    id: "arc-testnet",
    name: "Circle Arc Testnet",
    chainId: 5042002,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ARC_TESTNET_RPC_URL) || "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    nativeToken: "USDC" as const,
    role: "testnet",
    usdc: { native: "0x3600000000000000000000000000000000000000" },
  },
  {
    id: "tempo",
    name: "Tempo",
    chainId: 4217,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.TEMPO_RPC_URL) || "https://rpc.tempo.xyz",
    explorer: "https://explore.mainnet.tempo.xyz",
    // Stripe's payment-purpose L1: 100K+ TPS, sub-second (~600ms) deterministic
    // finality, stablecoin-native gas (TIP-20). Built on Paradigm's Reth SDK.
    nativeToken: "USDC" as const, // Gas paid in USD-denominated TIP-20 stablecoins
    role: "settlement",
    usdc: { native: "0x20C000000000000000000000b9537d11c60E8b50" }, // USDC.e via LayerZero/Stargate
  },
  // ── Testnets for e2e and integration testing ──────────────────────────
  {
    id: "ethereum-sepolia",
    name: "Ethereum Sepolia",
    chainId: 11155111,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.ETHEREUM_SEPOLIA_RPC_URL) || "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    nativeToken: "ETH",
    role: "testnet",
    usdc: { native: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  },
  {
    id: "base-sepolia",
    name: "Base Sepolia",
    chainId: 84532,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.BASE_SEPOLIA_RPC_URL) || "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    nativeToken: "ETH",
    role: "testnet",
    usdc: { native: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  },
  {
    id: "tempo-testnet",
    name: "Tempo Moderato",
    chainId: 42431,
    vm: "evm",
    rpcUrl: firstRpcUrl(process.env.TEMPO_TESTNET_RPC_URL) || "https://rpc.testnet.tempo.xyz",
    explorer: "https://explore.testnet.tempo.xyz",
    nativeToken: "USDC" as const,
    role: "testnet",
  },
];

export function getChain(idOrChainId: string | number): ChainConfig | undefined {
  return CHAIN_REGISTRY.find(
    (c) => c.id === idOrChainId || c.chainId === Number(idOrChainId)
  );
}

// Furlpay contract directory. Addresses come from env once deployed; until
// then a contract reports status "pending_deployment" so clients can render
// the directory without hardcoding addresses that don't exist yet.
export interface ContractEntry {
  name: string;
  chain: string;
  address: string | null;
  status: "deployed" | "pending_deployment";
  purpose: string;
}

function contract(name: string, env: string, chain: string, purpose: string): ContractEntry {
  const address = process.env[env] || null;
  return { name, chain, address, status: address ? "deployed" : "pending_deployment", purpose };
}

export function contractDirectory(): ContractEntry[] {
  return [
    contract("FurlPayRouter", "FURLPAY_ROUTER_ADDRESS", "arbitrum", "USDC payment routing with 0.5% fee capture"),
    contract("FurlPayEscrow", "FURLPAY_ESCROW_ADDRESS", "arbitrum", "Travel booking escrow with time-locked release"),
    contract("X402Facilitator", "FURLPAY_X402_ADDRESS", "arbitrum", "On-chain settlement for x402 agent micropayments"),
    contract("BookingReceipt", "FURLPAY_RECEIPT_ADDRESS", "arbitrum", "ERC-721 booking receipts (proof of purchase)"),
    contract("USDCPaymaster", "FURLPAY_PAYMASTER_ADDRESS", "arbitrum", "ERC-4337 paymaster — pay gas in USDC"),
    contract("ComplianceRouter", "FURLPAY_COMPLIANCE_ADDRESS", "arbitrum", "KYC attestation + sanctions hooks on transfers"),
  ];
}

// --- JSON-RPC helpers (never throw; return null on any failure) -------------

async function rpc<T = string>(chain: ChainConfig, method: string, params: unknown[] = []): Promise<T | null> {
  if (MODE !== "live") return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
    const res = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  } catch {
    return null;
  }
}

export interface ChainStatus {
  id: string;
  name: string;
  chainId: number;
  blockHeight: number;
  healthy: boolean;
  source: "live" | "mock";
  /**
   * Block-explorer base URL, so clients can link a transaction hash without
   * shipping their own chain table.
   *
   * The mobile app deliberately carries no chain metadata: a copy in the
   * client goes stale the moment a network changes explorer (Robinhood Chain
   * is on Blockscout today) and can only be corrected by an app-store release.
   * Served from here, it is a deploy.
   */
  explorer: string;
}

// Plausible mock block heights (mid-2026), advanced by wall clock so repeated
// calls look like a moving chain even without an RPC.
const MOCK_BASE_BLOCKS: Record<string, { height: number; msPerBlock: number }> = {
  arbitrum: { height: 340_000_000, msPerBlock: 250 },
  "arbitrum-sepolia": { height: 160_000_000, msPerBlock: 250 },
  robinhood: { height: 4_200_000, msPerBlock: 100 },
  base: { height: 32_000_000, msPerBlock: 2000 },
  ethereum: { height: 23_000_000, msPerBlock: 12000 },
  polygon: { height: 62_000_000, msPerBlock: 2100 },
  solana: { height: 310_000_000, msPerBlock: 400 },
  "solana-devnet": { height: 350_000_000, msPerBlock: 400 },
  arc: { height: 500_000, msPerBlock: 800 },
  "arc-testnet": { height: 200_000, msPerBlock: 800 },
  tempo: { height: 1_000_000, msPerBlock: 500 },
  "ethereum-sepolia": { height: 8_000_000, msPerBlock: 12000 },
  "base-sepolia": { height: 20_000_000, msPerBlock: 2000 },
  "tempo-testnet": { height: 500_000, msPerBlock: 500 },
};
const EPOCH = Date.UTC(2026, 6, 1); // Jul 1 2026

function mockBlockHeight(id: string): number {
  const m = MOCK_BASE_BLOCKS[id] ?? { height: 1_000_000, msPerBlock: 1000 };
  return m.height + Math.floor((Date.now() - EPOCH) / m.msPerBlock);
}

export async function chainStatus(chain: ChainConfig): Promise<ChainStatus> {
  const hex = await rpc(chain, "eth_blockNumber");
  const live = typeof hex === "string" && hex.startsWith("0x");
  return {
    id: chain.id,
    name: chain.name,
    chainId: chain.chainId,
    blockHeight: live ? parseInt(hex, 16) : mockBlockHeight(chain.id),
    healthy: true,
    source: live ? "live" : "mock",
    explorer: chain.explorer,
  };
}

export interface GasQuote {
  id: string;
  name: string;
  chainId: number;
  gasPriceGwei: number;
  // What a simple USDC transfer costs at this gas price (~65k gas), in USD.
  transferCostUsd: number;
  source: "live" | "mock";
}

// Mock gas prices reflect each network's typical floor.
const MOCK_GAS_GWEI: Record<string, number> = {
  arbitrum: 0.02, // ArbOS 51 raised the min L2 base fee to 0.02 gwei
  "arbitrum-sepolia": 0.1,
  robinhood: 0.01,
  base: 0.05,
  ethereum: 1.5,
};
const ETH_PRICE_USD = 3400; // static reference for mock cost math
const TRANSFER_GAS = 65_000;

export async function gasQuote(chain: ChainConfig): Promise<GasQuote> {
  const hex = await rpc(chain, "eth_gasPrice");
  const live = typeof hex === "string" && hex.startsWith("0x");
  const gwei = live ? parseInt(hex, 16) / 1e9 : MOCK_GAS_GWEI[chain.id] ?? 0.1;
  return {
    id: chain.id,
    name: chain.name,
    chainId: chain.chainId,
    gasPriceGwei: round(gwei, 4),
    transferCostUsd: round((gwei * 1e-9 * TRANSFER_GAS * ETH_PRICE_USD), 6),
    source: live ? "live" : "mock",
  };
}

export async function getTransaction(chain: ChainConfig, hash: string) {
  const tx = await rpc<Record<string, unknown>>(chain, "eth_getTransactionByHash", [hash]);
  if (tx) return { source: "live" as const, tx };
  // Mock: echo a plausible receipt so integration tests exercise the shape.
  return {
    source: "mock" as const,
    tx: {
      hash,
      chainId: chain.chainId,
      blockNumber: mockBlockHeight(chain.id) - 12,
      status: "confirmed",
      explorerUrl: `${chain.explorer}/tx/${hash}`,
    },
  };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
