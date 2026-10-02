// ---------------------------------------------------------------------------
// One data shape for a price card, from two very different sources.
//
// SOL, ETH and BTC come from CoinGecko, which reports rank, market cap and an
// all-time high — facts that exist because a coin has a supply and a market.
// Gold has none of those: XAUUSD has no rank, no market cap and no circulating
// supply, and its price here is a COMEX futures quote rather than spot.
//
// Rather than invent the missing fields, `PriceCardData` makes every one of
// them nullable and the renderer draws a dash. A card that shows "Rank —" for
// gold is telling the truth; one that shows "#1" because gold feels important
// is not.
//
// ── ONE REQUEST FOR ALL COINS ──────────────────────────────────────────────
//
// CoinGecko's /coins/markets endpoint accepts a comma-separated id list and
// returns price, 24h high/low, rank, market cap, volume, ATH, the 1h/24h/7d
// changes and a 7-day sparkline in a single response. Three cards therefore
// cost one call rather than twelve, which matters on a free tier that rate
// limits by the minute.
// ---------------------------------------------------------------------------

import { cachedJson, BROWSER_UA } from "@/lib/markets/providers/cache";

const CG_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/** Prices move; a card regenerated within the minute is the same card. */
const TTL_MARKET = 60;
/** Seven days of history changes far more slowly than the last price. */
const TTL_HISTORY = 900;

export interface PriceCardData {
  /** Canonical symbol shown on the card: SOL, ETH, BTC, XAUUSD. */
  symbol: string;
  name: string;
  /** Sub-label under the name, e.g. "SOL / USD". */
  pair: string;
  price: number;
  changePct24h: number | null;
  changePct1h: number | null;
  changePct7d: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Null for anything that is not a ranked coin. */
  rank: number | null;
  marketCap: number | null;
  volume24h: number | null;
  athPrice: number | null;
  /** Percent below the all-time high. Null when there is no ATH to compare to. */
  fromAthPct: number | null;
  /** Closing prices over roughly seven days, oldest first. */
  sparkline: number[];
  /** Accent colour for the card, taken from the asset's own brand. */
  accent: string;
  /** Where the numbers came from, shown on the card so it can be checked. */
  source: string;
  /**
   * The PROVIDER's timestamp for the price (ISO, UTC) — not when the card was
   * drawn. The message timestamp says when FurlPay last ran; this says how old
   * the number it ran with was. Null when the provider gave none.
   */
  asOf?: string | null;
  /** Set when the quoted instrument is not what the symbol implies. */
  note: string | null;
  /**
   * How the price is denominated. An index level is a number of POINTS, not a
   * price in dollars: "$7,670.92" for the S&P 500 is a category error that
   * makes the number look like something you could buy one of.
   */
  unit: "usd" | "points";
  /** The window the sparkline actually covers, for its high/low labels. A
   *  label that says 7d over a month of data is a small, quiet lie. */
  sparklineLabel: string;
}

interface CgMarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  high_24h: number | null;
  low_24h: number | null;
  ath: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price?: number[] };
  last_updated?: string | null;
}

/**
 * Assets this card system knows how to draw, and how to reach each one.
 *
 * Adding one is a single line here: the renderer, the Discord layer and the
 * scheduler all iterate this map and none of them names an asset. Nothing about
 * the pipeline is specific to any one symbol.
 *
 * An index is an `instrument` rather than a `coin` because it genuinely is one:
 * it has no supply, no market cap, no rank and no all-time-high series from this
 * provider, and the card renders a dash for each rather than inventing them.
 */
export const CARD_ASSETS = {
  // ---- Indices ----
  SPX: { kind: "instrument", providerSymbol: "^GSPC", symbol: "SPX", name: "S&P 500", accent: "#4C8DFF" },
  NDX: { kind: "instrument", providerSymbol: "^IXIC", symbol: "NDX", name: "NASDAQ", accent: "#7C5CFF" },
  DJI: { kind: "instrument", providerSymbol: "^DJI", symbol: "DJI", name: "DOW", accent: "#38BDF8" },

  // ---- Crypto ----
  BTC: { kind: "coin", cgId: "bitcoin", symbol: "BTC", name: "Bitcoin", accent: "#F7931A" },
  ETH: { kind: "coin", cgId: "ethereum", symbol: "ETH", name: "Ethereum", accent: "#8A92B2" },
  SOL: { kind: "coin", cgId: "solana", symbol: "SOL", name: "Solana", accent: "#14F195" },

  // ---- Commodities ----
  XAUUSD: { kind: "instrument", providerSymbol: "GC=F", symbol: "XAUUSD", name: "Gold", accent: "#D4AF37" },
} as const;

/** Display order for a channel that carries every card. Indices, then crypto,
 *  then commodities — the order a market reader scans in. */
export const CARD_ORDER: CardSymbol[] = ["SPX", "NDX", "DJI", "BTC", "ETH", "SOL", "XAUUSD"];

export type CardSymbol = keyof typeof CARD_ASSETS;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Percent below the all-time high: (price / ath - 1) * 100.
 *
 * Null rather than 0 when there is no ATH: "0% from its high" is a strong
 * claim and an absent ATH is not evidence for it. */
export function calculateFromAth(price: number, ath: number | null): number | null {
  if (ath === null || !(ath > 0) || !(price > 0)) return null;
  return (price / ath - 1) * 100;
}

/** Fetch every coin card in one request. */
async function fetchCoins(ids: readonly string[]): Promise<Map<string, CgMarketRow>> {
  const key = `card:cg:${ids.join(",")}`;
  const rows = await cachedJson<CgMarketRow[]>(key, TTL_MARKET, async () => {
    try {
      const url =
        `${CG_MARKETS}?vs_currency=usd&ids=${ids.join(",")}` +
        `&order=market_cap_desc&sparkline=true` +
        `&price_change_percentage=1h,24h,7d`;
      const res = await fetch(url, {
        headers: BROWSER_UA,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const j = (await res.json()) as CgMarketRow[];
      return Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  });
  const out = new Map<string, CgMarketRow>();
  for (const r of rows ?? []) out.set(r.id, r);
  return out;
}

/** Daily closes for a non-coin instrument, used for its sparkline. */
async function fetchInstrumentHistory(providerSymbol: string): Promise<{
  closes: number[];
  price: number | null;
  high24h: number | null;
  low24h: number | null;
  prevClose: number | null;
  asOf?: string | null;
}> {
  const key = `card:hist:${providerSymbol}`;
  const got = await cachedJson<{
    closes: number[]; price: number | null; high24h: number | null;
    low24h: number | null; prevClose: number | null; asOf?: string | null;
  }>(key, TTL_HISTORY, async () => {
    // RETRIED, because this job runs ONCE A DAY. Every coin on a card comes
    // from one batched CoinGecko call, but each instrument is its own request
    // to Yahoo, and a single refused connection is the difference between a
    // card that updates and a card that silently keeps yesterday's number for
    // twenty-four hours. Observed on 2026-09-07: all four instrument fetches
    // failed together for a few seconds while CoinGecko answered normally, and
    // the run reported "no market data" for every index and for gold.
    //
    // Only transport failures and Yahoo's own 429/5xx are retried. A 404 means
    // the symbol is wrong, and repeating it just spends the budget slower.
    const chartOnce = async (): Promise<Response | null> => {
      try {
        return await fetch(
          `${YAHOO_CHART}/${encodeURIComponent(providerSymbol)}?range=1mo&interval=1d`,
          { headers: BROWSER_UA, signal: AbortSignal.timeout(12_000), cache: "no-store" }
        );
      } catch {
        return null;
      }
    };

    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
        res = await chartOnce();
        if (res && res.ok) break;
        if (res && res.status !== 429 && res.status < 500) break;
      }
      if (!res || !res.ok) return null;
      const j = (await res.json()) as {
        chart?: { result?: { meta?: Record<string, number>; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
      };
      const r = j.chart?.result?.[0];
      const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(
        (c): c is number => typeof c === "number" && Number.isFinite(c)
      );
      const m = r?.meta ?? {};
      return {
        closes,
        asOf: typeof m.regularMarketTime === "number" ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        price: num(m.regularMarketPrice),
        high24h: num(m.regularMarketDayHigh),
        low24h: num(m.regularMarketDayLow),
        // NOT meta.chartPreviousClose. That field is the close before the START
        // of the requested window, and this request asks for a month so the
        // sparkline has something to draw. Reading it here reported gold at
        // +9.62% "24h" when the real daily move was a fraction of that -- a
        // monthly return wearing a daily label. The prior SESSION's close is
        // the second-to-last element of the series itself.
        prevClose: closes.length >= 2 ? (closes[closes.length - 2] ?? null) : null,
      };
    } catch {
      return null;
    }
  });
  return got ?? { closes: [], price: null, high24h: null, low24h: null, prevClose: null };
}

/** Percent change between the first and last of a slice of closes. */
function pctOver(closes: readonly number[], bars: number): number | null {
  if (closes.length < bars + 1) return null;
  const a = closes[closes.length - 1 - bars];
  const b = closes[closes.length - 1];
  if (a === undefined || b === undefined || !(a > 0)) return null;
  return (b / a - 1) * 100;
}

/**
 * Build the card data for a set of symbols.
 *
 * Coins are fetched together; instruments are fetched individually because they
 * come from a different provider entirely. A symbol whose data cannot be
 * retrieved is omitted from the result rather than returned with zeros — the
 * caller then skips that card instead of posting one that reads $0.00.
 */
export async function getPriceCardData(
  symbols: readonly CardSymbol[]
): Promise<Map<CardSymbol, PriceCardData>> {
  const out = new Map<CardSymbol, PriceCardData>();

  const coinSymbols = symbols.filter((s) => CARD_ASSETS[s].kind === "coin");
  if (coinSymbols.length) {
    const ids = coinSymbols.map((s) => (CARD_ASSETS[s] as { cgId: string }).cgId);
    const rows = await fetchCoins(ids);
    for (const s of coinSymbols) {
      const spec = CARD_ASSETS[s] as { cgId: string; symbol: string; name: string; accent: string };
      const r = rows.get(spec.cgId);
      const price = num(r?.current_price);
      // No price, no card. A card is a claim about a price.
      if (!r || price === null) continue;
      const ath = num(r.ath);
      out.set(s, {
        symbol: spec.symbol,
        name: spec.name,
        pair: `${spec.symbol} / USD`,
        price,
        changePct24h: num(r.price_change_percentage_24h_in_currency),
        changePct1h: num(r.price_change_percentage_1h_in_currency),
        changePct7d: num(r.price_change_percentage_7d_in_currency),
        high24h: num(r.high_24h),
        low24h: num(r.low_24h),
        rank: num(r.market_cap_rank),
        marketCap: num(r.market_cap),
        volume24h: num(r.total_volume),
        athPrice: ath,
        fromAthPct: calculateFromAth(price, ath),
        sparkline: (r.sparkline_in_7d?.price ?? []).filter(
          (p): p is number => typeof p === "number" && Number.isFinite(p)
        ),
        accent: spec.accent,
        source: "CoinGecko",
        asOf: typeof r.last_updated === "string" && !Number.isNaN(Date.parse(r.last_updated)) ? r.last_updated : null,
        note: null,
        unit: "usd",
        sparklineLabel: "7d",
      });
    }
  }

  for (const s of symbols.filter((x) => CARD_ASSETS[x].kind === "instrument")) {
    const spec = CARD_ASSETS[s] as {
      providerSymbol: string; symbol: string; name: string; accent: string;
    };
    const h = await fetchInstrumentHistory(spec.providerSymbol);
    const price = h.price ?? h.closes[h.closes.length - 1] ?? null;
    if (price === null) continue;
    const change24 = h.prevClose && h.prevClose > 0 ? (price / h.prevClose - 1) * 100 : null;
    // The whole month, not a week. Eight daily closes draw a jagged polyline
    // that looks like a data error rather than a chart; a month of daily bars
    // has enough points to read as a price series.
    const window = h.closes.slice(-22);
    const isIndex = spec.symbol !== "XAUUSD";
    out.set(s, {
      symbol: spec.symbol,
      name: spec.name,
      pair: spec.symbol === "XAUUSD" ? "XAU / USD" : `${spec.symbol} · INDEX`,
      price,
      changePct24h: change24,
      // No intraday series here, so there is no honest 1h number to show.
      changePct1h: null,
      changePct7d: pctOver(h.closes, 5),
      high24h: h.high24h,
      low24h: h.low24h,
      // Gold has no rank, no market cap and no all-time-high series here.
      rank: null,
      marketCap: null,
      volume24h: null,
      athPrice: null,
      fromAthPct: null,
      sparkline: window,
      accent: spec.accent,
      source: spec.symbol === "XAUUSD" ? "COMEX via Yahoo" : "Yahoo Finance",
      asOf: h.asOf ?? null,
      // An index is quoted in points; gold is quoted in dollars an ounce.
      unit: isIndex ? "points" : "usd",
      sparklineLabel: "30d",
      // Only gold carries a caveat: its symbol and the contract we can quote
      // are different instruments. An index is exactly what it says it is.
      note: spec.symbol === "XAUUSD" ? "Front-month futures, not spot" : null,
    });
  }

  return out;
}
