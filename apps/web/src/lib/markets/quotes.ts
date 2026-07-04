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
      out.set(a.symbol, { price: d.current_price, changePct: d.price_change_percentage_24h ?? 0, live: true });
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
        out.set(a.symbol, { price, changePct: ((price - prev) / prev) * 100, live: true });
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
        out.set(a.symbol, { price: close, changePct: ((close - prev) / prev) * 100, live: true });
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
    for (const [sym, q] of Object.entries(seeds as Record<string, { price: number; changePct: number }>)) {
      quotes.set(sym, { ...q, live: false });
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

export async function quoteFor(symbol: string): Promise<Quote | undefined> {
  return (await getQuotes()).get(symbol.toUpperCase());
}
