// ---------------------------------------------------------------------------
// Canonical market instruments: the things that have a price but not a CUSIP.
//
// This app's `AssetKind` is "stock" | "etf" | "crypto", and it is load-bearing:
// `bySymbol` resolves order routing through it, so widening that union would
// change what an order books against. This layer sits BESIDE it. Gold, the euro
// and the S&P 500 are not securities, have no issuer and no CUSIP, and must
// never be pushed through the 13F identity path — that path answers "who owns
// this", which is not a question you can ask about EURUSD.
//
// ── WHY THE PROVIDER SYMBOL IS NOT THE SYMBOL ──────────────────────────────
//
// Our canonical symbol is what a reader types and what the UI shows. The
// provider symbol is Yahoo's spelling, and the two agree almost nowhere outside
// equities: the euro is EURUSD=X, bitcoin is BTC-USD, the S&P 500 is ^GSPC, and
// gold is not available at all under the name people use for it.
//
// Every one of those translations lives in this file. None belongs in a
// component or a route.
//
// ── GOLD, AND A LIMITATION WE ARE NOT HIDING ───────────────────────────────
//
// XAUUSD is spot gold. Our provider does not carry it: XAUUSD=X returns 404.
// What it carries is GC=F, the COMEX front-month future, currently around
// $4,381 against a GLD share price of $396.75. A future is not spot — it embeds
// carry and rolls between contracts — so the two prices differ and diverge
// predictably near expiry.
//
// We map XAUUSD to GC=F because a gold price from the front-month future is the
// closest thing the provider has and is what most gold quotes on retail
// surfaces actually are. But the instrument records `providerNote` saying so,
// and the API returns it, because a reader comparing our number to a spot quote
// elsewhere deserves to know why they differ rather than concluding one of them
// is broken. Silver is the same story.
//
// ── WHAT "SUPPORTED" MEANS ─────────────────────────────────────────────────
//
// The three `*Supported` flags are measured, not assumed. Every one was checked
// against the provider: FX pairs return no volume at all, and neither do the
// VIX or the 10-year yield, while index futures and crypto do. Market cap
// exists for equities and coins and for nothing else here. A field that is not
// supported returns null; it never returns zero, because a zero volume reads as
// "nothing traded" rather than "we do not have this".
// ---------------------------------------------------------------------------

import type { AssetKind } from "./catalog";

export type MarketAssetClass =
  | "equity"
  | "etf"
  | "crypto"
  | "fx"
  | "commodity"
  | "index"
  | "rate"
  | "other";

export interface MarketInstrument {
  /** Canonical symbol. What a reader types and what the UI shows. */
  symbol: string;
  /** The provider's spelling. Never leaves this module except through the
   *  adapter that calls the provider. */
  providerSymbol: string;
  assetClass: MarketAssetClass;
  displayName: string;
  /** For a pair: what is being priced, and what it is priced in. */
  baseAsset?: string;
  quoteAsset?: string;
  currency: string;
  /** Venue or quoting convention, for display. */
  exchange?: string;
  priceSupported: boolean;
  volumeSupported: boolean;
  marketCapSupported: boolean;
  /** Where our canonical symbol and what the provider actually serves are not
   *  the same thing. Surfaced to the reader rather than buried. */
  providerNote?: string;
  /** Alternative spellings a reader might type. Explicit market aliases, not
   *  fuzzy matching — "Gold" means XAUUSD by convention, and that convention is
   *  written down here rather than inferred. */
  aliases: string[];
}

const fx = (
  symbol: string,
  base: string,
  quote: string,
  name: string,
  aliases: string[]
): MarketInstrument => ({
  symbol,
  providerSymbol: `${symbol}=X`,
  assetClass: "fx",
  displayName: name,
  baseAsset: base,
  quoteAsset: quote,
  currency: quote,
  exchange: "FX",
  priceSupported: true,
  // Measured: the provider returns no volume series for any FX pair.
  volumeSupported: false,
  marketCapSupported: false,
  aliases,
});

const index = (
  symbol: string,
  providerSymbol: string,
  name: string,
  volumeSupported: boolean,
  aliases: string[]
): MarketInstrument => ({
  symbol,
  providerSymbol,
  assetClass: "index",
  displayName: name,
  currency: "USD",
  exchange: "Index",
  priceSupported: true,
  volumeSupported,
  marketCapSupported: false,
  aliases,
});

const future = (
  symbol: string,
  providerSymbol: string,
  name: string,
  base: string,
  aliases: string[],
  providerNote?: string
): MarketInstrument => ({
  symbol,
  providerSymbol,
  assetClass: "commodity",
  displayName: name,
  baseAsset: base,
  quoteAsset: "USD",
  currency: "USD",
  exchange: "Futures",
  priceSupported: true,
  volumeSupported: true,
  marketCapSupported: false,
  aliases,
  providerNote,
});

/** The note attached to every metal quoted from a futures contract. */
const FUTURES_NOTE =
  "Priced from the front-month futures contract. The provider does not carry a spot quote for this metal, and a futures price embeds carry, so it differs from spot.";

/**
 * Instruments that are not securities. Equities, ETFs and coins already live in
 * `catalog.ts` and `universe.json` and are reached through `catalogInstrument`.
 *
 * Every provider symbol here was verified against a live response before being
 * written down, and the supported flags reflect what actually came back.
 */
export const INSTRUMENTS: MarketInstrument[] = [
  // ---- Precious metals. Futures, and labelled as such. ----
  future("XAUUSD", "GC=F", "Gold / US Dollar", "XAU", ["gold", "xau", "gold usd", "gold price"], FUTURES_NOTE),
  future("XAGUSD", "SI=F", "Silver / US Dollar", "XAG", ["silver", "xag", "silver usd"], FUTURES_NOTE),

  // ---- Energy and industrial ----
  future("WTIUSD", "CL=F", "WTI Crude Oil", "WTI", ["oil", "crude", "wti", "crude oil"], FUTURES_NOTE),
  future("BRENTUSD", "BZ=F", "Brent Crude Oil", "BRENT", ["brent", "brent crude"], FUTURES_NOTE),
  future("NATGASUSD", "NG=F", "Natural Gas", "NG", ["natural gas", "gas", "natgas"], FUTURES_NOTE),
  future("COPPERUSD", "HG=F", "Copper", "HG", ["copper"], FUTURES_NOTE),

  // ---- FX ----
  fx("EURUSD", "EUR", "USD", "Euro / US Dollar", ["euro", "eur", "euro dollar", "eur usd"]),
  fx("GBPUSD", "GBP", "USD", "British Pound / US Dollar", ["pound", "sterling", "gbp", "cable"]),
  fx("USDJPY", "USD", "JPY", "US Dollar / Japanese Yen", ["yen", "jpy", "dollar yen"]),
  fx("USDINR", "USD", "INR", "US Dollar / Indian Rupee", ["rupee", "inr", "dollar rupee"]),
  fx("USDCHF", "USD", "CHF", "US Dollar / Swiss Franc", ["franc", "chf", "swissie"]),
  fx("AUDUSD", "AUD", "USD", "Australian Dollar / US Dollar", ["aussie", "aud"]),
  fx("USDCAD", "USD", "CAD", "US Dollar / Canadian Dollar", ["loonie", "cad"]),

  // ---- Indices ----
  index("SPX", "^GSPC", "S&P 500", true, ["s&p", "sp500", "s&p 500", "gspc", "spx"]),
  index("NDX", "^NDX", "Nasdaq 100", true, ["nasdaq", "nasdaq 100", "ndx"]),
  index("DJI", "^DJI", "Dow Jones Industrial Average", true, ["dow", "dow jones", "djia"]),
  // Measured: no volume series on either.
  index("VIX", "^VIX", "CBOE Volatility Index", false, ["vix", "volatility"]),

  // ---- Rates ----
  {
    symbol: "US10Y",
    providerSymbol: "^TNX",
    assetClass: "rate",
    displayName: "US 10-Year Treasury Yield",
    currency: "USD",
    exchange: "CBOE",
    priceSupported: true,
    volumeSupported: false,
    marketCapSupported: false,
    aliases: ["10 year", "10y", "treasury", "tnx", "us10y"],
    providerNote: "Quoted as a yield in percent, not a price.",
  },
];

const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol.toUpperCase(), i]));
const byProviderSymbol = new Map(INSTRUMENTS.map((i) => [i.providerSymbol.toUpperCase(), i]));
const byAlias = new Map<string, MarketInstrument>();
for (const i of INSTRUMENTS) {
  for (const a of i.aliases) byAlias.set(a.toLowerCase(), i);
  byAlias.set(i.displayName.toLowerCase(), i);
}

/** Canonical spellings a reader might type for the same pair. */
function normalizeSymbol(q: string): string {
  return q.trim().toUpperCase().replace(/[\s/\-_]/g, "");
}

/**
 * Resolve a SYMBOL to an instrument. Exact symbol or provider symbol only.
 *
 * Aliases are deliberately excluded here, and the reason is a live collision:
 * "gold" is an alias for XAUUSD, and GOLD is also a listed equity ticker. A
 * resolver that accepts aliases would answer for /markets/GOLD and send someone
 * looking at a company to a commodity page. Route resolution must be exact.
 *
 * Aliases live in `resolveInstrumentOrAlias` and `searchInstruments`, which are
 * search surfaces where "gold" is a query rather than an identifier.
 */
export function resolveInstrument(query: string): MarketInstrument | null {
  if (!query) return null;
  return bySymbol.get(normalizeSymbol(query)) ?? byProviderSymbol.get(query.trim().toUpperCase()) ?? null;
}

/**
 * Resolve a symbol OR an explicit market alias: XAUUSD, "gold", "euro dollar".
 *
 * For search and for the instruments API, where the caller has typed a query
 * rather than followed a link. Never use this to resolve a route segment: see
 * `resolveInstrument` for why.
 */
export function resolveInstrumentOrAlias(query: string): MarketInstrument | null {
  if (!query) return null;
  return resolveInstrument(query) ?? byAlias.get(query.trim().toLowerCase()) ?? null;
}

/** Prefix search across symbols, names and aliases, for the search surface. */
export function searchInstruments(query: string, limit = 10): MarketInstrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const norm = normalizeSymbol(query);
  const hits = INSTRUMENTS.filter(
    (i) =>
      i.symbol.toUpperCase().startsWith(norm) ||
      i.displayName.toLowerCase().includes(q) ||
      i.aliases.some((a) => a.startsWith(q))
  );
  // Exact symbol first, then by how early the match falls.
  hits.sort((a, b) => {
    const ax = a.symbol.toUpperCase() === norm ? 0 : 1;
    const bx = b.symbol.toUpperCase() === norm ? 0 : 1;
    return ax - bx || a.symbol.localeCompare(b.symbol);
  });
  return hits.slice(0, limit);
}

/**
 * The instrument view of something already in the securities catalog.
 *
 * Equities, ETFs and coins keep their existing identity and routing; this only
 * expresses them in the same vocabulary so one search surface can list a stock
 * next to gold without either model being bent to fit the other.
 */
export function catalogInstrument(
  symbol: string,
  kind: AssetKind,
  name: string
): MarketInstrument {
  const assetClass: MarketAssetClass =
    kind === "stock" ? "equity" : kind === "etf" ? "etf" : "crypto";
  return {
    symbol: symbol.toUpperCase(),
    // Crypto is quoted as a pair; equities and ETFs are quoted as themselves.
    providerSymbol: kind === "crypto" ? `${symbol.toUpperCase()}-USD` : symbol.toUpperCase(),
    assetClass,
    displayName: name,
    currency: "USD",
    priceSupported: true,
    volumeSupported: true,
    // A coin has a market cap from circulating supply; an equity from its share
    // count. Both are supported, and both come from elsewhere.
    marketCapSupported: true,
    aliases: [],
  };
}

/** Human label for an asset-class badge. */
export function assetClassLabel(c: MarketAssetClass): string {
  switch (c) {
    case "equity": return "Equity";
    case "etf": return "ETF";
    case "crypto": return "Crypto";
    case "fx": return "FX";
    case "commodity": return "Commodity";
    case "index": return "Index";
    case "rate": return "Rate";
    case "other": return "Other";
  }
}
