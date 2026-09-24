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
  /** Symbol search results. Long-tailed traffic, and a listing does not appear
   * or vanish within an hour. */
  search: 3_600,
  /** "Does this symbol exist at all", for a symbol that DOES. */
  symbolExists: 21_600,
  /**
   * The same question, for a symbol that does not.
   *
   * SHORT ON PURPOSE. This key is minted from a URL path segment gated only by
   * a format regex that admits ~10^12 strings, so its cardinality is set by
   * whoever is sending requests rather than by how many tickers exist. At the
   * 6-hour TTL the positive answers use, a crawler walking /markets/<random>
   * fills a 256MB store in about a million requests — all of them recording
   * that something does not exist.
   *
   * Two minutes still absorbs the burst this cache was added for (a crawler
   * re-requesting the same miss, and the retry storm behind one page load),
   * which is the part that actually protected the IP-rate-limited upstream.
   * What it no longer does is retain a million distinct negatives for a
   * quarter of a day.
   */
  symbolMissing: 120,
} as const;

/** Read-through cache. A miss, a cache error, or a failed fetch all end up in
 * the same place: `fetcher` runs and its result is returned. The cache is never
 * allowed to be the reason a page fails to render.
 *
 * `ttlSeconds` may be a FUNCTION of the fetched value, and that exists for one
 * specific hazard: a cache keyed on something the caller does not control the
 * cardinality of.
 *
 * `resolve:{SYMBOL}` is the case. Its key comes from a URL path segment, and
 * the only gate is a format check — `^[A-Z0-9]{1,8}(?:[.-][A-Z0-9]{1,4})?$`,
 * which admits on the order of 10^12 distinct strings. That regex bounds the
 * SHAPE of a key, not how many of them exist, so a crawler walking
 * /markets/<random> mints a new 6-hour key on every request. Roughly a million
 * requests is enough to fill a 256MB store, and every one of those keys is a
 * negative answer — a record that something does not exist.
 *
 * Caching that negative is still worth doing (it is what stops the same
 * crawler becoming one upstream request per miss, against an IP-rate-limited
 * endpoint shared with real users). It is just not worth doing for six hours.
 * A per-result TTL lets a real symbol stay cached while an unknown one expires
 * quickly. */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number | ((value: T) => number),
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
    await kvSet(cacheKey, fresh, typeof ttlSeconds === "function" ? ttlSeconds(fresh) : ttlSeconds);
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
