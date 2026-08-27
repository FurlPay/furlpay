// ---------------------------------------------------------------------------
// The bullishness score.
//
// THE PROBLEM WITH A "TOP PERFORMERS" LIST, and the reason this file is not
// just `sort by percent change`: the biggest percent gainer on any given day is
// usually a thin, low-float name that moved on nothing. Sorted purely by
// percent, a daily brief becomes a list of the market's least investable
// stocks, published under a headline that implies the opposite.
//
// So "bullish" is defined here as an explicit, measurable conjunction, not as a
// vibe:
//
//   MOMENTUM        it went up today
//   PARTICIPATION   on more volume than it normally trades — a move nobody
//                   took part in is a quote, not a trend
//   TREND           above its 50-day AND 200-day average — today's move is
//                   continuation, not a dead-cat bounce inside a downtrend
//   POSITION        near its 52-week high — the supply of trapped holders
//                   above the price is small
//
// FIVE RULES THIS FILE ENFORCES, each of which is a way the score could
// otherwise lie:
//
// 1. A MISSING INPUT SCORES NOTHING — it does not score zero. Yahoo omits
//    fields rather than nulling them. Reading an absent 50-day average as 0
//    puts every stock "above its trend" and hands the whole board to the rows
//    with the worst data. Each component returns null when its input is
//    absent, and `available` counts how many actually contributed.
//
// 2. TOO FEW INPUTS MEANS INELIGIBLE. A row scored on momentum alone would
//    beat a fully-measured row on a partial denominator. `MIN_COMPONENTS`
//    keeps a thinly-described stock off the board instead of flattering it.
//
// 3. EVERY COMPONENT IS BOUNDED. Relative volume of 40x is real and happens;
//    unbounded it would let one input outvote the other four combined.
//
// 4. LIQUIDITY FLOORS ARE APPLIED BEFORE SCORING, not after. A $0.39 stock
//    that ticked to $0.41 is +5% and would otherwise rank above every real
//    move on the board.
//
// 5. THE ORDER IS TOTAL. Score, then dollar volume, then symbol ascending —
//    which cannot tie. Two names at an identical score must not swap places
//    between two runs of the same job on the same data.
//
// WHAT THIS IS NOT: a recommendation, a signal, or a claim about tomorrow. It
// is a ranking of what four measurable properties say about today, and
// `reasons` carries the measurements so a reader can disagree with the weights.
// ---------------------------------------------------------------------------

import type { ScreenerQuote } from "./screener";

/** Weights. They sum to 100 so a score reads as a percentage of the maximum a
 *  fully-measured row could earn. */
export const WEIGHTS = {
  momentum: 30,
  participation: 25,
  trend50: 15,
  trend200: 15,
  position: 15,
} as const;

export const MAX_SCORE = 100;

/** How many of the five components must be measurable for a row to rank. */
export const MIN_COMPONENTS = 3;

/**
 * Liquidity floors.
 *
 * Deliberately stricter than the screen's own (price >= $5, volume > 15k). The
 * screen exists to find movement; this exists to keep a daily brief to names a
 * reader could actually act on.
 */
export interface LiquidityFloors {
  minPrice: number;
  minDollarVolume: number;
  minMarketCap: number;
}

export const DEFAULT_FLOORS: LiquidityFloors = {
  minPrice: 5,
  minDollarVolume: 5_000_000,
  minMarketCap: 300_000_000,
};

export type RejectReason =
  | "no_price"
  | "no_change"
  | "below_min_price"
  | "below_min_dollar_volume"
  | "below_min_market_cap"
  | "not_advancing"
  | "too_few_components";

export interface ScoreComponent {
  /** 0..1 before weighting. Null when the input to compute it is absent. */
  raw: number | null;
  /** Weighted contribution, 0 when raw is null. */
  points: number;
  /** The measurement, for the reader. Null when not measurable. */
  detail: string | null;
}

export interface ScoredQuote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number | null;
  dollarVolume: number;
  marketCap: number | null;
  /** 0..100, against a fixed denominator. A row that could not measure a
   *  component genuinely did not earn those points — the score is not
   *  rescaled to hide that, `available` reports it instead. */
  score: number;
  /** How many of the five components were measurable. */
  available: number;
  components: {
    momentum: ScoreComponent;
    participation: ScoreComponent;
    trend50: ScoreComponent;
    trend200: ScoreComponent;
    position: ScoreComponent;
  };
  /** Human-readable measurements behind the score, in weight order. */
  reasons: string[];
}

export interface RejectedQuote {
  symbol: string;
  reason: RejectReason;
}

/** Clamp to 0..1. */
function unit(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function component(raw: number | null, weight: number, detail: string | null): ScoreComponent {
  return { raw, points: raw === null ? 0 : unit(raw) * weight, detail };
}

/** Finite number or null. Guards against NaN and Infinity reaching a weight. */
function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Score one row.
 *
 * Returns a rejection rather than a low score when a row should not be on the
 * board at all — the difference matters, because a rejected row is countable
 * and explainable and a low-scored row silently occupies a slot.
 */
export function scoreQuote(
  q: ScreenerQuote,
  floors: LiquidityFloors = DEFAULT_FLOORS
): { ok: true; scored: ScoredQuote } | { ok: false; rejected: RejectedQuote } {
  const reject = (reason: RejectReason) => ({
    ok: false as const,
    rejected: { symbol: q.symbol, reason },
  });

  const price = num(q.regularMarketPrice);
  if (price === null || price <= 0) return reject("no_price");

  const changePercent = num(q.regularMarketChangePercent);
  if (changePercent === null) return reject("no_change");

  if (price < floors.minPrice) return reject("below_min_price");

  const volume = num(q.regularMarketVolume);
  // No volume is not zero volume. Without it there is no dollar volume to test
  // the floor against, so the row cannot clear a liquidity gate it was never
  // measured on.
  const dollarVolume = volume === null ? 0 : volume * price;
  if (dollarVolume < floors.minDollarVolume) return reject("below_min_dollar_volume");

  const marketCap = num(q.marketCap);
  if (marketCap === null || marketCap < floors.minMarketCap) return reject("below_min_market_cap");

  // The bullish board is a board of things going up. A stock can be above every
  // average and near its high and still be down 4% today; that is a fine stock
  // and the wrong list.
  if (changePercent <= 0) return reject("not_advancing");

  // ---- MOMENTUM --------------------------------------------------------
  // Saturating at +10%. Above that the move is more likely news-driven and
  // one-off than a trend worth ranking higher, and letting +40% earn four
  // times +10% is how the thin names climb back in through the weights.
  const momentum = component(
    unit(changePercent / 10),
    WEIGHTS.momentum,
    `+${changePercent.toFixed(2)}% today`
  );

  // ---- PARTICIPATION ---------------------------------------------------
  // Today's volume against its own 3-month average. 1x earns nothing, 3x earns
  // full marks. Self-normalising, so a mega-cap and a mid-cap are compared on
  // the same axis rather than on absolute share count.
  const avgVol = num(q.averageDailyVolume3Month);
  const relVolume = volume !== null && avgVol !== null && avgVol > 0 ? volume / avgVol : null;
  const participation = component(
    relVolume === null ? null : unit((relVolume - 1) / 2),
    WEIGHTS.participation,
    relVolume === null ? null : `${relVolume.toFixed(1)}x average volume`
  );

  // ---- TREND -----------------------------------------------------------
  // Binary on purpose. "How far above the 50-day" rewards a stock that has
  // already gone parabolic, which is the opposite of what a trend filter is
  // for. Above or not above is the question.
  const ma50 = num(q.fiftyDayAverage);
  const ma200 = num(q.twoHundredDayAverage);
  const trend50 = component(
    ma50 === null || ma50 <= 0 ? null : price > ma50 ? 1 : 0,
    WEIGHTS.trend50,
    ma50 === null || ma50 <= 0 ? null : price > ma50 ? "above 50-day avg" : "below 50-day avg"
  );
  const trend200 = component(
    ma200 === null || ma200 <= 0 ? null : price > ma200 ? 1 : 0,
    WEIGHTS.trend200,
    ma200 === null || ma200 <= 0 ? null : price > ma200 ? "above 200-day avg" : "below 200-day avg"
  );

  // ---- POSITION --------------------------------------------------------
  // Distance below the 52-week high, which Yahoo reports negative. At the high
  // earns full marks, 20% below earns nothing. A stock can print ABOVE the
  // stored high intraday, which makes this positive — clamped, not treated as
  // an error.
  const fromHigh = num(q.fiftyTwoWeekHighChangePercent);
  const position = component(
    fromHigh === null ? null : unit(1 - Math.abs(Math.min(0, fromHigh)) / 20),
    WEIGHTS.position,
    fromHigh === null
      ? null
      : fromHigh >= 0
        ? "at 52-week high"
        : `${Math.abs(fromHigh).toFixed(1)}% below 52-week high`
  );

  const components = { momentum, participation, trend50, trend200, position };
  const available = Object.values(components).filter((c) => c.raw !== null).length;
  if (available < MIN_COMPONENTS) return reject("too_few_components");

  const score = Object.values(components).reduce((sum, c) => sum + c.points, 0);
  const reasons = Object.values(components)
    .map((c) => c.detail)
    .filter((d): d is string => d !== null);

  return {
    ok: true,
    scored: {
      symbol: q.symbol,
      name: q.shortName || q.displayName || q.longName || q.symbol,
      price,
      changePercent,
      volume,
      dollarVolume,
      marketCap,
      score: Math.round(score * 10) / 10,
      available,
      components,
      reasons,
    },
  };
}

export interface RankedBoard {
  rows: ScoredQuote[];
  /** Everything considered, before floors. */
  considered: number;
  /** Why rows did not rank, by reason. An empty board is explainable. */
  rejected: Partial<Record<RejectReason, number>>;
}

/**
 * Rank a set of screener rows into a bullish board.
 *
 * Deduplicates by symbol — the same name legitimately appears in both
 * `day_gainers` and `most_actives`, and without this it would occupy two slots
 * on one leaderboard.
 */
export function rankBullish(
  quotes: Iterable<ScreenerQuote>,
  limit: number,
  floors: LiquidityFloors = DEFAULT_FLOORS
): RankedBoard {
  const rejected: Partial<Record<RejectReason, number>> = {};
  const bySymbol = new Map<string, ScoredQuote>();
  let considered = 0;

  for (const q of quotes) {
    considered++;
    const outcome = scoreQuote(q, floors);
    if (!outcome.ok) {
      const r = outcome.rejected.reason;
      rejected[r] = (rejected[r] ?? 0) + 1;
      continue;
    }
    const existing = bySymbol.get(outcome.scored.symbol);
    // Same symbol from two screens: keep the better-measured copy, and on a tie
    // there the higher score. Deterministic either way.
    if (
      !existing ||
      outcome.scored.available > existing.available ||
      (outcome.scored.available === existing.available && outcome.scored.score > existing.score)
    ) {
      bySymbol.set(outcome.scored.symbol, outcome.scored);
    }
  }

  const rows = [...bySymbol.values()]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.dollarVolume !== b.dollarVolume) return b.dollarVolume - a.dollarVolume;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, Math.max(0, limit));

  return { rows, considered, rejected };
}
