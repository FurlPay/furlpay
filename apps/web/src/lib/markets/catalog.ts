// ---------------------------------------------------------------------------
// Tradable asset catalog — curated exchange-grade selection (top US stocks,
// major ETFs, top-cap crypto). Logos are self-hosted TradingView symbol marks
// under /public/logos/; assets without artwork fall back to a letter badge.
// Live quotes come from lib/markets/quotes.ts (Yahoo spark + CoinGecko) with
// baked seed prices as the offline fallback.
// ---------------------------------------------------------------------------

export type AssetKind = "stock" | "etf" | "crypto";

export interface MarketAsset {
  symbol: string;
  name: string;
  kind: AssetKind;
  /** CoinGecko id (crypto only) for live pricing. */
  cg?: string;
  /** Yahoo Finance symbol when it differs from `symbol` (stocks/ETFs). */
  yahoo?: string;
  /** Set false when we ship no logo file (falls back to letter badge). */
  hasLogo?: boolean;
}

const s = (symbol: string, name: string, extra?: Partial<MarketAsset>): MarketAsset => ({
  symbol,
  name,
  kind: "stock",
  ...extra,
});
const e = (symbol: string, name: string, extra?: Partial<MarketAsset>): MarketAsset => ({
  symbol,
  name,
  kind: "etf",
  ...extra,
});
const c = (symbol: string, name: string, cg: string, extra?: Partial<MarketAsset>): MarketAsset => ({
  symbol,
  name,
  kind: "crypto",
  cg,
  ...extra,
});

export const CATALOG: MarketAsset[] = [
  // ---- US stocks ----
  s("AAPL", "Apple Inc."),
  s("MSFT", "Microsoft Corp."),
  s("NVDA", "NVIDIA Corp."),
  s("GOOGL", "Alphabet Inc."),
  s("AMZN", "Amazon.com Inc."),
  s("META", "Meta Platforms Inc."),
  s("TSLA", "Tesla Inc."),
  s("AVGO", "Broadcom Inc."),
  s("BRK.B", "Berkshire Hathaway", { yahoo: "BRK-B" }),
  s("JPM", "JPMorgan Chase & Co."),
  s("V", "Visa Inc."),
  s("MA", "Mastercard Inc."),
  s("LLY", "Eli Lilly & Co."),
  s("WMT", "Walmart Inc."),
  s("XOM", "Exxon Mobil Corp."),
  s("JNJ", "Johnson & Johnson"),
  s("PG", "Procter & Gamble Co."),
  s("HD", "Home Depot Inc."),
  s("COST", "Costco Wholesale Corp."),
  s("ORCL", "Oracle Corp."),
  s("NFLX", "Netflix Inc."),
  s("BAC", "Bank of America Corp."),
  s("KO", "Coca-Cola Co."),
  s("PEP", "PepsiCo Inc."),
  s("CRM", "Salesforce Inc."),
  s("AMD", "Advanced Micro Devices"),
  s("ADBE", "Adobe Inc."),
  s("DIS", "Walt Disney Co."),
  s("CSCO", "Cisco Systems Inc."),
  s("INTC", "Intel Corp."),
  s("QCOM", "Qualcomm Inc."),
  s("IBM", "IBM Corp."),
  s("UBER", "Uber Technologies"),
  s("SHOP", "Shopify Inc."),
  s("PYPL", "PayPal Holdings"),
  s("COIN", "Coinbase Global"),
  s("HOOD", "Robinhood Markets"),
  s("PLTR", "Palantir Technologies"),
  s("SNOW", "Snowflake Inc."),
  s("SPOT", "Spotify Technology"),
  s("ABNB", "Airbnb Inc."),
  s("NKE", "Nike Inc."),
  s("MCD", "McDonald's Corp."),
  s("SBUX", "Starbucks Corp."),
  s("BA", "Boeing Co."),
  s("GE", "GE Aerospace"),
  s("CAT", "Caterpillar Inc."),
  s("GS", "Goldman Sachs Group"),
  s("TSM", "Taiwan Semiconductor"),
  s("ASML", "ASML Holding"),

  // ---- ETFs ----
  e("SPY", "SPDR S&P 500 ETF"),
  e("VOO", "Vanguard S&P 500 ETF"),
  e("VTI", "Vanguard Total Market ETF"),
  e("QQQ", "Invesco QQQ Trust"),
  e("IVV", "iShares Core S&P 500"),
  e("IWM", "iShares Russell 2000"),
  e("GLD", "SPDR Gold Shares"),
  e("ARKK", "ARK Innovation ETF", { hasLogo: false }),
  e("SCHD", "Schwab US Dividend Equity"),
  e("VXUS", "Vanguard Intl Stock ETF"),
  e("SMH", "VanEck Semiconductor ETF"),
  e("AGG", "iShares Core US Aggregate Bond"),

  // ---- Crypto ----
  c("BTC", "Bitcoin", "bitcoin"),
  c("ETH", "Ethereum", "ethereum"),
  c("SOL", "Solana", "solana"),
  c("BNB", "BNB", "binancecoin"),
  c("XRP", "XRP", "ripple"),
  c("ADA", "Cardano", "cardano"),
  c("DOGE", "Dogecoin", "dogecoin"),
  c("TRX", "TRON", "tron"),
  c("AVAX", "Avalanche", "avalanche-2"),
  c("LINK", "Chainlink", "chainlink"),
  c("DOT", "Polkadot", "polkadot"),
  c("POL", "Polygon", "polygon-ecosystem-token"),
  c("TON", "Toncoin", "the-open-network"),
  c("SHIB", "Shiba Inu", "shiba-inu"),
  c("LTC", "Litecoin", "litecoin"),
  c("BCH", "Bitcoin Cash", "bitcoin-cash"),
  c("UNI", "Uniswap", "uniswap"),
  c("XLM", "Stellar", "stellar"),
  c("NEAR", "NEAR Protocol", "near"),
  c("APT", "Aptos", "aptos"),
  c("ARB", "Arbitrum", "arbitrum"),
  c("OP", "Optimism", "optimism"),
  c("ATOM", "Cosmos", "cosmos"),
  c("FIL", "Filecoin", "filecoin"),
  c("INJ", "Injective", "injective-protocol"),
  c("HBAR", "Hedera", "hedera-hashgraph"),
  c("VET", "VeChain", "vechain"),
  c("ALGO", "Algorand", "algorand"),
  c("GRT", "The Graph", "the-graph", { hasLogo: false }),
  c("AAVE", "Aave", "aave"),
  c("MKR", "Maker", "maker"),
  c("SAND", "The Sandbox", "the-sandbox"),
  c("MANA", "Decentraland", "decentraland"),
  c("SUI", "Sui", "sui"),
  c("SEI", "Sei", "sei-network"),
  c("PEPE", "Pepe", "pepe"),
  c("TIA", "Celestia", "celestia"),
  c("JUP", "Jupiter", "jupiter-exchange-solana", { hasLogo: false }),
  c("WLD", "Worldcoin", "worldcoin-wld"),
  c("RENDER", "Render", "render-token"),
  // Stablecoins (already used across the app)
  c("USDC", "USD Coin", "usd-coin"),
  c("USDT", "Tether", "tether"),
  c("DAI", "Dai", "dai"),
  c("PYUSD", "PayPal USD", "paypal-usd"),
  c("EURC", "Euro Coin", "euro-coin"),
];

/** Logo public path for an asset, or null when we ship no artwork. */
export function assetLogoPath(a: MarketAsset): string | null {
  if (a.hasLogo === false) return null;
  const file = a.symbol.toLowerCase().replace(/\./g, "");
  const dir = a.kind === "crypto" ? "coins" : a.kind === "etf" ? "etfs" : "stocks";
  return `/logos/${dir}/${file}.svg`;
}

export const bySymbol = new Map(CATALOG.map((a) => [a.symbol, a]));
