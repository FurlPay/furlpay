// ---------------------------------------------------------------------------
// Live market quotes. Equities: Alpaca Market Data snapshots (primary, when
// ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are configured — set via the
// Vercel env vault, never committed) with Yahoo spark as keyless fallback.
// Crypto: CoinGecko. Results are cached in-memory for 60s per server instance
// and always start from the baked seed prices, so a provider outage or rate
// limit degrades to recent-but-static data instead of failing.
// ---------------------------------------------------------------------------

import { CATALOG } from "./catalog";
import seeds from "./seed-prices.json";

export interface Quote {
  price: number;
  changePct: number;
  /** true when the number came from a live provider this cache window. */
  live: boolean;
}

// ---------------------------------------------------------------------------
// Quote cache keys.
//
// A ticker ALONE is not a unique asset. This catalog contains two collisions:
//   STX  → Seagate Technology (stock) AND Stacks (crypto)
//   DASH → DoorDash (stock)          AND Dash (crypto)
// Keyed by symbol only, the equities overlay ran after the crypto overlay and
// overwrote them, so /api/markets/STX reported Stacks at Seagate's $786.60 —
// a wrong price on a money surface. (CoinGecko documents the same hazard:
// "ALPACA" resolves to both `alpaca` and `alpaca-finance`; their guidance is to
// key on the provider's immutable id, never the ticker.)
//
// The map therefore carries `kind:symbol` for every asset, plus a bare `symbol`
// alias ONLY for tickers that are unambiguous. An ambiguous ticker has no bare
// alias at all: a caller that hasn't been migrated gets `undefined` (renders
// "—") instead of confidently showing the wrong asset's price. Failing visibly
// beats lying quietly about money.
// ---------------------------------------------------------------------------

/** Canonical cache key for an asset. */
export function quoteKey(a: { kind: string; symbol: string }): string {
  return `${a.kind}:${a.symbol}`;
}

/** Tickers claimed by more than one asset class — no bare-symbol alias. */
export const AMBIGUOUS_SYMBOLS: ReadonlySet<string> = (() => {
  const counts = new Map<string, number>();
  for (const a of CATALOG) counts.set(a.symbol, (counts.get(a.symbol) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([s]) => s));
})();

/** Look up an asset's quote. Always prefer this over quotes.get(symbol). */
export function resolveQuote(
  quotes: Map<string, Quote>,
  a: { kind: string; symbol: string }
): Quote | undefined {
  return quotes.get(quoteKey(a)) ?? quotes.get(a.symbol);
}

/** Write a quote under its canonical key, plus the bare alias when safe. */
function put(map: Map<string, Quote>, a: { kind: string; symbol: string }, q: Quote): void {
  map.set(quoteKey(a), q);
  if (!AMBIGUOUS_SYMBOLS.has(a.symbol)) map.set(a.symbol, q);
}

const TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; FurlpayMarkets/1.0)" };

let cache: { at: number; quotes: Map<string, Quote> } | null = null;
let inflight: Promise<Map<string, Quote>> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchCrypto(): Promise<Map<string, Quote>> {
  const assets = CATALOG.filter((a) => a.kind === "crypto" && a.cg);
  const ids = assets.map((a) => a.cg).join(",");
  const data = (await fetchJson(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=250&price_change_percentage=24h`
  )) as { id: string; current_price: number; price_change_percentage_24h: number | null }[];
  const byId = new Map(data.map((d) => [d.id, d]));
  const out = new Map<string, Quote>();
  for (const a of assets) {
    const d = byId.get(a.cg!);
    if (d && d.current_price > 0) {
      put(out, a, { price: d.current_price, changePct: d.price_change_percentage_24h ?? 0, live: true });
    }
  }
  return out;
}

// Alpaca Market Data (https://docs.alpaca.markets) — multi-symbol snapshots
// give latest trade + previous daily bar in one call. IEX feed on free plans.
async function fetchEquitiesAlpaca(): Promise<Map<string, Quote>> {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) throw new Error("Alpaca keys not configured");

  const assets = CATALOG.filter((a) => a.kind !== "crypto");
  const out = new Map<string, Quote>();
  for (let i = 0; i < assets.length; i += 100) {
    const chunk = assets.slice(i, i + 100);
    const symbols = chunk.map((a) => a.symbol).join(",");
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols)}&feed=iex`,
      {
        headers: { ...UA, "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) throw new Error(`Alpaca snapshots ${res.status}`);
    const data = (await res.json()) as Record<
      string,
      { latestTrade?: { p?: number }; dailyBar?: { c?: number }; prevDailyBar?: { c?: number } }
    >;
    for (const a of chunk) {
      const d = data[a.symbol];
      const price = d?.latestTrade?.p ?? d?.dailyBar?.c;
      const prev = d?.prevDailyBar?.c;
      if (price && prev) {
        put(out, a, { price, changePct: ((price - prev) / prev) * 100, live: true });
      }
    }
  }
  return out;
}

async function fetchEquitiesYahoo(): Promise<Map<string, Quote>> {
  const assets = CATALOG.filter((a) => a.kind !== "crypto");
  const out = new Map<string, Quote>();
  for (let i = 0; i < assets.length; i += 20) {
    const chunk = assets.slice(i, i + 20);
    const symbols = chunk.map((a) => a.yahoo ?? a.symbol).join(",");
    const data = (await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`
    )) as Record<string, { close?: (number | null)[]; chartPreviousClose?: number }>;
    for (const a of chunk) {
      const d = data[a.yahoo ?? a.symbol];
      const close = d?.close?.filter((v): v is number => v != null).at(-1);
      const prev = d?.chartPreviousClose;
      if (close && prev) {
        put(out, a, { price: close, changePct: ((close - prev) / prev) * 100, live: true });
      }
    }
  }
  return out;
}

// Alpaca first (real-time, keyed), Yahoo as the keyless fallback. A partial
// Alpaca result (IEX feed misses some symbols) is topped up from Yahoo only
// when it returned nothing at all — partial live data beats mixed providers.
async function fetchEquities(): Promise<Map<string, Quote>> {
  try {
    const alpaca = await fetchEquitiesAlpaca();
    if (alpaca.size > 0) return alpaca;
  } catch {
    /* not configured or unavailable → fall back */
  }
  return fetchEquitiesYahoo();
}

/** All quotes, seeded then overlaid with whatever live data is reachable. */
export async function getQuotes(): Promise<Map<string, Quote>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.quotes;
  if (inflight) return inflight;

  inflight = (async () => {
    const quotes = new Map<string, Quote>();
    // Seed through the catalog (not straight off the seed file's bare symbols)
    // so ambiguous tickers get their `kind:symbol` key here too — otherwise
    // STX/DASH would seed a bare alias that the live overlay never replaces.
    const seedTable = seeds as Record<string, { price: number; changePct: number }>;
    for (const a of CATALOG) {
      const q = seedTable[a.symbol];
      if (q) put(quotes, a, { ...q, live: false });
    }
    const [cg, yh] = await Promise.allSettled([fetchCrypto(), fetchEquities()]);
    if (cg.status === "fulfilled") for (const [k, v] of cg.value) quotes.set(k, v);
    if (yh.status === "fulfilled") for (const [k, v] of yh.value) quotes.set(k, v);
    cache = { at: Date.now(), quotes };
    return quotes;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Look up a quote by BARE TICKER.
 *
 * Cannot disambiguate: an ambiguous ticker (STX, DASH — see AMBIGUOUS_SYMBOLS)
 * has no bare alias in the cache, so this returns undefined for them by design
 * rather than guessing an asset class. When you have the asset object — and a
 * caller that resolved a ticker to a catalog entry always does — prefer
 * resolveQuote(quotes, asset), which is exact.
 */
export async function quoteFor(symbol: string): Promise<Quote | undefined> {
  return (await getQuotes()).get(symbol.toUpperCase());
}
