import { demoBars, demoQuote, demoSearch } from "./demo";
import {
  alphaVantageBars,
  alphaVantageQuote,
  alphaVantageSearch,
  nasdaqDailyBars,
} from "./providers";
import { AssetMatch, BarInterval, BarsResult, MarketDataOptions, Quote } from "./types";

export * from "./types";

/**
 * Real-time stock/ETF market data for FurlPay — a thin aggregator over
 * Alpha Vantage and Nasdaq Data Link with a deterministic demo fallback.
 *
 * Clone-and-run: with no API keys it serves deterministic demo data, so the
 * dashboard (or any consumer) renders live-looking prices immediately. Provide a
 * key to hit the real providers; every live call fails soft to demo data so a
 * quote is never empty.
 *
 * @example
 *   import { MarketData } from "@furlpay/market-data";
 *   const md = new MarketData({ alphaVantageKey: process.env.ALPHA_VANTAGE_KEY });
 *   const quote = await md.quote("AAPL");
 */
export class MarketData {
  private readonly alphaVantageKey?: string;
  private readonly nasdaqKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MarketDataOptions = {}) {
    this.alphaVantageKey = opts.alphaVantageKey || process.env.ALPHA_VANTAGE_KEY || undefined;
    this.nasdaqKey = opts.nasdaqKey || process.env.NASDAQ_DATA_LINK_KEY || undefined;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (!this.fetchImpl) {
      throw new Error("MarketData: no fetch implementation available (Node 18+ required)");
    }
  }

  /** True when at least one provider key is configured; otherwise all calls use demo data. */
  get live(): boolean {
    return Boolean(this.alphaVantageKey || this.nasdaqKey);
  }

  /** Latest quote for a symbol. Falls back to deterministic demo data on any error. */
  async quote(symbol: string): Promise<Quote> {
    if (!this.alphaVantageKey) return demoQuote(symbol);
    try {
      return await alphaVantageQuote(this.fetchImpl, this.alphaVantageKey, symbol, this.timeoutMs);
    } catch {
      return { ...demoQuote(symbol) };
    }
  }

  /** Quotes for many symbols. Never rejects — failed lookups degrade to demo data. */
  async quotes(symbols: string[]): Promise<Quote[]> {
    return Promise.all(symbols.map((s) => this.quote(s)));
  }

  /** OHLCV bars. Uses Alpha Vantage; for daily bars, prefers Nasdaq Data Link when keyed. */
  async bars(
    symbol: string,
    opts: { interval?: BarInterval; limit?: number } = {},
  ): Promise<BarsResult> {
    const interval = opts.interval ?? "daily";
    const limit = opts.limit ?? 100;

    if (interval === "daily" && this.nasdaqKey) {
      try {
        return await nasdaqDailyBars(this.fetchImpl, this.nasdaqKey, symbol, limit, this.timeoutMs);
      } catch {
        /* fall through */
      }
    }
    if (this.alphaVantageKey) {
      try {
        return await alphaVantageBars(
          this.fetchImpl,
          this.alphaVantageKey,
          symbol,
          interval,
          limit,
          this.timeoutMs,
        );
      } catch {
        /* fall through */
      }
    }
    return demoBars(symbol, interval, limit);
  }

  /** Symbol search. Falls back to a small built-in universe in demo mode. */
  async search(query: string): Promise<AssetMatch[]> {
    if (!this.alphaVantageKey) return demoSearch(query);
    try {
      return await alphaVantageSearch(this.fetchImpl, this.alphaVantageKey, query, this.timeoutMs);
    } catch {
      return demoSearch(query);
    }
  }
}

export default MarketData;
