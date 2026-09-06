// ---------------------------------------------------------------------------
// Tradable asset catalog — 200+ top US stocks, 60+ ETFs, 100+ crypto assets
// with sector / industry / theme metadata for discovery, screening and
// collections. Logos are self-hosted TradingView symbol marks under
// /public/logos/ (see logo-manifest.json); assets without artwork fall back
// to a letter badge. Live quotes come from lib/markets/quotes.ts (Yahoo spark
// + CoinGecko) with baked seed prices as the offline fallback.
// ---------------------------------------------------------------------------

import manifest from "./logo-manifest.json";

export type AssetKind = "stock" | "etf" | "crypto";
export type CapTier = "mega" | "large" | "mid" | "small";

export type StockSector =
  | "Technology"
  | "Communication"
  | "Consumer Cyclical"
  | "Consumer Staples"
  | "Healthcare"
  | "Financials"
  | "Energy"
  | "Industrials"
  | "Utilities"
  | "Real Estate"
  | "Materials";

export type EtfCategory = "Broad Market" | "Sector" | "Bond" | "Commodity" | "Thematic" | "Crypto-linked" | "Dividend & Factor" | "International";

// "Meme" was retired from this union deliberately, not merely emptied. Leaving
// the member in place would let a future entry re-introduce the category with a
// one-line edit and no discussion; removing it makes that a type error.
export type CryptoCategory = "L1" | "L2" | "DeFi" | "Gaming" | "AI" | "Stablecoin" | "Infrastructure" | "Exchange" | "Privacy" | "RWA";

export interface MarketAsset {
  symbol: string;
  name: string;
  kind: AssetKind;
  /** GICS-style sector (stocks). */
  sector?: StockSector;
  /** Industry (stocks) or category (ETFs / crypto). */
  industry?: string;
  cap?: CapTier;
  tags?: string[];
  /** Crypto: primary chain the asset lives on ("own" = its own L1). */
  chain?: string;
  /** CoinGecko id (crypto only) for live pricing. */
  cg?: string;
  /** Yahoo Finance symbol when it differs from `symbol` (stocks/ETFs). */
  yahoo?: string;
}

// Compact constructors keep 360+ entries readable.
const s = (symbol: string, name: string, sector: StockSector, industry: string, cap: CapTier = "large", extra?: Partial<MarketAsset>): MarketAsset =>
  ({ symbol, name, kind: "stock", sector, industry, cap, ...extra });
const e = (symbol: string, name: string, industry: EtfCategory, extra?: Partial<MarketAsset>): MarketAsset =>
  ({ symbol, name, kind: "etf", industry, ...extra });
const c = (symbol: string, name: string, cg: string, industry: CryptoCategory, chain = "own", cap: CapTier = "large", extra?: Partial<MarketAsset>): MarketAsset =>
  ({ symbol, name, kind: "crypto", cg, industry, chain, cap, ...extra });

export const CATALOG: MarketAsset[] = [
  // ======================= US STOCKS — Technology =======================
  s("AAPL", "Apple Inc.", "Technology", "Consumer Electronics", "mega"),
  s("MSFT", "Microsoft Corp.", "Technology", "Software", "mega"),
  s("NVDA", "NVIDIA Corp.", "Technology", "Semiconductors", "mega"),
  s("AVGO", "Broadcom Inc.", "Technology", "Semiconductors", "mega"),
  s("ORCL", "Oracle Corp.", "Technology", "Software", "mega"),
  s("CRM", "Salesforce Inc.", "Technology", "Software"),
  s("AMD", "Advanced Micro Devices", "Technology", "Semiconductors"),
  s("ADBE", "Adobe Inc.", "Technology", "Software"),
  s("CSCO", "Cisco Systems Inc.", "Technology", "Networking"),
  s("INTC", "Intel Corp.", "Technology", "Semiconductors"),
  s("QCOM", "Qualcomm Inc.", "Technology", "Semiconductors"),
  s("IBM", "IBM Corp.", "Technology", "IT Services"),
  s("TXN", "Texas Instruments", "Technology", "Semiconductors"),
  s("NOW", "ServiceNow Inc.", "Technology", "Software"),
  s("INTU", "Intuit Inc.", "Technology", "Software"),
  s("MU", "Micron Technology", "Technology", "Semiconductors"),
  s("PANW", "Palo Alto Networks", "Technology", "Cybersecurity"),
  s("SNPS", "Synopsys Inc.", "Technology", "EDA Software"),
  s("CDNS", "Cadence Design Systems", "Technology", "EDA Software"),
  s("ANET", "Arista Networks", "Technology", "Networking"),
  s("LRCX", "Lam Research", "Technology", "Semi Equipment"),
  s("KLAC", "KLA Corp.", "Technology", "Semi Equipment"),
  s("AMAT", "Applied Materials", "Technology", "Semi Equipment"),
  s("ADI", "Analog Devices", "Technology", "Semiconductors"),
  s("CRWD", "CrowdStrike Holdings", "Technology", "Cybersecurity"),
  s("FTNT", "Fortinet Inc.", "Technology", "Cybersecurity"),
  s("NET", "Cloudflare Inc.", "Technology", "Cloud Infrastructure", "mid"),
  s("DDOG", "Datadog Inc.", "Technology", "Cloud Software", "mid"),
  s("ZS", "Zscaler Inc.", "Technology", "Cybersecurity", "mid"),
  s("MDB", "MongoDB Inc.", "Technology", "Databases", "mid"),
  s("TEAM", "Atlassian Corp.", "Technology", "Software", "mid"),
  s("SNOW", "Snowflake Inc.", "Technology", "Data Cloud"),
  s("PLTR", "Palantir Technologies", "Technology", "AI & Analytics"),
  s("SHOP", "Shopify Inc.", "Technology", "E-commerce Software"),
  s("TSM", "Taiwan Semiconductor", "Technology", "Semiconductors", "mega"),
  s("ASML", "ASML Holding", "Technology", "Semi Equipment", "mega"),
  s("SAP", "SAP SE", "Technology", "Software", "mega"),
  s("SMCI", "Super Micro Computer", "Technology", "AI Hardware", "mid"),
  s("DELL", "Dell Technologies", "Technology", "Hardware"),
  s("HPQ", "HP Inc.", "Technology", "Hardware", "mid"),
  s("WDC", "Western Digital", "Technology", "Storage", "mid"),
  s("STX", "Seagate Technology", "Technology", "Storage", "mid"),
  s("MRVL", "Marvell Technology", "Technology", "Semiconductors"),
  s("ON", "ON Semiconductor", "Technology", "Semiconductors", "mid"),
  s("NXPI", "NXP Semiconductors", "Technology", "Semiconductors"),
  s("GLW", "Corning Inc.", "Technology", "Components", "mid"),
  s("ZM", "Zoom Communications", "Technology", "Software", "mid"),
  s("DOCU", "DocuSign Inc.", "Technology", "Software", "mid"),
  s("OKTA", "Okta Inc.", "Technology", "Identity Security", "mid"),
  s("TWLO", "Twilio Inc.", "Technology", "Cloud Comms", "mid"),
  s("U", "Unity Software", "Technology", "Game Engines", "small"),
  s("RBLX", "Roblox Corp.", "Technology", "Gaming Platforms", "mid"),
  s("PATH", "UiPath Inc.", "Technology", "Automation", "small"),
  s("ARM", "Arm Holdings", "Technology", "Semiconductors"),

  // ---- AI infrastructure: optical interconnect & neoclouds ----
  //
  // Cap tiers are the ones the live quote actually supports, not the ones a
  // pitch assigns. AAOI is a ~$10B company and is tagged `mid`; NBIS is ~$60B
  // and is `large`. Nothing in this file encodes a price target, a revenue
  // forecast or a thesis — the catalog says what an asset IS, and every
  // number a reader sees comes from the providers at request time.
  s("AAOI", "Applied Optoelectronics, Inc.", "Technology", "Optical Networking", "mid"),
  s("LITE", "Lumentum Holdings Inc.", "Technology", "Optical Networking", "large"),
  s("COHR", "Coherent Corp.", "Technology", "Optical Networking", "large"),
  s("CIEN", "Ciena Corporation", "Technology", "Optical Networking", "large"),
  s("NBIS", "Nebius Group N.V.", "Technology", "AI Cloud Infrastructure", "large"),
  s("VRT", "Vertiv Holdings Co", "Industrials", "Datacenter Power & Cooling", "large"),
  s("MOD", "Modine Manufacturing Co.", "Industrials", "Datacenter Power & Cooling", "large"),
  s("NVT", "nVent Electric plc", "Industrials", "Datacenter Power & Cooling", "large"),
  s("PWR", "Quanta Services, Inc.", "Industrials", "Grid Construction", "large"),
  s("GEV", "GE Vernova Inc.", "Industrials", "Power Equipment", "mega"),

  // ---- AI silicon, interconnect and storage ----
  s("ALAB", "Astera Labs, Inc.", "Technology", "Connectivity Silicon", "large"),
  s("CRDO", "Credo Technology Group", "Technology", "Connectivity Silicon", "large"),
  s("SNDK", "Sandisk Corp.", "Technology", "Storage", "mega"),
  s("TER", "Teradyne, Inc.", "Technology", "Semi Equipment", "large"),
  s("HPE", "Hewlett Packard Enterprise", "Technology", "AI Hardware", "large"),
  s("CRWV", "CoreWeave, Inc.", "Technology", "AI Cloud Infrastructure", "large"),
  s("APP", "AppLovin Corp.", "Technology", "Adtech Software", "large"),

  // ---- Quantum computing ----
  //
  // Cap tiers are what the live quote supports, not what the narrative wants:
  // RGTI and QBTS are mid-caps and are tagged as such. The tier drives the
  // heatmap block size and the market-cap filter, so inflating one produces a
  // wrong screen rather than a flattering one.
  s("IONQ", "IonQ, Inc.", "Technology", "Quantum Computing", "large"),
  s("RGTI", "Rigetti Computing, Inc.", "Technology", "Quantum Computing", "mid"),
  s("QBTS", "D-Wave Quantum Inc.", "Technology", "Quantum Computing", "mid"),

  // ---- Bitcoin treasuries and miners ----
  //
  // Equities, not crypto: they price on an exchange, file with the SEC and
  // trade when the venue is open, so they belong here rather than beside the
  // coins. Their correlation to bitcoin is a property of the business, not a
  // reason to model them as tokens.
  //
  // Cap tiers below are computed, not judged -- live price times shares
  // outstanding from each company's own SEC filing (dei:EntityCommonStock-
  // SharesOutstanding, or the basic weighted average where the issuer reports
  // per class, as Strategy does). Recompute rather than nudge them; the tier
  // drives heatmap block size and the market-cap screen.
  s("MSTR", "Strategy Inc.", "Technology", "Bitcoin Treasury", "large"),
  s("IREN", "IREN Limited", "Technology", "Bitcoin Mining", "large"),
  s("RIOT", "Riot Platforms, Inc.", "Technology", "Bitcoin Mining", "mid"),
  s("CIFR", "Cipher Mining Inc.", "Technology", "Bitcoin Mining", "mid"),
  s("MARA", "MARA Holdings, Inc.", "Technology", "Bitcoin Mining", "mid"),
  s("CLSK", "CleanSpark, Inc.", "Technology", "Bitcoin Mining", "mid"),

  // ==================== US STOCKS — Communication =======================
  s("GOOGL", "Alphabet Inc.", "Communication", "Internet & Search", "mega"),
  // Class C, non-voting. Listed separately because it prices separately: the
  // A/C spread is real money on a large position, and showing one line for
  // both would quote the wrong share for whichever the reader holds.
  s("GOOG", "Alphabet Inc. (Class C)", "Communication", "Internet & Search", "mega"),
  s("META", "Meta Platforms Inc.", "Communication", "Social Media", "mega"),
  s("NFLX", "Netflix Inc.", "Communication", "Streaming", "mega"),
  s("DIS", "Walt Disney Co.", "Communication", "Entertainment"),
  s("CMCSA", "Comcast Corp.", "Communication", "Media & Cable"),
  s("TMUS", "T-Mobile US", "Communication", "Telecom"),
  s("VZ", "Verizon Communications", "Communication", "Telecom"),
  s("T", "AT&T Inc.", "Communication", "Telecom"),
  s("SPOT", "Spotify Technology", "Communication", "Audio Streaming"),
  s("RDDT", "Reddit Inc.", "Communication", "Social Media", "mid"),
  s("PINS", "Pinterest Inc.", "Communication", "Social Media", "mid"),
  s("SNAP", "Snap Inc.", "Communication", "Social Media", "small"),
  s("ROKU", "Roku Inc.", "Communication", "Streaming Devices", "small"),
  s("WBD", "Warner Bros. Discovery", "Communication", "Entertainment", "mid"),
  s("EA", "Electronic Arts", "Communication", "Video Games", "mid"),
  s("TTWO", "Take-Two Interactive", "Communication", "Video Games", "mid"),

  // ================== US STOCKS — Consumer Cyclical =====================
  s("AMZN", "Amazon.com Inc.", "Consumer Cyclical", "E-commerce", "mega"),
  s("TSLA", "Tesla Inc.", "Consumer Cyclical", "EV & Autos", "mega"),
  s("HD", "Home Depot Inc.", "Consumer Cyclical", "Home Improvement", "mega"),
  s("MCD", "McDonald's Corp.", "Consumer Cyclical", "Restaurants"),
  s("NKE", "Nike Inc.", "Consumer Cyclical", "Apparel"),
  s("SBUX", "Starbucks Corp.", "Consumer Cyclical", "Restaurants"),
  s("LOW", "Lowe's Companies", "Consumer Cyclical", "Home Improvement"),
  s("TJX", "TJX Companies", "Consumer Cyclical", "Retail"),
  s("BKNG", "Booking Holdings", "Consumer Cyclical", "Travel", "mega"),
  s("ABNB", "Airbnb Inc.", "Consumer Cyclical", "Travel"),
  s("UBER", "Uber Technologies", "Consumer Cyclical", "Ride-hailing"),
  s("LULU", "Lululemon Athletica", "Consumer Cyclical", "Apparel", "mid"),
  s("CMG", "Chipotle Mexican Grill", "Consumer Cyclical", "Restaurants"),
  s("ROST", "Ross Stores", "Consumer Cyclical", "Retail", "mid"),
  s("YUM", "Yum! Brands", "Consumer Cyclical", "Restaurants", "mid"),
  s("MAR", "Marriott International", "Consumer Cyclical", "Hotels"),
  s("HLT", "Hilton Worldwide", "Consumer Cyclical", "Hotels"),
  s("F", "Ford Motor Co.", "Consumer Cyclical", "Autos", "mid"),
  s("GM", "General Motors", "Consumer Cyclical", "Autos", "mid"),
  s("RIVN", "Rivian Automotive", "Consumer Cyclical", "EV & Autos", "small"),
  s("LCID", "Lucid Group", "Consumer Cyclical", "EV & Autos", "small"),
  s("DASH", "DoorDash Inc.", "Consumer Cyclical", "Food Delivery"),
  s("EBAY", "eBay Inc.", "Consumer Cyclical", "E-commerce", "mid"),
  s("ETSY", "Etsy Inc.", "Consumer Cyclical", "E-commerce", "small"),
  s("CVNA", "Carvana Co.", "Consumer Cyclical", "Auto Retail", "mid"),
  s("RCL", "Royal Caribbean", "Consumer Cyclical", "Cruise Lines", "mid"),
  s("DAL", "Delta Air Lines", "Consumer Cyclical", "Airlines", "mid"),
  s("UAL", "United Airlines", "Consumer Cyclical", "Airlines", "mid"),

  // ================== US STOCKS — Consumer Staples ======================
  s("WMT", "Walmart Inc.", "Consumer Staples", "Retail", "mega"),
  s("PG", "Procter & Gamble Co.", "Consumer Staples", "Household Products", "mega"),
  s("KO", "Coca-Cola Co.", "Consumer Staples", "Beverages"),
  s("PEP", "PepsiCo Inc.", "Consumer Staples", "Beverages"),
  s("COST", "Costco Wholesale Corp.", "Consumer Staples", "Retail", "mega"),
  s("PM", "Philip Morris Intl", "Consumer Staples", "Tobacco"),
  s("MO", "Altria Group", "Consumer Staples", "Tobacco", "mid"),
  s("MDLZ", "Mondelez International", "Consumer Staples", "Packaged Foods"),
  s("CL", "Colgate-Palmolive", "Consumer Staples", "Household Products"),
  s("KMB", "Kimberly-Clark", "Consumer Staples", "Household Products", "mid"),
  s("GIS", "General Mills", "Consumer Staples", "Packaged Foods", "mid"),
  s("HSY", "Hershey Co.", "Consumer Staples", "Confectionery", "mid"),
  s("STZ", "Constellation Brands", "Consumer Staples", "Beverages", "mid"),
  s("EL", "Estée Lauder", "Consumer Staples", "Beauty", "mid"),
  s("TGT", "Target Corp.", "Consumer Staples", "Retail", "mid"),
  s("KR", "Kroger Co.", "Consumer Staples", "Grocery", "mid"),

  // ====================== US STOCKS — Healthcare ========================
  s("LLY", "Eli Lilly & Co.", "Healthcare", "Pharmaceuticals", "mega"),
  s("JNJ", "Johnson & Johnson", "Healthcare", "Pharmaceuticals", "mega"),
  s("UNH", "UnitedHealth Group", "Healthcare", "Health Insurance", "mega"),
  s("ABBV", "AbbVie Inc.", "Healthcare", "Pharmaceuticals", "mega"),
  s("MRK", "Merck & Co.", "Healthcare", "Pharmaceuticals", "mega"),
  s("TMO", "Thermo Fisher Scientific", "Healthcare", "Life Sciences"),
  s("ABT", "Abbott Laboratories", "Healthcare", "Medical Devices"),
  s("DHR", "Danaher Corp.", "Healthcare", "Life Sciences"),
  s("PFE", "Pfizer Inc.", "Healthcare", "Pharmaceuticals"),
  s("AMGN", "Amgen Inc.", "Healthcare", "Biotech"),
  s("ISRG", "Intuitive Surgical", "Healthcare", "Robotic Surgery"),
  s("SYK", "Stryker Corp.", "Healthcare", "Medical Devices"),
  s("BSX", "Boston Scientific", "Healthcare", "Medical Devices"),
  s("VRTX", "Vertex Pharmaceuticals", "Healthcare", "Biotech"),
  s("REGN", "Regeneron Pharmaceuticals", "Healthcare", "Biotech"),
  s("GILD", "Gilead Sciences", "Healthcare", "Biotech"),
  s("ZTS", "Zoetis Inc.", "Healthcare", "Animal Health"),
  s("CVS", "CVS Health", "Healthcare", "Pharmacy & Insurance", "mid"),
  s("CI", "Cigna Group", "Healthcare", "Health Insurance"),
  s("MCK", "McKesson Corp.", "Healthcare", "Distribution"),
  s("BMY", "Bristol-Myers Squibb", "Healthcare", "Pharmaceuticals", "mid"),
  s("MRNA", "Moderna, Inc.", "Healthcare", "Biotech", "large"),
  s("HCA", "HCA Healthcare", "Healthcare", "Hospitals"),

  // ====================== US STOCKS — Financials ========================
  s("BRK.B", "Berkshire Hathaway", "Financials", "Diversified", "mega", { yahoo: "BRK-B" }),
  s("JPM", "JPMorgan Chase & Co.", "Financials", "Banks", "mega"),
  s("V", "Visa Inc.", "Financials", "Payments", "mega"),
  s("MA", "Mastercard Inc.", "Financials", "Payments", "mega"),
  s("BAC", "Bank of America Corp.", "Financials", "Banks", "mega"),
  s("WFC", "Wells Fargo & Co.", "Financials", "Banks"),
  s("GS", "Goldman Sachs Group", "Financials", "Investment Banks"),
  s("MS", "Morgan Stanley", "Financials", "Investment Banks"),
  s("SCHW", "Charles Schwab", "Financials", "Brokerage"),
  s("C", "Citigroup Inc.", "Financials", "Banks"),
  s("BLK", "BlackRock Inc.", "Financials", "Asset Management"),
  s("AXP", "American Express", "Financials", "Payments"),
  s("SPGI", "S&P Global", "Financials", "Data & Ratings"),
  s("PGR", "Progressive Corp.", "Financials", "Insurance"),
  s("CB", "Chubb Ltd.", "Financials", "Insurance"),
  s("AON", "Aon plc", "Financials", "Insurance Brokers"),
  s("ICE", "Intercontinental Exchange", "Financials", "Exchanges"),
  s("CME", "CME Group", "Financials", "Exchanges"),
  s("COF", "Capital One Financial", "Financials", "Consumer Finance"),
  s("USB", "U.S. Bancorp", "Financials", "Banks", "mid"),
  s("PNC", "PNC Financial Services", "Financials", "Banks", "mid"),
  // Ticker changed from BK; BK no longer trades and Yahoo 404s on it.
  s("BNY", "BNY Mellon", "Financials", "Custody Banks", "mid"),
  s("AIG", "American International Group", "Financials", "Insurance", "mid"),
  s("MET", "MetLife Inc.", "Financials", "Insurance", "mid"),
  s("ALL", "Allstate Corp.", "Financials", "Insurance", "mid"),
  s("PYPL", "PayPal Holdings", "Financials", "Payments"),
  s("COIN", "Coinbase Global", "Financials", "Crypto Exchange"),
  s("HOOD", "Robinhood Markets", "Financials", "Brokerage"),
  s("SOFI", "SoFi Technologies", "Financials", "Fintech", "mid"),
  s("AFRM", "Affirm Holdings", "Financials", "BNPL", "mid"),
  s("NU", "Nu Holdings", "Financials", "Digital Banks"),

  // ======================== US STOCKS — Energy ==========================
  s("XOM", "Exxon Mobil Corp.", "Energy", "Oil & Gas", "mega"),
  s("CVX", "Chevron Corp.", "Energy", "Oil & Gas", "mega"),
  s("COP", "ConocoPhillips", "Energy", "Oil & Gas"),
  s("SLB", "SLB (Schlumberger)", "Energy", "Oilfield Services", "mid"),
  s("EOG", "EOG Resources", "Energy", "Oil & Gas"),
  s("MPC", "Marathon Petroleum", "Energy", "Refining", "mid"),
  s("PSX", "Phillips 66", "Energy", "Refining", "mid"),
  s("VLO", "Valero Energy", "Energy", "Refining", "mid"),
  s("OXY", "Occidental Petroleum", "Energy", "Oil & Gas", "mid"),
  s("WMB", "Williams Companies", "Energy", "Midstream", "mid"),
  s("KMI", "Kinder Morgan", "Energy", "Midstream", "mid"),
  s("FANG", "Diamondback Energy", "Energy", "Oil & Gas", "mid"),

  // ====================== US STOCKS — Industrials =======================
  s("GE", "GE Aerospace", "Industrials", "Aerospace", "mega"),
  s("CAT", "Caterpillar Inc.", "Industrials", "Machinery"),
  s("BA", "Boeing Co.", "Industrials", "Aerospace"),
  s("UNP", "Union Pacific Corp.", "Industrials", "Railroads"),
  s("HON", "Honeywell International", "Industrials", "Conglomerate"),
  s("RTX", "RTX Corp.", "Industrials", "Aerospace & Defense"),
  s("LMT", "Lockheed Martin", "Industrials", "Defense"),
  s("DE", "Deere & Co.", "Industrials", "Agriculture Machinery"),
  s("UPS", "United Parcel Service", "Industrials", "Logistics", "mid"),
  s("FDX", "FedEx Corp.", "Industrials", "Logistics", "mid"),
  s("ADP", "Automatic Data Processing", "Industrials", "Payroll & HR"),
  s("ETN", "Eaton Corp.", "Industrials", "Electrical Equipment"),
  s("EMR", "Emerson Electric", "Industrials", "Automation", "mid"),
  s("ITW", "Illinois Tool Works", "Industrials", "Machinery"),
  s("PH", "Parker Hannifin", "Industrials", "Machinery"),
  s("CSX", "CSX Corp.", "Industrials", "Railroads", "mid"),
  s("NSC", "Norfolk Southern", "Industrials", "Railroads", "mid"),
  s("WM", "Waste Management", "Industrials", "Waste Services"),
  s("NOC", "Northrop Grumman", "Industrials", "Defense"),
  s("GD", "General Dynamics", "Industrials", "Defense"),
  s("MMM", "3M Co.", "Industrials", "Conglomerate", "mid"),
  s("URI", "United Rentals", "Industrials", "Equipment Rental", "mid"),

  // ================== US STOCKS — Utilities / RE / Materials ============
  s("NEE", "NextEra Energy", "Utilities", "Renewables"),
  s("CEG", "Constellation Energy Corp.", "Utilities", "Nuclear Power", "large"),
  s("VST", "Vistra Corp.", "Utilities", "Independent Power", "large"),
  s("TLN", "Talen Energy Corp.", "Utilities", "Independent Power", "large"),
  s("OKLO", "Oklo Inc.", "Utilities", "Advanced Nuclear", "mid"),
  s("SMR", "NuScale Power Corp.", "Utilities", "Advanced Nuclear", "mid"),
  s("DUK", "Duke Energy", "Utilities", "Electric", "mid"),
  s("SO", "Southern Co.", "Utilities", "Electric", "mid"),
  s("D", "Dominion Energy", "Utilities", "Electric", "mid"),
  s("AEP", "American Electric Power", "Utilities", "Electric", "mid"),
  s("SRE", "Sempra", "Utilities", "Multi-utility", "mid"),
  s("PLD", "Prologis Inc.", "Real Estate", "Industrial REITs"),
  s("AMT", "American Tower", "Real Estate", "Tower REITs"),
  s("EQIX", "Equinix Inc.", "Real Estate", "Data Center REITs"),
  s("CCI", "Crown Castle", "Real Estate", "Tower REITs", "mid"),
  s("PSA", "Public Storage", "Real Estate", "Storage REITs", "mid"),
  s("SPG", "Simon Property Group", "Real Estate", "Retail REITs", "mid"),
  s("O", "Realty Income", "Real Estate", "Net Lease REITs", "mid"),
  s("LIN", "Linde plc", "Materials", "Industrial Gases", "mega"),
  s("APD", "Air Products", "Materials", "Industrial Gases", "mid"),
  s("SHW", "Sherwin-Williams", "Materials", "Paints"),
  s("FCX", "Freeport-McMoRan", "Materials", "Copper Mining", "mid"),
  s("NEM", "Newmont Corp.", "Materials", "Gold Mining", "mid"),
  s("ECL", "Ecolab Inc.", "Materials", "Specialty Chemicals", "mid"),
  s("NUE", "Nucor Corp.", "Materials", "Steel", "mid"),

  // ============================== ETFs ==================================
  e("SPY", "SPDR S&P 500 ETF", "Broad Market"),
  e("VOO", "Vanguard S&P 500 ETF", "Broad Market"),
  e("IVV", "iShares Core S&P 500", "Broad Market"),
  e("VTI", "Vanguard Total Market ETF", "Broad Market"),
  e("QQQ", "Invesco QQQ Trust", "Broad Market"),
  e("DIA", "SPDR Dow Jones Industrial", "Broad Market"),
  e("IWM", "iShares Russell 2000", "Broad Market"),
  e("VT", "Vanguard Total World", "Broad Market"),
  e("VEA", "Vanguard FTSE Developed", "International"),
  e("VWO", "Vanguard FTSE Emerging", "International"),
  e("EFA", "iShares MSCI EAFE", "International"),
  e("EEM", "iShares MSCI Emerging", "International"),
  e("VXUS", "Vanguard Intl Stock ETF", "International"),
  e("RSP", "Invesco S&P 500 Equal Weight", "Broad Market"),
  e("XLK", "Technology Select SPDR", "Sector"),
  e("XLF", "Financial Select SPDR", "Sector"),
  e("XLV", "Health Care Select SPDR", "Sector"),
  e("XLE", "Energy Select SPDR", "Sector"),
  e("XLY", "Consumer Discretionary SPDR", "Sector"),
  e("XLP", "Consumer Staples SPDR", "Sector"),
  e("XLI", "Industrial Select SPDR", "Sector"),
  e("XLU", "Utilities Select SPDR", "Sector"),
  e("XLB", "Materials Select SPDR", "Sector"),
  e("XLRE", "Real Estate Select SPDR", "Sector"),
  e("XLC", "Communication Services SPDR", "Sector"),
  e("SMH", "VanEck Semiconductor ETF", "Sector"),
  e("SOXX", "iShares Semiconductor ETF", "Sector"),
  e("IBB", "iShares Biotechnology ETF", "Sector"),
  e("XBI", "SPDR S&P Biotech ETF", "Sector"),
  e("KRE", "SPDR S&P Regional Banking", "Sector"),
  e("ITA", "iShares US Aerospace & Defense", "Sector"),
  e("AGG", "iShares Core US Aggregate Bond", "Bond"),
  e("BND", "Vanguard Total Bond Market", "Bond"),
  e("TLT", "iShares 20+ Year Treasury", "Bond"),
  e("IEF", "iShares 7-10 Year Treasury", "Bond"),
  e("SHY", "iShares 1-3 Year Treasury", "Bond"),
  e("LQD", "iShares Investment Grade Corp", "Bond"),
  e("HYG", "iShares High Yield Corp", "Bond"),
  e("TIP", "iShares TIPS Bond", "Bond"),
  e("GLD", "SPDR Gold Shares", "Commodity"),
  e("SLV", "iShares Silver Trust", "Commodity"),
  e("GDX", "VanEck Gold Miners", "Commodity"),
  e("USO", "United States Oil Fund", "Commodity"),
  e("DBC", "Invesco DB Commodity Index", "Commodity"),
  e("ARKK", "ARK Innovation ETF", "Thematic"),
  e("ICLN", "iShares Global Clean Energy", "Thematic"),
  e("TAN", "Invesco Solar ETF", "Thematic"),
  e("LIT", "Global X Lithium & Battery", "Thematic"),
  e("BOTZ", "Global X Robotics & AI", "Thematic"),
  e("HACK", "Amplify Cybersecurity ETF", "Thematic"),
  e("CIBR", "First Trust Cybersecurity", "Thematic"),
  e("SKYY", "First Trust Cloud Computing", "Thematic"),
  e("FINX", "Global X FinTech ETF", "Thematic"),
  e("DRIV", "Global X Autonomous & EV", "Thematic"),
  e("JETS", "U.S. Global Jets ETF", "Thematic"),
  e("URA", "Global X Uranium ETF", "Thematic"),
  e("IBIT", "iShares Bitcoin Trust", "Crypto-linked"),
  e("FBTC", "Fidelity Wise Origin Bitcoin", "Crypto-linked"),
  e("ETHA", "iShares Ethereum Trust", "Crypto-linked"),
  e("BITQ", "Bitwise Crypto Industry", "Crypto-linked"),
  // GBTC is the original Grayscale trust. Its low-fee sibling lists as "BTC",
  // which collides with the bitcoin entry further down and is therefore NOT
  // added here -- see the note on that entry.
  e("GBTC", "Grayscale Bitcoin Trust", "Crypto-linked"),
  e("BSOL", "Bitwise Solana Staking ETF", "Crypto-linked"),
  // Covered-call income funds. Filed under income rather than Crypto-linked or
  // Thematic because that is what the reader is buying: distributions funded by
  // written calls, with the upside capped in exchange.
  e("JEPI", "JPMorgan Equity Premium Income", "Dividend & Factor"),
  e("JEPQ", "JPMorgan Nasdaq Equity Premium Income", "Dividend & Factor"),
  e("SCHD", "Schwab US Dividend Equity", "Dividend & Factor"),
  e("VIG", "Vanguard Dividend Appreciation", "Dividend & Factor"),
  e("VYM", "Vanguard High Dividend Yield", "Dividend & Factor"),
  e("NOBL", "ProShares S&P Dividend Aristocrats", "Dividend & Factor"),
  e("DGRO", "iShares Core Dividend Growth", "Dividend & Factor"),
  e("USMV", "iShares MSCI Min Volatility", "Dividend & Factor"),
  e("MTUM", "iShares MSCI Momentum", "Dividend & Factor"),
  e("QUAL", "iShares MSCI Quality", "Dividend & Factor"),

  // ============================= CRYPTO =================================
  // Layer 1s
  // "BTC" is also a live US ticker -- the Grayscale Bitcoin Mini Trust ETF,
  // present in universe.json and tradable. It is deliberately NOT given a
  // catalog entry, and the reason is the order path rather than the page.
  //
  // bySymbol resolves a bare ticker towards the security, so an e("BTC", ...)
  // row here would outrank this coin for every caller that looks a ticker up
  // without a kind. /api/investing/order is one of those callers. Someone
  // buying "BTC" would be priced and booked into a Grayscale share class --
  // exactly the STX/DASH defect documented on bySymbol, reintroduced on the
  // one ticker where the crypto reading is overwhelmingly the intended one.
  //
  // XRP below is the same shape: the Bitwise XRP ETF lists under the coin's
  // ticker and is likewise left out.
  //
  // The ETFs are not lost, only unreachable by bare symbol. Giving them pages
  // needs kind-qualified route keys (byKindSymbol already distinguishes them),
  // not a catalog row that silently changes what an order means.
  c("BTC", "Bitcoin", "bitcoin", "L1", "own", "mega"),
  c("ETH", "Ethereum", "ethereum", "L1", "own", "mega"),
  c("SOL", "Solana", "solana", "L1", "own", "mega"),
  // Hyperliquid. A standalone Rust L1 running HyperBFT, not an L2 or an EVM
  // fork, so it is classified "L1" on architecture rather than on the fact
  // that its flagship product is a perpetuals exchange. CoinGecko rank 10 by
  // market capitalisation at the time of adding, which is why it is "mega" and
  // why its absence from a catalog claiming the top assets was a real gap.
  // No artwork in logo-manifest.json, so it renders the letter badge.
  c("HYPE", "Hyperliquid", "hyperliquid", "L1", "own", "mega"),
  c("BNB", "BNB", "binancecoin", "Exchange", "own", "mega"),
  c("XRP", "XRP", "ripple", "L1", "own", "mega"),
  c("ADA", "Cardano", "cardano", "L1"),
  c("TRX", "TRON", "tron", "L1"),
  c("AVAX", "Avalanche", "avalanche-2", "L1"),
  c("TON", "Toncoin", "the-open-network", "L1"),
  c("DOT", "Polkadot", "polkadot", "L1"),
  c("NEAR", "NEAR Protocol", "near", "L1"),
  c("APT", "Aptos", "aptos", "L1", "own", "mid"),
  c("SUI", "Sui", "sui", "L1"),
  c("SEI", "Sei", "sei-network", "L1", "own", "mid"),
  c("ATOM", "Cosmos", "cosmos", "L1", "own", "mid"),
  c("LTC", "Litecoin", "litecoin", "L1"),
  c("BCH", "Bitcoin Cash", "bitcoin-cash", "L1"),
  c("XLM", "Stellar", "stellar", "L1"),
  c("HBAR", "Hedera", "hedera-hashgraph", "L1"),
  c("VET", "VeChain", "vechain", "L1", "own", "mid"),
  c("ALGO", "Algorand", "algorand", "L1", "own", "mid"),
  c("ICP", "Internet Computer", "internet-computer", "L1", "own", "mid"),
  c("FTM", "Fantom / Sonic", "fantom", "L1", "own", "mid"),
  c("XTZ", "Tezos", "tezos", "L1", "own", "small"),
  c("EGLD", "MultiversX", "elrond-erd-2", "L1", "own", "small"),
  c("FLOW", "Flow", "flow", "L1", "own", "small"),
  c("KAS", "Kaspa", "kaspa", "L1", "own", "mid"),
  c("NEO", "Neo", "neo", "L1", "own", "small"),
  c("ETC", "Ethereum Classic", "ethereum-classic", "L1", "own", "mid"),
  c("CELO", "Celo", "celo", "L1", "own", "small"),
  c("KAVA", "Kava", "kava", "L1", "own", "small"),
  c("ROSE", "Oasis Network", "oasis-network", "L1", "own", "small"),
  c("ZIL", "Zilliqa", "zilliqa", "L1", "own", "small"),
  c("TIA", "Celestia", "celestia", "Infrastructure", "own", "mid"),
  // Layer 2s & scaling
  c("ARB", "Arbitrum", "arbitrum", "L2", "ethereum", "mid"),
  c("OP", "Optimism", "optimism", "L2", "ethereum", "mid"),
  c("POL", "Polygon", "polygon-ecosystem-token", "L2", "ethereum", "mid"),
  c("IMX", "Immutable", "immutable-x", "L2", "ethereum", "mid"),
  c("STRK", "Starknet", "starknet", "L2", "ethereum", "small"),
  c("MNT", "Mantle", "mantle", "L2", "ethereum", "mid"),
  c("STX", "Stacks", "blockstack", "L2", "bitcoin", "mid"),
  // DeFi
  c("LINK", "Chainlink", "chainlink", "Infrastructure", "ethereum"),
  c("UNI", "Uniswap", "uniswap", "DeFi", "ethereum"),
  c("AAVE", "Aave", "aave", "DeFi", "ethereum"),
  c("MKR", "Maker", "maker", "DeFi", "ethereum", "mid"),
  c("LDO", "Lido DAO", "lido-dao", "DeFi", "ethereum", "mid"),
  c("CRV", "Curve DAO", "curve-dao-token", "DeFi", "ethereum", "small"),
  c("COMP", "Compound", "compound-governance-token", "DeFi", "ethereum", "small"),
  c("SNX", "Synthetix", "havven", "DeFi", "ethereum", "small"),
  c("SUSHI", "SushiSwap", "sushi", "DeFi", "ethereum", "small"),
  c("YFI", "yearn.finance", "yearn-finance", "DeFi", "ethereum", "small"),
  c("1INCH", "1inch", "1inch", "DeFi", "ethereum", "small"),
  c("BAL", "Balancer", "balancer", "DeFi", "ethereum", "small"),
  c("GMX", "GMX", "gmx", "DeFi", "arbitrum", "small"),
  c("DYDX", "dYdX", "dydx-chain", "DeFi", "own", "small"),
  c("PENDLE", "Pendle", "pendle", "DeFi", "ethereum", "small"),
  c("ENA", "Ethena", "ethena", "DeFi", "ethereum", "mid"),
  c("ONDO", "Ondo Finance", "ondo-finance", "RWA", "ethereum", "mid"),
  c("JTO", "Jito", "jito-governance-token", "DeFi", "solana", "small"),
  c("JUP", "Jupiter", "jupiter-exchange-solana", "DeFi", "solana", "mid"),
  c("RUNE", "THORChain", "thorchain", "DeFi", "own", "small"),
  c("INJ", "Injective", "injective-protocol", "DeFi", "own", "mid"),
  // Infrastructure / AI / Data
  c("RENDER", "Render", "render-token", "AI", "solana", "mid"),
  c("TAO", "Bittensor", "bittensor", "AI", "own", "mid"),
  c("FET", "Artificial Superintelligence", "fetch-ai", "AI", "ethereum", "mid"),
  c("GRT", "The Graph", "the-graph", "Infrastructure", "ethereum", "mid"),
  c("FIL", "Filecoin", "filecoin", "Infrastructure", "own", "mid"),
  c("AR", "Arweave", "arweave", "Infrastructure", "own", "small"),
  c("HNT", "Helium", "helium", "Infrastructure", "solana", "small"),
  c("AKT", "Akash Network", "akash-network", "AI", "own", "small"),
  c("PYTH", "Pyth Network", "pyth-network", "Infrastructure", "solana", "small"),
  c("W", "Wormhole", "wormhole", "Infrastructure", "solana", "small"),
  c("QNT", "Quant", "quant-network", "Infrastructure", "ethereum", "small"),
  c("THETA", "Theta Network", "theta-token", "Infrastructure", "own", "small"),
  c("IOTA", "IOTA", "iota", "Infrastructure", "own", "small"),
  // Gaming & metaverse
  c("SAND", "The Sandbox", "the-sandbox", "Gaming", "ethereum", "small"),
  c("MANA", "Decentraland", "decentraland", "Gaming", "ethereum", "small"),
  c("AXS", "Axie Infinity", "axie-infinity", "Gaming", "ethereum", "small"),
  c("GALA", "Gala", "gala", "Gaming", "ethereum", "small"),
  c("ENJ", "Enjin Coin", "enjincoin", "Gaming", "own", "small"),
  c("APE", "ApeCoin", "apecoin", "Gaming", "ethereum", "small"),
  c("CHZ", "Chiliz", "chiliz", "Gaming", "own", "small"),
  // Privacy
  c("XMR", "Monero", "monero", "Privacy", "own", "mid"),
  c("ZEC", "Zcash", "zcash", "Privacy", "own", "mid"),
  c("DASH", "Dash", "dash", "Privacy", "own", "small"),
  // Exchange & misc
  c("CRO", "Cronos", "crypto-com-chain", "Exchange", "own", "mid"),
  c("OKB", "OKB", "okb", "Exchange", "own", "mid"),
  c("BAT", "Basic Attention Token", "basic-attention-token", "Infrastructure", "ethereum", "small"),
  c("WLD", "Worldcoin", "worldcoin-wld", "AI", "ethereum", "mid"),
  // Stablecoins (used across the app)
  c("USDC", "USD Coin", "usd-coin", "Stablecoin", "ethereum", "large"),
  c("USDT", "Tether", "tether", "Stablecoin", "ethereum", "mega"),
  c("DAI", "Dai", "dai", "Stablecoin", "ethereum", "mid"),
  c("PYUSD", "PayPal USD", "paypal-usd", "Stablecoin", "ethereum", "small"),
  c("EURC", "Euro Coin", "euro-coin", "Stablecoin", "ethereum", "small"),
];

const HAS_LOGO = new Set(manifest as string[]);

/** Logo public path for an asset, or null when we ship no artwork. */
export function assetLogoPath(a: MarketAsset): string | null {
  const file = a.symbol.toLowerCase().replace(/\./g, "");
  const dir = a.kind === "crypto" ? "coins" : a.kind === "etf" ? "etfs" : "stocks";
  return HAS_LOGO.has(`${dir}/${file}`) ? `/logos/${dir}/${file}.svg` : null;
}

/** Tickers claimed by more than one asset class in this catalog.
 *
 * Currently STX (Seagate / Stacks) and DASH (DoorDash / Dash). */
export const AMBIGUOUS_TICKERS: ReadonlySet<string> = (() => {
  const seen = new Map<string, number>();
  for (const a of CATALOG) seen.set(a.symbol, (seen.get(a.symbol) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t));
})();

/** Exact lookup: `stock:STX` is Seagate, `crypto:STX` is Stacks. Always prefer
 * this when the caller knows the asset class. */
export const byKindSymbol = new Map(CATALOG.map((a) => [`${a.kind}:${a.symbol}`, a]));

/** Bare-ticker lookup, resolving collisions towards the security.
 *
 * This used to be `new Map(CATALOG.map(...))`, which is last-write-wins. The
 * crypto entries sit after the equities in this file, so `bySymbol.get("STX")`
 * returned Stacks the token rather than Seagate, and DASH returned Dash rather
 * than DoorDash — making both equities unreachable by ticker.
 *
 * That is not only a display problem: this map is what /api/investing/order and
 * /api/investing/portfolio resolve against, so an order for STX was priced and
 * booked as a crypto asset. quotes.ts already documents this hazard for the
 * price cache; the same collision was live here.
 *
 * A bare ticker on a finance surface conventionally means the listed security,
 * so stocks and ETFs win. Crypto remains reachable through `byKindSymbol`. */
export const bySymbol = (() => {
  const m = new Map<string, MarketAsset>();
  for (const a of CATALOG) {
    const held = m.get(a.symbol);
    if (!held) { m.set(a.symbol, a); continue; }
    const heldIsSecurity = held.kind === "stock" || held.kind === "etf";
    const nextIsSecurity = a.kind === "stock" || a.kind === "etf";
    if (nextIsSecurity && !heldIsSecurity) m.set(a.symbol, a);
  }
  return m;
})();

export const STOCK_SECTORS: StockSector[] = [
  "Technology", "Communication", "Consumer Cyclical", "Consumer Staples", "Healthcare",
  "Financials", "Energy", "Industrials", "Utilities", "Real Estate", "Materials",
];

export const CRYPTO_CATEGORIES: CryptoCategory[] = [
  "L1", "L2", "DeFi", "AI", "Gaming", "Stablecoin", "Infrastructure", "Exchange", "Privacy", "RWA",
];
