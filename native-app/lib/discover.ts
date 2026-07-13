// ---------------------------------------------------------------------------
// Curated collections + blockchain directory for the discovery sections.
// Static reference data mirrored from the web app — keep in sync with
// apps/web/src/lib/markets/collections.ts and apps/web/src/lib/markets/chains.ts.
// ---------------------------------------------------------------------------

export interface Collection {
  slug: string;
  title: string;
  blurb: string;
  kind: "sector" | "theme" | "strategy" | "crypto";
  /** Card gradient [from, to]. */
  gradient: [string, string];
  symbols: string[];
}

export const COLLECTIONS: Collection[] = [
  // ---- Themes ----
  { slug: "ai-robotics", title: "AI & Robotics", blurb: "The companies building the $2T AI infrastructure buildout — chips, memory, networking and models.", kind: "theme", gradient: ["#1B2A6B", "#0EA5E9"], symbols: ["NVDA", "MU", "AVGO", "AMD", "TSM", "ASML", "SMCI", "ARM", "PLTR", "ANET", "MRVL", "ISRG", "BOTZ"] },
  { slug: "semiconductors", title: "Semiconductors", blurb: "The picks and shovels of the AI era — foundries, memory, EDA and equipment.", kind: "theme", gradient: ["#3B0764", "#9333EA"], symbols: ["NVDA", "TSM", "AVGO", "AMD", "MU", "ASML", "LRCX", "KLAC", "AMAT", "ADI", "TXN", "QCOM", "INTC", "ON", "NXPI", "MRVL", "SMH", "SOXX"] },
  { slug: "clean-energy", title: "Clean Energy", blurb: "Solar, renewables and the grid buildout powering AI datacenters.", kind: "theme", gradient: ["#052E16", "#22C55E"], symbols: ["NEE", "ICLN", "TAN", "LIT", "URA", "GE", "ETN", "EMR"] },
  { slug: "cybersecurity", title: "Cybersecurity", blurb: "Zero-trust, endpoint and network security in the agentic-AI threat era.", kind: "theme", gradient: ["#450A0A", "#EF4444"], symbols: ["PANW", "CRWD", "FTNT", "ZS", "OKTA", "NET", "HACK", "CIBR"] },
  { slug: "electric-vehicles", title: "Electric Vehicles", blurb: "EV makers, legacy autos going electric, and the battery supply chain.", kind: "theme", gradient: ["#172554", "#3B82F6"], symbols: ["TSLA", "RIVN", "LCID", "F", "GM", "LIT", "DRIV"] },
  { slug: "fintech-payments", title: "Fintech & Payments", blurb: "Card networks, neobanks, brokers and the crypto-native financial stack.", kind: "theme", gradient: ["#042F2E", "#14B8A6"], symbols: ["V", "MA", "PYPL", "COIN", "HOOD", "SOFI", "AFRM", "NU", "AXP", "FINX"] },
  { slug: "space-defense", title: "Space & Defense", blurb: "Primes and platforms — defense budgets and the new space economy.", kind: "theme", gradient: ["#1E1B4B", "#6366F1"], symbols: ["RTX", "LMT", "NOC", "GD", "BA", "GE", "ITA"] },
  { slug: "travel-experiences", title: "Travel & Experiences", blurb: "Airlines, hotels, cruises and booking platforms riding the experience economy.", kind: "theme", gradient: ["#431407", "#F97316"], symbols: ["BKNG", "ABNB", "MAR", "HLT", "RCL", "DAL", "UAL", "JETS"] },
  // ---- Strategies ----
  { slug: "dividend-kings", title: "Dividend Kings", blurb: "Decades of uninterrupted dividend growth — stocks that pay you while you sleep.", kind: "strategy", gradient: ["#422006", "#EAB308"], symbols: ["KO", "PG", "JNJ", "PEP", "WMT", "CL", "KMB", "GIS", "MCD", "O", "SCHD", "NOBL", "VIG"] },
  { slug: "growth-stars", title: "Growth Stars", blurb: "High-revenue-growth names compounding above the market.", kind: "strategy", gradient: ["#14532D", "#10B981"], symbols: ["NVDA", "PLTR", "CRWD", "SHOP", "DDOG", "NET", "SNOW", "HOOD", "ABNB", "UBER", "DASH", "CVNA"] },
  { slug: "blue-chips", title: "Blue Chips", blurb: "Mega-cap compounders that anchor a long-term portfolio.", kind: "strategy", gradient: ["#1E3A8A", "#60A5FA"], symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "BRK.B", "JPM", "V", "MA", "UNH", "LLY", "WMT", "COST", "PG", "HD"] },
  { slug: "value-picks", title: "Value Picks", blurb: "Quality franchises trading at reasonable multiples.", kind: "strategy", gradient: ["#3F2C06", "#D97706"], symbols: ["BRK.B", "JPM", "BAC", "CVX", "XOM", "PFE", "CVS", "F", "GM", "INTC", "VZ", "T"] },
  { slug: "earnings-movers", title: "Q2 Earnings Watch", blurb: "Names reporting this earnings season — banks mid-July, Big Tech late July.", kind: "strategy", gradient: ["#4A044E", "#D946EF"], symbols: ["JPM", "GS", "BAC", "WFC", "MS", "C", "GOOGL", "MSFT", "META", "AAPL", "AMZN", "MU", "TSLA"] },
  // ---- Crypto ----
  { slug: "crypto-blue-chips", title: "Crypto Blue Chips", blurb: "The large-cap core of a crypto allocation.", kind: "crypto", gradient: ["#312E81", "#818CF8"], symbols: ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "TON", "DOT"] },
  { slug: "layer-1-protocols", title: "Layer 1 Protocols", blurb: "Base-layer smart-contract platforms competing on throughput and ecosystems.", kind: "crypto", gradient: ["#0C4A6E", "#38BDF8"], symbols: ["ETH", "SOL", "ADA", "AVAX", "TON", "NEAR", "APT", "SUI", "SEI", "ATOM", "TRX", "HBAR", "ALGO", "ICP", "KAS"] },
  { slug: "layer-2-scaling", title: "Layer 2 Scaling", blurb: "Rollups and Bitcoin L2s scaling the base layers.", kind: "crypto", gradient: ["#134E4A", "#2DD4BF"], symbols: ["ARB", "OP", "POL", "IMX", "STRK", "MNT", "STX"] },
  { slug: "defi-blue-chips", title: "DeFi Blue Chips", blurb: "Battle-tested protocols with real fees — DEXs, lending and liquid staking.", kind: "crypto", gradient: ["#701A75", "#E879F9"], symbols: ["UNI", "AAVE", "MKR", "LDO", "LINK", "CRV", "COMP", "SNX", "INJ", "JUP", "PENDLE", "ENA", "ONDO"] },
  { slug: "ai-tokens", title: "AI Tokens", blurb: "Decentralized compute, agents and data networks for the AI economy.", kind: "crypto", gradient: ["#0F172A", "#22D3EE"], symbols: ["TAO", "RENDER", "FET", "AKT", "WLD", "GRT", "AR", "HNT"] },
  { slug: "meme-coins", title: "Meme Coins", blurb: "High-beta community coins — size positions accordingly.", kind: "crypto", gradient: ["#713F12", "#FACC15"], symbols: ["DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "NOT"] },
  { slug: "gaming-metaverse", title: "Gaming & Metaverse", blurb: "Game engines, virtual land and on-chain gaming economies.", kind: "crypto", gradient: ["#4C0519", "#FB7185"], symbols: ["IMX", "SAND", "MANA", "AXS", "GALA", "ENJ", "APE", "CHZ", "RBLX", "U"] },
];

export function collectionBySlug(slug: string): Collection | undefined {
  return COLLECTIONS.find((col) => col.slug === slug);
}

// ---------------------------------------------------------------------------
// Blockchain network directory — 25 major public chains (static tiers).
// ---------------------------------------------------------------------------

export type ChainCategory = "L1" | "L2" | "Sidechain" | "Appchain";
export type Tier = "high" | "medium" | "emerging";

export interface ChainInfo {
  id: string;
  name: string;
  token: string;
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
