// ---------------------------------------------------------------------------
// Blockchain network directory — 25 major public chains with metadata for the
// Chains explorer. Static reference data (tiers, not live TVL); each chain
// links back to its native asset in the markets catalog where one exists.
// ---------------------------------------------------------------------------

export type ChainCategory = "L1" | "L2" | "Sidechain" | "Appchain";
export type Tier = "high" | "medium" | "emerging";

export interface ChainInfo {
  id: string; // logo key under /logos/chains/ or /logos/coins/
  name: string;
  token: string; // native token symbol (links to catalog when listed)
  category: ChainCategory;
  consensus: string;
  launched: number;
  tvlTier: Tier;
  ecosystemTier: Tier;
  blurb: string;
}

export const CHAINS: ChainInfo[] = [
  { id: "btc", name: "Bitcoin", token: "BTC", category: "L1", consensus: "Proof of Work", launched: 2009, tvlTier: "high", ecosystemTier: "high", blurb: "The original chain — digital gold, now with L2s (Lightning, Stacks) adding programmability." },
  { id: "ethereum", name: "Ethereum", token: "ETH", category: "L1", consensus: "Proof of Stake", launched: 2015, tvlTier: "high", ecosystemTier: "high", blurb: "The largest smart-contract platform; home to most DeFi TVL and the rollup-centric roadmap." },
  { id: "solana", name: "Solana", token: "SOL", category: "L1", consensus: "PoS + PoH", launched: 2020, tvlTier: "high", ecosystemTier: "high", blurb: "High-throughput monolithic L1 — sub-second finality powers payments, DePIN and consumer apps." },
  { id: "base", name: "Base", token: "ETH", category: "L2", consensus: "Optimistic Rollup", launched: 2023, tvlTier: "high", ecosystemTier: "high", blurb: "Coinbase's OP-stack L2 — the busiest consumer chain and Furlpay's primary settlement rail." },
  { id: "arbitrum", name: "Arbitrum One", token: "ARB", category: "L2", consensus: "Optimistic Rollup", launched: 2021, tvlTier: "high", ecosystemTier: "high", blurb: "Largest Ethereum L2 by TVL with a deep DeFi ecosystem (GMX, Camelot, Pendle)." },
  { id: "op", name: "OP Mainnet", token: "OP", category: "L2", consensus: "Optimistic Rollup", launched: 2021, tvlTier: "medium", ecosystemTier: "high", blurb: "Flagship of the OP Superchain — shared-sequencer vision spanning Base, Zora and more." },
  { id: "polygon", name: "Polygon PoS", token: "POL", category: "Sidechain", consensus: "Proof of Stake", launched: 2020, tvlTier: "medium", ecosystemTier: "high", blurb: "Veteran EVM sidechain evolving into the AggLayer; strong in payments and brand deployments." },
  { id: "bnb", name: "BNB Chain", token: "BNB", category: "L1", consensus: "PoS Authority", launched: 2020, tvlTier: "high", ecosystemTier: "high", blurb: "Binance's high-volume EVM chain — retail DeFi, memecoins and low fees." },
  { id: "avalanche", name: "Avalanche", token: "AVAX", category: "L1", consensus: "Snowman PoS", launched: 2020, tvlTier: "medium", ecosystemTier: "medium", blurb: "Subnet architecture for app-specific chains; strong institutional and gaming traction." },
  { id: "sui", name: "Sui", token: "SUI", category: "L1", consensus: "Mysticeti BFT", launched: 2023, tvlTier: "medium", ecosystemTier: "medium", blurb: "Move-language L1 with object-centric state — fast-growing DeFi and gaming scene." },
  { id: "apt", name: "Aptos", token: "APT", category: "L1", consensus: "AptosBFT", launched: 2022, tvlTier: "medium", ecosystemTier: "medium", blurb: "Move-based L1 from ex-Diem engineers, pushing parallel execution throughput." },
  { id: "ton", name: "TON", token: "TON", category: "L1", consensus: "Proof of Stake", launched: 2022, tvlTier: "medium", ecosystemTier: "high", blurb: "Telegram-aligned chain — 900M-user distribution funnel for mini-app payments." },
  { id: "tron", name: "TRON", token: "TRX", category: "L1", consensus: "DPoS", launched: 2018, tvlTier: "high", ecosystemTier: "medium", blurb: "The USDT settlement workhorse — dominant in emerging-market stablecoin transfers." },
  { id: "near", name: "NEAR", token: "NEAR", category: "L1", consensus: "Nightshade PoS", launched: 2020, tvlTier: "medium", ecosystemTier: "medium", blurb: "Sharded L1 pivoting to chain abstraction and AI-agent infrastructure." },
  { id: "sei", name: "Sei", token: "SEI", category: "L1", consensus: "Twin-Turbo BFT", launched: 2023, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Trading-optimized parallel EVM chain with sub-400ms finality." },
  { id: "mnt", name: "Mantle", token: "MNT", category: "L2", consensus: "Optimistic Rollup", launched: 2023, tvlTier: "medium", ecosystemTier: "medium", blurb: "Treasury-rich modular L2 using EigenDA for data availability." },
  { id: "strk", name: "Starknet", token: "STRK", category: "L2", consensus: "ZK Rollup (STARK)", launched: 2022, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Cairo-based validity rollup — provable compute beyond the EVM." },
  { id: "imx", name: "Immutable zkEVM", token: "IMX", category: "L2", consensus: "ZK Rollup", launched: 2023, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Gaming-dedicated zkEVM with the largest web3 game catalog." },
  { id: "dot", name: "Polkadot", token: "DOT", category: "L1", consensus: "NPoS + parachains", launched: 2020, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Heterogeneous multichain — parachains share security via the relay chain." },
  { id: "atom", name: "Cosmos Hub", token: "ATOM", category: "Appchain", consensus: "Tendermint BFT", launched: 2019, tvlTier: "emerging", ecosystemTier: "medium", blurb: "The IBC appchain thesis — dYdX, Celestia and Injective all run Cosmos-SDK stacks." },
  { id: "tia", name: "Celestia", token: "TIA", category: "L1", consensus: "Modular DA", launched: 2023, tvlTier: "emerging", ecosystemTier: "medium", blurb: "First modular data-availability layer — rollups post blobs instead of running full DA." },
  { id: "stx", name: "Stacks", token: "STX", category: "L2", consensus: "Proof of Transfer", launched: 2021, tvlTier: "emerging", ecosystemTier: "emerging", blurb: "Bitcoin L2 bringing smart contracts and sBTC to BTC liquidity." },
  { id: "hbar", name: "Hedera", token: "HBAR", category: "L1", consensus: "Hashgraph aBFT", launched: 2019, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Enterprise DAG-based network governed by a corporate council." },
  { id: "xlm", name: "Stellar", token: "XLM", category: "L1", consensus: "Stellar Consensus", launched: 2015, tvlTier: "emerging", ecosystemTier: "medium", blurb: "Payments-first chain — anchors, on/off-ramps and USDC remittance corridors." },
  { id: "kas", name: "Kaspa", token: "KAS", category: "L1", consensus: "GHOSTDAG PoW", launched: 2021, tvlTier: "emerging", ecosystemTier: "emerging", blurb: "BlockDAG proof-of-work — parallel blocks at one-second intervals." },
];

export function chainLogoPath(c: ChainInfo): string {
  // Chain artwork ships under /logos/chains (networks) or /logos/coins (token mark).
  return `/logos/${["ethereum", "solana", "arbitrum", "polygon", "optimism", "avalanche", "gnosis"].includes(c.id) ? "chains" : "coins"}/${c.id === "op" ? "op" : c.id === "bnb" ? "bnb" : c.id}.svg`;
}
