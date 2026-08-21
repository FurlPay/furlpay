// ---------------------------------------------------------------------------
// Yahoo Finance chart endpoint — consolidated last price, 52-week range, volume.
//
// Only the v8 chart endpoint is used. The v7 quote and v10 quoteSummary
// endpoints both now return 401 "Invalid Crumb" to unauthenticated callers —
// verified 2026-08-21 — so anything built on those needs the cookie+crumb dance
// that the yahoo-finance2 package performs. The chart endpoint still answers
// with no auth at all, and it carries every field the price header needs.
//
// This is an undocumented endpoint. It can change without notice, which is why
// every field is read defensively and a failure returns null rather than
// throwing: a provider changing shape must blank one section, not the page.
// ---------------------------------------------------------------------------

import { BROWSER_UA, cachedJson, fetchJson, TTL } from "./cache";

interface ChartMeta {
  symbol?: string;
  currency?: string;
  longName?: string;
  shortName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface ChartResponse {
  chart?: { result?: ChartResult[]; error?: unknown };
}

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

async function chart(
  symbol: string,
  range: string,
  interval: string,
  prePost = false
): Promise<ChartResult | null> {
  const url =
    `${BASE}/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=${prePost}`;
  const res = await fetchJson<ChartResponse>(url, { headers: BROWSER_UA, timeoutMs: 8_000 });
  return res?.chart?.result?.[0] ?? null;
}

export interface YahooQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  instrumentType: string | null;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52w: number | null;
  low52w: number | null;
  volume: number | null;
  /** Exchange timestamp of the last trade, epoch seconds. Drives the staleness
   * badge — a price with no timestamp cannot be claimed to be live. */
  marketTime: number | null;
}

/** Consolidated quote for one symbol. Null if Yahoo did not answer.
 *
 * Cached for 15s: long enough to absorb a page with several widgets asking for
 * the same symbol, short enough that the number on a trade surface is never
 * meaningfully behind. */
export async function quote(symbol: string): Promise<YahooQuote | null> {
  return cachedJson(`yq:${symbol.toUpperCase()}`, TTL.quote, async () => {
    const r = await chart(symbol, "1d", "1m", true);
    const m = r?.meta;
    if (!m || typeof m.regularMarketPrice !== "number") return null;

    const price = m.regularMarketPrice;
    const prev = m.previousClose ?? m.chartPreviousClose ?? null;
    // A change needs a reference. Without a previous close we report the price
    // and leave the delta null rather than implying a flat day.
    const change = prev === null ? null : price - prev;
    const changePct = prev === null || prev === 0 ? null : ((price - prev) / prev) * 100;

    return {
      symbol: m.symbol ?? symbol.toUpperCase(),
      name: m.longName ?? m.shortName ?? null,
      currency: m.currency ?? null,
      exchange: m.fullExchangeName ?? null,
      instrumentType: m.instrumentType ?? null,
      price,
      previousClose: prev,
      change,
      changePct,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      high52w: m.fiftyTwoWeekHigh ?? null,
      low52w: m.fiftyTwoWeekLow ?? null,
      volume: m.regularMarketVolume ?? null,
      marketTime: m.regularMarketTime ?? null,
    };
  });
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Yahoo range/interval pairs behind the chart's timeframe buttons.
 *
 * The interval is not a free choice: Yahoo caps 1m data at roughly 7 days and
 * refuses combinations outside its own table, returning an error rather than
 * degrading. These pairs are the ones it accepts. */
export const TIMEFRAMES = {
  "1D": { range: "1d", interval: "1m" },
  "5D": { range: "5d", interval: "5m" },
  "1M": { range: "1mo", interval: "30m" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  YTD: { range: "ytd", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;

export function isTimeframe(v: string): v is Timeframe {
  return Object.prototype.hasOwnProperty.call(TIMEFRAMES, v);
}

/** OHLCV bars for a timeframe.
 *
 * Yahoo pads its arrays with nulls where a bar has no trades — holidays,
 * halts, thin pre-market minutes. Those are dropped rather than zero-filled: a
 * zero would draw a candle straight to the axis and read as a crash. */
export async function bars(symbol: string, tf: Timeframe): Promise<Bar[] | null> {
  const { range, interval } = TIMEFRAMES[tf];
  const intraday = interval.endsWith("m") || interval.endsWith("h");
  const ttl = intraday ? TTL.intradayBars : TTL.dailyBars;

  return cachedJson(`yb:${symbol.toUpperCase()}:${tf}`, ttl, async () => {
    const r = await chart(symbol, range, interval);
    const ts = r?.timestamp;
    const q = r?.indicators?.quote?.[0];
    if (!ts?.length || !q) return null;

    const out: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ t: ts[i]!, o, h, l, c, v: q.volume?.[i] ?? 0 });
    }
    return out.length ? out : null;
  });
}

/** Average daily volume over the last ~3 months of sessions.
 *
 * Computed from daily bars because the chart meta carries only the current
 * session's volume. "Volume vs average" is the whole point of showing volume
 * at all, and the average has to be real for the comparison to mean anything. */
export async function averageVolume(symbol: string): Promise<number | null> {
  return cachedJson(`yav:${symbol.toUpperCase()}`, TTL.dailyBars, async () => {
    const daily = await bars(symbol, "3M");
    if (!daily?.length) return null;
    const vols = daily.map((b) => b.v).filter((v) => v > 0);
    if (!vols.length) return null;
    return vols.reduce((s, v) => s + v, 0) / vols.length;
  });
}
