// ---------------------------------------------------------------------------
// Commodities and currencies as rows in the markets table.
//
// Gold, silver, copper, the two crude grades, natural gas and seven FX pairs
// were reachable at /markets/<symbol> and findable by search, but they were not
// IN the table — so nobody browsing /markets ever discovered they existed. This
// module makes them rows.
//
// WHAT IS AND IS NOT INCLUDED. Commodities and FX only. Indices and the
// ten-year are already carried by MarketOverview at the top of the same page,
// and listing the S&P 500 as a row beneath Apple invites a reader to compare a
// level with a share price.
//
// WHY THIS FETCHES A MONTH OF DAILY CLOSES rather than reusing instrumentQuote:
// the table has a seven-day column and a sparkline, and neither can be derived
// from a single quote. Taking the series also removes the trap documented on
// instrumentQuote's RANGE constant — `chartPreviousClose` is the close before
// the START of the requested window, so reading it from a one-month request
// yields a MONTHLY return labelled as a daily one. Here the prior close is the
// second-to-last observation in the series, which is that day's close no matter
// what window was asked for.
//
// FAILURE IS PARTIAL, NEVER FATAL. Yahoo rate-limiting one symbol must cost the
// table that row, not the page. Every field that did not arrive stays null and
// renders as an em-dash; nothing here is ever defaulted to zero.
// ---------------------------------------------------------------------------

import { cachedJson, TTL, BROWSER_UA } from "./providers/cache";
import { INSTRUMENTS, type MarketInstrument } from "./instruments";
import type { TableRow } from "./table";

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/** The instruments that appear as table rows, in the order they appear. */
export const TABLE_INSTRUMENTS: MarketInstrument[] = INSTRUMENTS.filter(
  (i) => i.assetClass === "commodity" || i.assetClass === "fx"
);

/** Human label for the category badge under the name. Not a sector: a currency
 *  pair has no sector, and reusing that column's equity meaning would be a
 *  small lie repeated on every row. */
export function instrumentCategory(i: MarketInstrument): string {
  if (i.assetClass === "fx") return "Currency pair";
  if (["XAUUSD", "XAGUSD"].includes(i.symbol)) return "Precious metal";
  if (i.symbol === "COPPERUSD") return "Industrial metal";
  return "Energy";
}

interface Series {
  price: number | null;
  closes: number[];
  volume: number | null;
}

/** Closes with the gaps removed. Yahoo pads holidays with nulls, and a null
 *  inside a sparkline is a hole, not a zero. */
async function series(inst: MarketInstrument): Promise<Series | null> {
  return cachedJson<Series>(`instrow:v1:${inst.providerSymbol}`, TTL.quote, async () => {
    try {
      const res = await fetch(
        `${CHART}/${encodeURIComponent(inst.providerSymbol)}?range=1mo&interval=1d`,
        { headers: BROWSER_UA, signal: AbortSignal.timeout(8_000), cache: "no-store" }
      );
      if (!res.ok) return null;
      const j = (await res.json()) as {
        chart?: {
          result?: {
            meta?: { regularMarketPrice?: number; regularMarketVolume?: number };
            indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] };
          }[];
        };
      };
      const r = j.chart?.result?.[0];
      if (!r) return null;
      const closes = (r.indicators?.quote?.[0]?.close ?? []).filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v)
      );
      const price =
        typeof r.meta?.regularMarketPrice === "number"
          ? r.meta.regularMarketPrice
          : (closes[closes.length - 1] ?? null);
      const volume =
        typeof r.meta?.regularMarketVolume === "number" ? r.meta.regularMarketVolume : null;
      return { price, closes, volume };
    } catch {
      return null;
    }
  });
}

/** Percent change between two prices, or null. Never divides by zero — an
 *  Infinity here renders as a very confident nonsense. */
function pctChange(from: number | undefined, to: number | null): number | null {
  if (from === undefined || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * Build the instrument rows.
 *
 * `startRank` places them after the curated catalog under the default
 * popularity sort. That ordering is a statement about the catalog's editorial
 * ranking, not about gold — and gold has no position in an equity ranking.
 */
export async function instrumentRows(startRank: number): Promise<TableRow[]> {
  const settled = await Promise.all(
    TABLE_INSTRUMENTS.map(async (inst) => {
      const s = await series(inst).catch(() => null);
      return { inst, s };
    })
  );

  return settled.map(({ inst, s }, i) => {
    const closes = s?.closes ?? [];
    const price = s?.price ?? null;
    // The close BEFORE the latest one. Correct regardless of the window asked
    // for, which is the whole reason this reads the series and not the meta.
    const prev = closes.length >= 2 ? closes[closes.length - 2] : undefined;
    // Five sessions back is a trading week. Calendar days would land on a
    // weekend and silently compare against a different number of sessions.
    const weekAgo = closes.length >= 6 ? closes[closes.length - 6] : undefined;

    return {
      symbol: inst.symbol,
      name: inst.displayName,
      kind: "instrument" as const,
      category: instrumentCategory(inst),
      logo: inst.logo ?? null,
      rank: startRank + i,
      price,
      changePct: pctChange(prev, price),
      changePct7d: pctChange(weekAgo, price),
      // Nothing here has a market cap. A commodity has no shares outstanding
      // and a currency pair has no issuer; a number in this column would have
      // to be invented.
      marketCap: null,
      // The flag decides, not the payload: the provider returns 0 for FX
      // volume, and 0 reads as "nothing traded today".
      volume24h: inst.volumeSupported ? (s?.volume ?? null) : null,
      spark: closes.length >= 2 ? closes : null,
      live: price !== null,
    };
  });
}
