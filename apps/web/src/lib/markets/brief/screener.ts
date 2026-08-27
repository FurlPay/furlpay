// ---------------------------------------------------------------------------
// Yahoo's predefined screener — the only keyless source of a MARKET-WIDE board.
//
// WHY THIS ENDPOINT AND NOT THE ONES WE ALREADY HAD. `lib/markets/catalog.ts`
// is a curated list of a few hundred assets. Ranking it produces "the best
// performer among the names we happened to pick", which is a different claim
// from "the best performer in the US market" and reads identically once it is
// in a Discord embed. This endpoint screens the whole US equity universe.
//
// MEASURED 2026-08-28 against these exact URLs, no credentials, no cookies:
//
//     v1/finance/screener/predefined/saved?scrIds=day_gainers   -> 200
//     v1/finance/screener/predefined/saved?scrIds=day_losers    -> 200
//     v1/finance/screener/predefined/saved?scrIds=most_actives  -> 200
//     v7/finance/quote                                          -> 401 Unauthorized
//
// The v7 quote endpoint is dead to unauthenticated callers (already recorded in
// providers/yahoo.ts). The screener is not, and it returns far more per row
// than a quote does — 50/200-day averages, 3-month average volume, distance
// from the 52-week high — which is exactly the input a trend screen needs.
//
// WHAT THE SCREENS ACTUALLY MEAN. Each scrId carries server-side criteria, and
// they are not "every stock that went up". Read back from criteriaMeta on the
// same date:
//
//     day_gainers   percentchange > 3, region = US, price >= $5,
//                   day volume > 15,000, market cap in {small, mid, large}
//     day_losers    the mirror, percentchange < -2.5
//
// That is why `SCREEN_DEFINITIONS` exists and why the brief prints it. A count
// of 195 is not "195 advancing stocks" — it is "195 US names above $5 that
// moved more than 3%". Presenting the first as the second is the exact kind of
// plausible-but-wrong number this whole subsystem is written to avoid.
//
// UNDOCUMENTED AND UNOWNED. Every field is optional and read defensively; a
// shape change must blank one section of a post, never throw.
// ---------------------------------------------------------------------------

import { BROWSER_UA, cachedJson, fetchJson } from "../providers/cache";

const SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";

/** The screens this module will ask for. Anything else is rejected rather than
 *  passed through to the upstream, so a caller cannot turn this into an open
 *  proxy for arbitrary scrIds. */
export const SCREENS = {
  day_gainers: "Day gainers",
  day_losers: "Day losers",
  most_actives: "Most active",
  growth_technology_stocks: "Growth technology",
  undervalued_growth_stocks: "Undervalued growth",
} as const;

export type ScreenId = keyof typeof SCREENS;

/**
 * What each screen's server-side criteria actually are, read back from the
 * response's own `criteriaMeta` on 2026-08-28.
 *
 * Printed in the brief. A reader who sees "195" must be able to find out what
 * was counted without trusting our label for it.
 */
export const SCREEN_DEFINITIONS: Record<ScreenId, string> = {
  day_gainers: "US equities, price ≥ $5, day volume > 15k, up more than 3%",
  day_losers: "US equities, price ≥ $5, day volume > 15k, down more than 2.5%",
  most_actives: "US equities ranked by day volume",
  growth_technology_stocks: "US technology names screened on growth criteria",
  undervalued_growth_stocks: "US names screened on growth-at-a-discount criteria",
};

/**
 * One screener row.
 *
 * Every numeric is `number | null | undefined` on purpose. Yahoo omits fields
 * rather than nulling them, and a missing 50-day average read as 0 makes every
 * stock look like it is trading above its trend.
 */
export interface ScreenerQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  displayName?: string;
  currency?: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  averageDailyVolume3Month?: number;
  averageDailyVolume10Day?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  /** Percent from the 52-week high. Yahoo reports it NEGATIVE when below. */
  fiftyTwoWeekHighChangePercent?: number;
  fiftyTwoWeekChangePercent?: number;
  marketCap?: number;
  /** Epoch SECONDS of the company's earnings report. */
  earningsTimestamp?: number;
  /** True when Yahoo is GUESSING the date because the company has not
   *  announced one. The analysis engine discards those outright — treating an
   *  estimate as a report has the brief announce results nobody published. */
  isEarningsDateEstimate?: boolean;
  averageAnalystRating?: string;
  quoteType?: string;
  fullExchangeName?: string;
}

export interface ScreenResult {
  id: ScreenId;
  label: string;
  definition: string;
  quotes: ScreenerQuote[];
  /** How many rows the screen matched in total, not how many we asked for.
   *  This is the number the breadth line is built from. */
  total: number | null;
  fetchedAt: number;
}

interface ScreenerResponse {
  finance?: {
    result?: Array<{
      total?: number;
      count?: number;
      quotes?: ScreenerQuote[];
    }>;
    error?: unknown;
  };
}

/** Yahoo caps a single screener page well below this; asking for more silently
 *  returns fewer, so the ceiling is stated rather than discovered. */
const MAX_COUNT = 100;

/**
 * Fetch one predefined screen.
 *
 * Cached for 5 minutes. This runs once a day from cron, so the cache is not
 * for us — it is for the case where a manual `?dry=1` run and the scheduled run
 * land close together, and for the shared IP budget the rest of Markets uses
 * against the same host.
 */
export async function fetchScreen(id: ScreenId, count = 25): Promise<ScreenResult | null> {
  if (!(id in SCREENS)) return null;
  const size = Math.min(MAX_COUNT, Math.max(1, Math.floor(count)));

  return cachedJson(`screen:${id}:${size}`, 300, async () => {
    const url = `${SCREENER_URL}?scrIds=${encodeURIComponent(id)}&count=${size}`;
    const res = await fetchJson<ScreenerResponse>(url, { headers: BROWSER_UA, timeoutMs: 9_000 });
    const first = res?.finance?.result?.[0];
    if (!first || !Array.isArray(first.quotes)) return null;

    // Rows without a symbol or a price cannot be rendered or ranked. Dropped
    // here rather than defended against in four downstream places.
    const quotes = first.quotes.filter(
      (q): q is ScreenerQuote =>
        Boolean(q && typeof q.symbol === "string" && q.symbol.length > 0) &&
        typeof q.regularMarketPrice === "number" &&
        Number.isFinite(q.regularMarketPrice)
    );

    return {
      id,
      label: SCREENS[id],
      definition: SCREEN_DEFINITIONS[id],
      quotes,
      total: typeof first.total === "number" ? first.total : null,
      fetchedAt: Date.now(),
    } satisfies ScreenResult;
  });
}

/** A display name, preferring the shortest human one Yahoo offers. */
export function displayNameOf(q: ScreenerQuote): string {
  const name = q.shortName || q.displayName || q.longName || q.symbol;
  return name.length > 34 ? `${name.slice(0, 33)}…` : name;
}
