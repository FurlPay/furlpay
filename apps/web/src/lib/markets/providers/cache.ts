// ---------------------------------------------------------------------------
// Shared cache + fetch discipline for the market data providers.
//
// Every provider here is a free, public, unauthenticated endpoint. That makes
// them generous but not ours: SEC EDGAR publishes a 10 req/s ceiling and asks
// for a contactable User-Agent, and Yahoo's chart endpoint is undocumented and
// rate-limits by IP. Both are shared across every visitor to this site, so the
// cache is not a latency optimisation — it is what keeps us inside the limit.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";

/** How long each class of data stays fresh.
 *
 * Fundamentals move once a quarter, so caching them for a day costs nothing in
 * accuracy. Quotes are capped at 15s because a stale price on a trade surface
 * is the one kind of staleness a user can actually lose money to. */
export const TTL = {
  /** Intraday quote / last price. */
  quote: 15,
  /** Intraday OHLCV bars. */
  intradayBars: 300,
  /** Daily+ OHLCV bars — the last bar only changes at the close. */
  dailyBars: 21_600,
  /** XBRL company facts: a 10-K/10-Q lands once a quarter. */
  fundamentals: 86_400,
  /** Ticker -> CIK map. New listings are rare and we fail soft without them. */
  tickerMap: 604_800,
} as const;

/** Read-through cache. A miss, a cache error, or a failed fetch all end up in
 * the same place: `fetcher` runs and its result is returned. The cache is never
 * allowed to be the reason a page fails to render. */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>
): Promise<T | null> {
  const cacheKey = `mkt:${key}`;
  try {
    const hit = await kvGet<T>(cacheKey);
    if (hit !== null && hit !== undefined) return hit;
  } catch {
    // Redis unreachable. Fall through and fetch live rather than fail.
  }

  const fresh = await fetcher();
  if (fresh === null || fresh === undefined) return null;

  try {
    await kvSet(cacheKey, fresh, ttlSeconds);
  } catch {
    // Losing the write only costs us the next request's latency.
  }
  return fresh;
}

/** Fetch JSON with a hard timeout, returning null instead of throwing.
 *
 * A provider being down must degrade one section of the page, never take the
 * request with it. The caller distinguishes "no data" from "bad data" by
 * getting null, and renders an em-dash rather than a zero — a displayed 0 for
 * a P/E ratio reads as a real, remarkable number. */
export async function fetchJson<T>(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<T | null> {
  const { headers = {}, timeoutMs = 6_000 } = init;
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** SEC asks every automated client to identify itself with a contact address,
 * and returns 403 to clients that do not. This is that identifier. */
export const SEC_HEADERS = {
  "User-Agent": "FurlPay dev@furlpay.com",
  "Accept-Encoding": "gzip, deflate",
} as const;

export const BROWSER_UA = {
  "User-Agent": "Mozilla/5.0 (compatible; FurlPayMarkets/1.0; +https://furlpay.com)",
} as const;
