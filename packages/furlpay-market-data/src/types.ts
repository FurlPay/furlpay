export type Source = "alphavantage" | "nasdaq" | "demo";

export type BarInterval = "1min" | "5min" | "15min" | "30min" | "60min" | "daily";

export interface Quote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  currency: string;
  asOf: string; // ISO timestamp
  source: Source;
}

export interface Bar {
  t: string; // ISO timestamp of the bar open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BarsResult {
  symbol: string;
  interval: BarInterval;
  bars: Bar[];
  source: Source;
}

export interface AssetMatch {
  symbol: string;
  name: string;
  type: string; // Equity, ETF, etc.
  region: string;
  currency: string;
  source: Source;
}

export interface MarketDataOptions {
  /** Alpha Vantage API key. https://www.alphavantage.co/support/#api-key */
  alphaVantageKey?: string;
  /** Nasdaq Data Link (formerly Quandl) API key. https://data.nasdaq.com */
  nasdaqKey?: string;
  /** Override the fetch implementation (Node 18+ provides a global fetch). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
}
