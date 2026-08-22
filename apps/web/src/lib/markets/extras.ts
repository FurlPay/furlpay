// ---------------------------------------------------------------------------
// Market EXTRAS — the columns a professional asset table has beyond price:
// market cap, 24h volume, the seven-day move, and the sparkline shape.
//
// Separate from quotes.ts on purpose. That module answers "what does this cost
// right now" on a 60-second budget and is on the critical path of every market
// surface. These four fields move slowly, cost more to gather, and are only
// wanted by the table — so they get their own cache with its own TTL, and the
// price strip never waits on them.
//
// Every field is nullable and every source is real:
//
//   crypto    CoinGecko /coins/markets — one request returns cap, 24h volume,
//             the 7d change and a 168-point 7d sparkline for all 100 coins.
//   equities  Yahoo v7 batch quote (providers/yahooBatch) for cap + session
//             volume, and the Yahoo spark endpoint at 1mo/1d for the 7d move
//             and the sparkline. An ETF has no market cap to report and gets
//             null, which the table draws as an em-dash.
//
// Nothing here synthesises a series. The sparkline the table renders is closing
// prices; when a symbol has no history the chart cell is left empty rather than
// filled with a plausible-looking invented line.
// ---------------------------------------------------------------------------

import { CATALOG, type MarketAsset } from "./catalog";
import { quoteKey, AMBIGUOUS_SYMBOLS } from "./quotes";
import { yahooSymbolFor } from "./providers";
import { batchQuotes } from "./providers/yahooBatch";

export interface AssetExtras {
  /** Shares/coins outstanding times price. Null for ETFs and anything
   *  the provider does not report. */
  marketCap: number | null;
  /** Traded value (crypto, USD) or share count (equities) over 24h/session. */
  volume24h: number | null;
  /** Seven-day price change, in percent. */
  changePct7d: number | null;
  /** Closing prices, oldest to newest. At least 2 points, or null. */
  spark: number[] | null;
}

const TTL_MS = 180_000;
const FETCH_TIMEOUT_MS = 8_000;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; FurlpayMarkets/1.0)" };

let cache: { at: number; extras: Map<string, AssetExtras> } | null = null;
let inflight: Promise<Map<string, AssetExtras>> | null = null;

function empty(): AssetExtras {
  return { marketCap: null, volume24h: null, changePct7d: null, spark: null };
}

/** Write under the canonical `kind:symbol` key plus the bare alias when the
 *  ticker is unambiguous — identical to the quote map rules, so STX and DASH
 *  cannot cross-contaminate between an equity and a coin. */
function put(map: Map<string, AssetExtras>, a: MarketAsset, e: AssetExtras): void {
  map.set(quoteKey(a), e);
  if (!AMBIGUOUS_SYMBOLS.has(a.symbol)) map.set(a.symbol, e);
}

/** Look up an asset extras record. Always prefer this over map.get(symbol). */
export function resolveExtras(
  map: Map<string, AssetExtras>,
  a: { kind: string; symbol: string }
): AssetExtras {
  return map.get(quoteKey(a)) ?? map.get(a.symbol) ?? empty();
}

// ---------------------------------------------------------------------------
// Crypto — one CoinGecko request covers cap, volume, 7d move and sparkline.
// ---------------------------------------------------------------------------

interface CgRow {
  id: string;
  market_cap?: number | null;
  total_volume?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price?: number[] } | null;
}

async function cryptoExtras(): Promise<Map<string, AssetExtras>> {
  const out = new Map<string, AssetExtras>();
  const assets = CATALOG.filter((a) => a.kind === "crypto" && a.cg);
  if (!assets.length) return out;

  const ids = assets.map((a) => a.cg as string).join(",");
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets" +
      `?vs_currency=usd&ids=${encodeURIComponent(ids)}&per_page=250` +
      "&sparkline=true&price_change_percentage=7d",
    { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`coingecko markets ${res.status}`);
  const rows = (await res.json()) as CgRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const a of assets) {
    const r = byId.get(a.cg as string);
    if (!r) continue;
    // 168 hourly points is more than a 60px sparkline can show; thin it to a
    // readable ~40 so the payload stays small and the path stays smooth.
    put(out, a, {
      marketCap: positive(r.market_cap),
      volume24h: positive(r.total_volume),
      changePct7d: finite(r.price_change_percentage_7d_in_currency),
      spark: thin(r.sparkline_in_7d?.price, 40),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Equities and ETFs — cap + volume from the batch quote, shape + 7d from spark.
// ---------------------------------------------------------------------------

interface SparkRow {
  close?: (number | null)[];
}

/** One month of daily closes for many symbols, in chunks of 20. */
async function sparkSeries(symbols: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    try {
      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/spark" +
          `?symbols=${encodeURIComponent(chunk.join(","))}&range=1mo&interval=1d`,
        { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, SparkRow>;
      for (const [sym, row] of Object.entries(data)) {
        const closes = (row?.close ?? []).filter(
          (c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0
        );
        if (closes.length >= 2) out.set(sym, closes);
      }
    } catch {
      // One bad chunk blanks 20 sparklines, not the whole table.
    }
  }
  return out;
}

async function equityExtras(): Promise<Map<string, AssetExtras>> {
  const out = new Map<string, AssetExtras>();
  const assets = CATALOG.filter((a) => a.kind !== "crypto");
  if (!assets.length) return out;

  // Catalog symbol -> Yahoo spelling (BRK.B -> BRK-B), and the way back.
  const yahooFor = new Map(assets.map((a) => [a.symbol, yahooSymbolFor(a.symbol, a.kind)]));
  const symbols = [...new Set(yahooFor.values())];

  const [quotes, series] = await Promise.all([
    batchQuotes(symbols).catch(() => new Map<string, { marketCap: number | null; volume: number | null }>()),
    sparkSeries(symbols).catch(() => new Map<string, number[]>()),
  ]);

  for (const a of assets) {
    const y = yahooFor.get(a.symbol) as string;
    const q = quotes.get(y);
    const closes = series.get(y);
    put(out, a, {
      // An ETF reports net assets, not a market cap; Yahoo omits the field and
      // it stays null rather than borrowing the fund AUM as if it were one.
      marketCap: q?.marketCap ?? null,
      volume24h: q?.volume ?? null,
      changePct7d: weekChange(closes),
      spark: thin(closes, 40),
    });
  }
  return out;
}

/**
 * Percent change over the last five trading sessions.
 *
 * Five sessions, not five days: a calendar week contains two days on which no
 * equity trades, so comparing against the close seven entries ago would
 * silently report a nine-day move. Null when the series is too short to make
 * the comparison at all.
 */
function weekChange(closes: number[] | undefined): number | null {
  if (!closes || closes.length < 6) return null;
  const last = closes[closes.length - 1];
  const prior = closes[closes.length - 6];
  if (!prior) return null;
  return ((last - prior) / prior) * 100;
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function finite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Even-stride downsample. Keeps the first and last point, so the line still
 *  starts and ends where the real series did. */
function thin(series: number[] | undefined | null, target: number): number[] | null {
  if (!series || series.length < 2) return null;
  if (series.length <= target) return series.map(round);
  const step = (series.length - 1) / (target - 1);
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(round(series[Math.round(i * step)]));
  return out;
}

/** Six significant digits is more than any sparkline can draw and keeps the
 *  JSON payload from carrying float noise. */
function round(n: number): number {
  return Number(n.toPrecision(6));
}

/**
 * Extras for the whole catalog, cached and de-duplicated.
 *
 * Both halves are awaited with allSettled: CoinGecko rate-limiting must not
 * blank the equity columns, and a Yahoo outage must not blank the coins.
 */
export async function getExtras(): Promise<Map<string, AssetExtras>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.extras;
  if (inflight) return inflight;

  inflight = (async () => {
    const merged = new Map<string, AssetExtras>();
    const results = await Promise.allSettled([cryptoExtras(), equityExtras()]);
    for (const r of results) {
      if (r.status === "fulfilled") for (const [k, v] of r.value) merged.set(k, v);
    }
    // Never cache a total failure — the next request should try again rather
    // than serve three minutes of empty columns.
    if (merged.size > 0) cache = { at: Date.now(), extras: merged };
    return merged;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Test seam: forget the cached batch. */
export function __resetExtras(): void {
  cache = null;
  inflight = null;
}
