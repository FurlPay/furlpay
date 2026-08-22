// ---------------------------------------------------------------------------
// The wire shape of GET /api/markets/[symbol], as the client sees it.
//
// Every statistic is `number | null` because that is what the route returns.
// The page previously declared them non-nullable — `marketCap: number`,
// `high52w: number` — which typechecked against nothing (the response is
// parsed JSON, so the annotation is an assertion, not a check) and turned
// every missing value into a rendered zero. It also still declared
// `circulatingSupply` and `athPrice`, fields the route had stopped sending
// at all; both arrived as undefined, were coalesced to 0, and printed as a
// $0.00 all-time high.
//
// Keeping this in one file next to the components that consume it is what
// makes the next divergence a typecheck failure rather than a rendered zero.
// ---------------------------------------------------------------------------

import type { ProvenanceData } from "./Provenance";

export interface SymbolStats {
  marketCap: number | null;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  eps: number | null;
  revenueTtm: number | null;
  netIncomeTtm: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  roePct: number | null;
  roaPct: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  cash: number | null;
  dividendYieldPct: number | null;
  dividendPerShareTtm: number | null;
  payoutRatioPct: number | null;
  beta: number | null;
  high52w: number | null;
  low52w: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
  volume: number | null;
  avgVolume: number | null;
  /** Exchange timestamp of the last trade, epoch seconds. */
  marketTime: number | null;
  exchange: string | null;
  currency: string | null;

  // Crypto supply. Null for equities, which report a share count instead.
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  fullyDilutedValuation: number | null;
  athPrice: number | null;
  athDate: string | null;
  atlPrice: number | null;
  atlDate: string | null;
  marketCapRank: number | null;
}

export interface SymbolAsset {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  industry: string | null;
  cap: string;
  chain: string | null;
  logo: string | null;
  /** False for a tradable symbol with no hand-written metadata — the great
   * majority of the universe. The page renders from live data alone; the
   * sections that need curation (logo, sector, related assets) drop out. */
  curated: boolean;
  exchange: string | null;
}

export interface RelatedAsset {
  symbol: string;
  name: string;
  kind?: string;
  logo: string | null;
  price: number | null;
  changePct: number | null;
}

export interface SymbolInsight {
  slug: string;
  title: string;
  category: string;
  date: string;
  readMins: number;
  signal: "bullish" | "bearish" | "neutral" | null;
}

export interface SymbolDetail {
  asset: SymbolAsset;
  /** Null price means no provider quoted this symbol; null change means there
   * was no previous close to measure against. Neither is a zero. */
  quote: { price: number | null; changePct: number | null; live: boolean };
  stats: SymbolStats;
  provenance: ProvenanceData;
  /** Omitted by the route when the 52-week range it narrates is unknown. */
  digest: string | null;
  /** Whether the request carried a valid session. Distinct from `position`,
   *  which is null for an anonymous reader AND for a holder-of-nothing. */
  authenticated: boolean;
  position: { shares: number; marketValue: number | null } | null;
  related: RelatedAsset[];
  insights: SymbolInsight[];
  asOf: string;
}
