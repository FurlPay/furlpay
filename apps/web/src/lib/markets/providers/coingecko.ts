// ---------------------------------------------------------------------------
// CoinGecko — the fundamentals half of a crypto quote.
//
// A coin has no filings, so the SEC path returns nothing for all 101 of them
// and the statistics grid on a crypto page came up empty. What a coin has
// instead is supply: circulating, total and maximum. Those are the numbers the
// equity page gets from a cover page, and they answer the same question —
// market cap is a price times a count either way, and the gap between
// circulating and maximum supply is a coin's dilution schedule.
//
// The catalog already carries a CoinGecko id per coin, and `quotes.ts` already
// calls the same endpoint for prices and throws the rest of each record away.
// This reads the fields it discards.
//
// Free tier, no key: roughly 30 calls a minute from an IP, shared across every
// visitor. Everything here is cached.
// ---------------------------------------------------------------------------

import { CATALOG } from "@/lib/markets/catalog";
import { BROWSER_UA, cachedJson, fetchJson, TTL } from "./cache";

interface MarketsRow {
  id: string;
  symbol?: string;
  name?: string;
  current_price?: number | null;
  market_cap?: number | null;
  fully_diluted_valuation?: number | null;
  total_volume?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number | null;
  ath_date?: string | null;
  atl?: number | null;
  atl_date?: string | null;
  market_cap_rank?: number | null;
}

export interface CryptoStats {
  marketCap: number | null;
  /** Market cap at maximum supply — what the coin is worth fully diluted. */
  fullyDilutedValuation: number | null;
  volume24h: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  athPrice: number | null;
  athDate: string | null;
  atlPrice: number | null;
  atlDate: string | null;
  marketCapRank: number | null;
}

/** A number CoinGecko actually reported.
 *
 * The API returns null for fields it does not have — a coin with no hard cap
 * has `max_supply: null`, which is a real fact about the coin and not a
 * missing value to paper over. It also returns 0 for some, and a 0 supply or
 * a 0 all-time high is never true of a listed coin, so both are treated as
 * absent rather than shown. */
function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function rowToStats(d: MarketsRow): CryptoStats {
  return {
    marketCap: positive(d.market_cap),
    fullyDilutedValuation: positive(d.fully_diluted_valuation),
    volume24h: positive(d.total_volume),
    circulatingSupply: positive(d.circulating_supply),
    totalSupply: positive(d.total_supply),
    maxSupply: positive(d.max_supply),
    athPrice: positive(d.ath),
    athDate: d.ath_date ?? null,
    atlPrice: positive(d.atl),
    atlDate: d.atl_date ?? null,
    marketCapRank: positive(d.market_cap_rank),
  };
}

/** Every catalog coin in one response, keyed by CoinGecko id.
 *
 * Batched rather than fetched per coin, and that is a correctness decision as
 * much as a latency one. The free tier allows roughly thirty calls a minute
 * from an IP, shared across every visitor to the site — so one call per coin
 * page means the hundredth reader of the minute gets a 429 and an empty
 * statistics grid, with nothing on screen distinguishing "rate limited" from
 * "this coin has no supply data". `coins/markets` takes up to 250 ids at once
 * and the catalog holds 101, so the whole set costs a single request.
 *
 * `quotes.ts` already calls this endpoint for prices and discards these
 * fields; the two are kept separate because they cache on different clocks. */
async function allCoinStats(): Promise<Record<string, CryptoStats> | null> {
  return cachedJson("cg:markets", TTL.quote, async () => {
    const ids = CATALOG.filter((a) => a.kind === "crypto" && a.cg).map((a) => a.cg!);
    if (!ids.length) return null;

    const rows = await fetchJson<MarketsRow[]>(
      "https://api.coingecko.com/api/v3/coins/markets" +
        `?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&per_page=250&sparkline=false`,
      { headers: BROWSER_UA, timeoutMs: 12_000 }
    );
    if (!Array.isArray(rows) || !rows.length) return null;

    const out: Record<string, CryptoStats> = {};
    for (const d of rows) if (d?.id) out[d.id] = rowToStats(d);
    return out;
  });
}

/** Supply, valuation and all-time extremes for one coin.
 *
 * Cached for the quote TTL rather than the fundamentals TTL: supply figures
 * for an inflationary chain move continuously, and market cap moves with the
 * price, so a day-long cache would be a day-old market cap. */
export async function cryptoStatsFor(cgId: string): Promise<CryptoStats | null> {
  const all = await allCoinStats();
  return all?.[cgId] ?? null;
}
