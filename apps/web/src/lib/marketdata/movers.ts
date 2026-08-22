// ---------------------------------------------------------------------------
// The movers engine: eligibility, ranking, and top-K.
//
// TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE.
//
// 1. DETERMINISM. The same set of symbol states must produce the same
//    leaderboard every time, in every process. That means a total order —
//    every comparison ends in a tie-break that cannot itself tie. Without one,
//    two symbols at exactly +4.82% swap places between renders and a reader
//    watches a leaderboard shuffle with no market behind it.
//
// 2. NOTHING RANKS THAT CANNOT BE JUSTIFIED. A symbol reaches a leaderboard
//    only by passing an explicit eligibility gate, and every rejection carries
//    a reason. The failure mode this prevents is specific: a stale price left
//    at the top of Top Gainers because it was high an hour ago, presented
//    beside genuinely live rows and indistinguishable from them.
//
// ON "MOST ACTIVE", AND WHY IT IS GATED. Our entitlement is the IEX feed —
// measured at 1.97%-3.50% of consolidated volume depending on the symbol (see
// types.ts). Because that share VARIES by symbol, IEX volume cannot be scaled
// into market volume; ranking by it answers "which stock traded most on IEX".
// `rank()` therefore refuses a volume-based board unless the volume it holds
// came from a consolidated source, rather than quietly producing a plausible
// wrong list.
// ---------------------------------------------------------------------------

import {
  DEFAULT_ELIGIBILITY,
  FEED_COVERAGE,
  freshnessOf,
  type EligibilityPolicy,
  type Freshness,
  type IneligibleReason,
} from "./types";
import { changeOf, changePercentOf, type SymbolState } from "./symbolState";

export type MoverBoard =
  | "gainers"
  | "losers"
  | "most_active_volume"
  | "most_active_dollar"
  | "biggest_change";

export interface MoverRow {
  rank: number;
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  dollarVolume: number;
  freshness: Freshness;
  /** True when the state is known-incomplete after a dropped message. */
  incomplete: boolean;
  /** The exchange timestamp behind this row — what "updated Xs ago" means. */
  asOf: number | null;
}

export interface RankResult {
  board: MoverBoard;
  rows: MoverRow[];
  /** Symbols considered before eligibility. */
  universe: number;
  /** Symbols that passed. */
  eligible: number;
  /** Why the rest did not, by reason. Surfaced so an empty board is
   *  explainable rather than mysterious. */
  excluded: Partial<Record<IneligibleReason, number>>;
  /** Populated when the board cannot honestly be produced at all. */
  unavailable: { reason: string; detail: string } | null;
  computedAt: number;
}

export interface EligibilityOutcome {
  ok: boolean;
  reason?: IneligibleReason;
}

/**
 * Can this symbol appear on a leaderboard at all?
 *
 * Order matters: the most fundamental disqualification is reported, so a
 * caller debugging an empty board is told "no previous close" rather than
 * "below minimum volume" for a symbol that has neither.
 */
export function checkEligibility(
  s: SymbolState,
  now: number,
  policy: EligibilityPolicy = DEFAULT_ELIGIBILITY
): EligibilityOutcome {
  if (s.lastPrice == null) return { ok: false, reason: "no_price" };
  if (s.previousClose == null) return { ok: false, reason: "no_previous_close" };
  if (!(s.lastPrice > 0) || !(s.previousClose > 0)) return { ok: false, reason: "non_positive" };

  // A halted symbol's last price is real but frozen. Leaving it in a live
  // leaderboard presents a stopped clock as market movement.
  if (s.status === "halted") return { ok: false, reason: "halted" };

  const freshness = freshnessOf(s.lastExchangeTimestamp, now, policy.freshness);
  if (freshness === "stale") return { ok: false, reason: "stale" };
  // No timestamp means no basis to judge. Excluded rather than assumed fresh —
  // assuming would let an unstamped feed sit permanently at the top.
  if (freshness === "unknown") return { ok: false, reason: "unknown_freshness" };
  if (freshness === "degraded" && !policy.allowDegraded) return { ok: false, reason: "stale" };

  if (s.lastPrice < policy.minPrice) return { ok: false, reason: "below_min_price" };
  if (s.volume < policy.minVolume) return { ok: false, reason: "below_min_volume" };
  if (s.dollarVolume < policy.minDollarVolume) return { ok: false, reason: "below_min_dollar_volume" };

  return { ok: true };
}

/**
 * The comparator for a board.
 *
 * Every one ends in `symbol` ascending, which cannot tie — that is what makes
 * the order total and the output reproducible. The middle tie-break is dollar
 * volume: between two symbols up the same percent, the one that actually
 * traded is the more interesting answer.
 */
function comparatorFor(board: MoverBoard): (a: SymbolState, b: SymbolState) => number {
  const byDollarThenSymbol = (a: SymbolState, b: SymbolState): number => {
    if (a.dollarVolume !== b.dollarVolume) return b.dollarVolume - a.dollarVolume;
    return a.symbol.localeCompare(b.symbol);
  };

  switch (board) {
    case "gainers":
      return (a, b) => {
        const pa = changePercentOf(a) ?? 0;
        const pb = changePercentOf(b) ?? 0;
        if (pa !== pb) return pb - pa;
        return byDollarThenSymbol(a, b);
      };
    case "losers":
      return (a, b) => {
        const pa = changePercentOf(a) ?? 0;
        const pb = changePercentOf(b) ?? 0;
        if (pa !== pb) return pa - pb;
        return byDollarThenSymbol(a, b);
      };
    case "most_active_volume":
      return (a, b) => {
        if (a.volume !== b.volume) return b.volume - a.volume;
        return a.symbol.localeCompare(b.symbol);
      };
    case "most_active_dollar":
      return (a, b) => byDollarThenSymbol(a, b);
    case "biggest_change":
      return (a, b) => {
        const ca = Math.abs(changeOf(a) ?? 0);
        const cb = Math.abs(changeOf(b) ?? 0);
        if (ca !== cb) return cb - ca;
        return byDollarThenSymbol(a, b);
      };
  }
}

/**
 * Select the top `limit` by `compare` without sorting the whole universe.
 *
 * A bounded insertion into a small array. At K=20 over 10,000 symbols this is
 * O(N·K) worst case but O(N) in practice, because the overwhelming majority of
 * candidates lose to the current worst entry on their first comparison and are
 * rejected immediately. A full sort would be O(N log N) with an allocation the
 * size of the universe, per recomputation.
 *
 * Exported for the spec: this is the part where an off-by-one silently drops
 * the last row of every leaderboard.
 */
export function topK<T>(items: Iterable<T>, limit: number, compare: (a: T, b: T) => number): T[] {
  if (limit <= 0) return [];
  const out: T[] = [];
  for (const item of items) {
    if (out.length < limit) {
      // Binary-search insert keeps the buffer ordered while it fills.
      let lo = 0;
      let hi = out.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (compare(out[mid], item) <= 0) lo = mid + 1;
        else hi = mid;
      }
      out.splice(lo, 0, item);
      continue;
    }
    // Full: only a candidate that beats the current worst is worth placing.
    if (compare(item, out[out.length - 1]) >= 0) continue;
    let lo = 0;
    let hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(out[mid], item) <= 0) lo = mid + 1;
      else hi = mid;
    }
    out.splice(lo, 0, item);
    out.pop();
  }
  return out;
}

export interface RankOptions {
  limit?: number;
  policy?: EligibilityPolicy;
  now?: number;
  /**
   * Whether the volume held in these states is consolidated.
   *
   * Volume boards refuse to produce a list when it is not. Passing `true` for a
   * single-venue feed is the one way to make this module lie, which is why it
   * is an explicit argument rather than something inferred from a default.
   */
  volumeIsConsolidated?: boolean;
}

export function rank(
  states: Iterable<SymbolState>,
  board: MoverBoard,
  options: RankOptions = {}
): RankResult {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 20;
  const policy = options.policy ?? DEFAULT_ELIGIBILITY;

  const excluded: Partial<Record<IneligibleReason, number>> = {};
  const eligible: SymbolState[] = [];
  let universe = 0;

  for (const s of states) {
    universe++;
    const outcome = checkEligibility(s, now, policy);
    if (!outcome.ok) {
      if (outcome.reason) excluded[outcome.reason] = (excluded[outcome.reason] ?? 0) + 1;
      continue;
    }
    eligible.push(s);
  }

  const base: Omit<RankResult, "rows" | "unavailable"> = {
    board,
    universe,
    eligible: eligible.length,
    excluded,
    computedAt: now,
  };

  // A volume board built on single-venue volume is a different question with
  // the same label. Refuse rather than mislead.
  const isVolumeBoard = board === "most_active_volume";
  if (isVolumeBoard && !options.volumeIsConsolidated) {
    const source = eligible.find((s) => s.volumeSource)?.volumeSource ?? null;
    const coverage = source ? FEED_COVERAGE[source] : "none";
    if (coverage !== "consolidated") {
      return {
        ...base,
        rows: [],
        unavailable: {
          reason: "volume_not_consolidated",
          detail:
            `Volume on this deployment comes from ${source ?? "no feed"} (${coverage}), not the ` +
            "consolidated tape. Ranking by it would order symbols by how much traded on one " +
            "venue, which is a different question. Use dollar volume, or add a consolidated feed.",
        },
      };
    }
  }

  const rows = topK(eligible, limit, comparatorFor(board)).map((s, i) => ({
    rank: i + 1,
    symbol: s.symbol,
    price: s.lastPrice as number,
    previousClose: s.previousClose as number,
    change: changeOf(s) as number,
    changePercent: changePercentOf(s) as number,
    volume: s.volume,
    dollarVolume: s.dollarVolume,
    freshness: freshnessOf(s.lastExchangeTimestamp, now, policy.freshness),
    incomplete: s.sequenceGap,
    asOf: s.lastExchangeTimestamp,
  }));

  return { ...base, rows, unavailable: null };
}

/**
 * The difference between two leaderboards, for streaming to a client.
 *
 * Sending the whole board on every tick is what makes a live table expensive:
 * twenty rows of JSON many times a second, and a client that re-renders all of
 * them to show one number changing. A diff is usually one entry.
 */
export interface BoardDelta {
  board: MoverBoard;
  entered: MoverRow[];
  left: string[];
  moved: MoverRow[];
  updated: MoverRow[];
  computedAt: number;
}

export function diffBoards(previous: MoverRow[], next: MoverRow[], board: MoverBoard, computedAt: number): BoardDelta {
  const prevBySymbol = new Map(previous.map((r) => [r.symbol, r]));
  const nextSymbols = new Set(next.map((r) => r.symbol));

  const entered: MoverRow[] = [];
  const moved: MoverRow[] = [];
  const updated: MoverRow[] = [];

  for (const row of next) {
    const before = prevBySymbol.get(row.symbol);
    if (!before) {
      entered.push(row);
    } else if (before.rank !== row.rank) {
      moved.push(row);
    } else if (
      before.price !== row.price ||
      before.changePercent !== row.changePercent ||
      before.volume !== row.volume ||
      before.freshness !== row.freshness
    ) {
      updated.push(row);
    }
  }

  const left = previous.filter((r) => !nextSymbols.has(r.symbol)).map((r) => r.symbol);

  return { board, entered, left, moved, updated, computedAt };
}
