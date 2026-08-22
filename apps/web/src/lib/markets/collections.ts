// ---------------------------------------------------------------------------
// Curated collections — Robinhood-style lists / INDmoney-style themes. Each
// collection is a slugged set of catalog symbols with a gradient + lucide
// icon for the discover cards. Rendered by /markets and /markets/collections.
// ---------------------------------------------------------------------------

export interface Collection {
  slug: string;
  title: string;
  blurb: string;
  kind: "sector" | "theme" | "strategy" | "crypto";
  /** Card gradient [from, to] and accent for hover glow. */
  gradient: [string, string];
  /** lucide-react icon name rendered by CollectionCard. */
  icon: string;
  symbols: string[];
}

export const COLLECTIONS: Collection[] = [
  // ---- Themes ----
  { slug: "ai-robotics", title: "AI & Robotics", blurb: "The companies building the $2T AI infrastructure buildout — chips, memory, networking and models.", kind: "theme", gradient: ["#1B2A6B", "#0EA5E9"], icon: "BrainCircuit", symbols: ["NVDA", "MU", "AVGO", "AMD", "TSM", "ASML", "SMCI", "ARM", "PLTR", "ANET", "MRVL", "ISRG", "BOTZ", "NBIS", "AAOI", "LITE", "COHR", "CIEN"] },
  { slug: "ai-datacenter", title: "AI Datacenter Buildout", blurb: "The physical layer of the AI buildout — optical interconnect, networking silicon and the neoclouds renting out GPUs.", kind: "theme", gradient: ["#0C2A4A", "#38BDF8"], icon: "Network", symbols: ["NBIS", "AAOI", "LITE", "COHR", "CIEN", "ANET", "AVGO", "MRVL", "NVDA", "SMCI", "ETN", "VRT"] },
  { slug: "semiconductors", title: "Semiconductors", blurb: "The picks and shovels of the AI era — foundries, memory, EDA and equipment.", kind: "theme", gradient: ["#3B0764", "#9333EA"], icon: "Cpu", symbols: ["NVDA", "TSM", "AVGO", "AMD", "MU", "ASML", "LRCX", "KLAC", "AMAT", "ADI", "TXN", "QCOM", "INTC", "ON", "NXPI", "MRVL", "SMH", "SOXX"] },
  { slug: "clean-energy", title: "Clean Energy", blurb: "Solar, renewables and the grid buildout powering AI datacenters.", kind: "theme", gradient: ["#052E16", "#22C55E"], icon: "Leaf", symbols: ["NEE", "ICLN", "TAN", "LIT", "URA", "GE", "ETN", "EMR"] },
  { slug: "cybersecurity", title: "Cybersecurity", blurb: "Zero-trust, endpoint and network security in the agentic-AI threat era.", kind: "theme", gradient: ["#450A0A", "#EF4444"], icon: "ShieldCheck", symbols: ["PANW", "CRWD", "FTNT", "ZS", "OKTA", "NET", "HACK", "CIBR"] },
  { slug: "electric-vehicles", title: "Electric Vehicles", blurb: "EV makers, legacy autos going electric, and the battery supply chain.", kind: "theme", gradient: ["#172554", "#3B82F6"], icon: "Car", symbols: ["TSLA", "RIVN", "LCID", "F", "GM", "LIT", "DRIV"] },
  { slug: "fintech-payments", title: "Fintech & Payments", blurb: "Card networks, neobanks, brokers and the crypto-native financial stack.", kind: "theme", gradient: ["#042F2E", "#14B8A6"], icon: "CreditCard", symbols: ["V", "MA", "PYPL", "COIN", "HOOD", "SOFI", "AFRM", "NU", "AXP", "FINX"] },
  { slug: "space-defense", title: "Space & Defense", blurb: "Primes and platforms — defense budgets and the new space economy.", kind: "theme", gradient: ["#1E1B4B", "#6366F1"], icon: "Rocket", symbols: ["RTX", "LMT", "NOC", "GD", "BA", "GE", "ITA"] },
  { slug: "travel-experiences", title: "Travel & Experiences", blurb: "Airlines, hotels, cruises and booking platforms riding the experience economy.", kind: "theme", gradient: ["#431407", "#F97316"], icon: "Plane", symbols: ["BKNG", "ABNB", "MAR", "HLT", "RCL", "DAL", "UAL", "JETS"] },
  // ---- Strategies ----
  { slug: "dividend-kings", title: "Dividend Kings", blurb: "Decades of uninterrupted dividend growth — stocks that pay you while you sleep.", kind: "strategy", gradient: ["#422006", "#EAB308"], icon: "Crown", symbols: ["KO", "PG", "JNJ", "PEP", "WMT", "CL", "KMB", "GIS", "MCD", "O", "SCHD", "NOBL", "VIG"] },
  { slug: "growth-stars", title: "Growth Stars", blurb: "High-revenue-growth names compounding above the market.", kind: "strategy", gradient: ["#14532D", "#10B981"], icon: "TrendingUp", symbols: ["NVDA", "PLTR", "CRWD", "SHOP", "DDOG", "NET", "SNOW", "HOOD", "ABNB", "UBER", "DASH", "CVNA"] },
  { slug: "blue-chips", title: "Blue Chips", blurb: "Mega-cap compounders that anchor a long-term portfolio.", kind: "strategy", gradient: ["#1E3A8A", "#60A5FA"], icon: "Gem", symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "BRK.B", "JPM", "V", "MA", "UNH", "LLY", "WMT", "COST", "PG", "HD"] },
  { slug: "value-picks", title: "Value Picks", blurb: "Quality franchises trading at reasonable multiples.", kind: "strategy", gradient: ["#3F2C06", "#D97706"], icon: "Scale", symbols: ["BRK.B", "JPM", "BAC", "CVX", "XOM", "PFE", "CVS", "F", "GM", "INTC", "VZ", "T"] },
  { slug: "earnings-movers", title: "Q2 Earnings Watch", blurb: "Names reporting this earnings season — banks mid-July, Big Tech late July.", kind: "strategy", gradient: ["#4A044E", "#D946EF"], icon: "CalendarClock", symbols: ["JPM", "GS", "BAC", "WFC", "MS", "C", "GOOGL", "MSFT", "META", "AAPL", "AMZN", "MU", "TSLA"] },
  // ---- Crypto ----
  { slug: "crypto-blue-chips", title: "Crypto Blue Chips", blurb: "The large-cap core of a crypto allocation.", kind: "crypto", gradient: ["#312E81", "#818CF8"], icon: "Bitcoin", symbols: ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "TON", "DOT"] },
  { slug: "layer-1-protocols", title: "Layer 1 Protocols", blurb: "Base-layer smart-contract platforms competing on throughput and ecosystems.", kind: "crypto", gradient: ["#0C4A6E", "#38BDF8"], icon: "Layers", symbols: ["ETH", "SOL", "ADA", "AVAX", "TON", "NEAR", "APT", "SUI", "SEI", "ATOM", "TRX", "HBAR", "ALGO", "ICP", "KAS"] },
  { slug: "layer-2-scaling", title: "Layer 2 Scaling", blurb: "Rollups and Bitcoin L2s scaling the base layers.", kind: "crypto", gradient: ["#134E4A", "#2DD4BF"], icon: "Network", symbols: ["ARB", "OP", "POL", "IMX", "STRK", "MNT", "STX"] },
  { slug: "defi-blue-chips", title: "DeFi Blue Chips", blurb: "Battle-tested protocols with real fees — DEXs, lending and liquid staking.", kind: "crypto", gradient: ["#701A75", "#E879F9"], icon: "Landmark", symbols: ["UNI", "AAVE", "MKR", "LDO", "LINK", "CRV", "COMP", "SNX", "INJ", "JUP", "PENDLE", "ENA", "ONDO"] },
  { slug: "ai-tokens", title: "AI Tokens", blurb: "Decentralized compute, agents and data networks for the AI economy.", kind: "crypto", gradient: ["#0F172A", "#22D3EE"], icon: "Bot", symbols: ["TAO", "RENDER", "FET", "AKT", "WLD", "GRT", "AR", "HNT"] },
  // The "Meme Coins" collection was removed with the Meme category itself
  // (see catalog.ts). A collection whose every symbol has left the catalog
  // renders as an empty themed card, which reads as a broken feature rather
  // than a deliberate absence.
  { slug: "gaming-metaverse", title: "Gaming & Metaverse", blurb: "Game engines, virtual land and on-chain gaming economies.", kind: "crypto", gradient: ["#4C0519", "#FB7185"], icon: "Gamepad2", symbols: ["IMX", "SAND", "MANA", "AXS", "GALA", "ENJ", "APE", "CHZ", "RBLX", "U"] },
];

export function collectionBySlug(slug: string): Collection | undefined {
  return COLLECTIONS.find((col) => col.slug === slug);
}
