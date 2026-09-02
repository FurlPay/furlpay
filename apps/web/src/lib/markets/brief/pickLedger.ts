// ---------------------------------------------------------------------------
// What happened to the names the brief called out.
//
// The brief has published a "most bullish" board every day and never once come
// back to say whether those names went up. That is the easy half of the job:
// naming winners costs nothing, and a scoreboard nobody keeps is a scoreboard
// that can never be wrong. This module keeps it.
//
// ── WHAT "RETURN" MEANS HERE, PRECISELY ────────────────────────────────────
//
// The reference price is the one the brief PRINTED. That is the number a reader
// saw, so it is the honest anchor for "what happened since you read this".
//
// It is NOT an entry price, and this module never calls it one. The brief goes
// out after the close or at midday; nobody could have transacted at the printed
// close, and a real fill would have been the next open at best — usually worse,
// because these are by construction the day's biggest movers on the day's
// heaviest volume. The header says "since published" for exactly that reason,
// and `disclaimer()` states it in the post.
//
// ── WHY THE LEDGER IS APPEND-ONLY ──────────────────────────────────────────
//
// Each session's board is written once under its own key and never rewritten.
// Recomputing an old board from today's data would quietly replace what was
// actually published with what today's screener would have chosen, which is the
// mechanism by which every track record becomes flattering. A board that turned
// out badly stays in the ledger exactly as it was printed.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";

/** One name as the brief printed it. */
export interface LedgerPick {
  symbol: string;
  /** The price shown in the post. Not an executable entry. */
  referencePrice: number;
  /** The score it was ranked on, kept so a reader can see whether the ranking
   *  had any relationship to what followed. */
  score: number;
  changePercentThatDay: number;
}

export interface LedgerEntry {
  /** Trading session the board describes, US Eastern. */
  sessionDate: string;
  /** When the post went out. */
  publishedAt: number;
  picks: LedgerPick[];
}

/** Ninety days: long enough to see a 20-session horizon resolve with room to
 *  spare, short enough that this never becomes a data-retention question. */
const TTL_SECONDS = 60 * 60 * 24 * 90;
const INDEX_KEY = "brief:picks:index";
const entryKey = (d: string) => `brief:picks:${d}`;

/**
 * Record the board for a session. Never overwrites an existing one.
 *
 * The no-overwrite rule is the load-bearing part. A brief that runs twice in a
 * day — a retry, a manual trigger — must not replace the morning's board with
 * the afternoon's, because the first is what readers saw.
 */
export async function recordPicks(entry: LedgerEntry): Promise<"written" | "already-recorded"> {
  const existing = await kvGet<LedgerEntry>(entryKey(entry.sessionDate)).catch(() => null);
  if (existing) return "already-recorded";

  await kvSet(entryKey(entry.sessionDate), entry, TTL_SECONDS).catch(() => {});
  const index = (await kvGet<string[]>(INDEX_KEY).catch(() => null)) ?? [];
  if (!index.includes(entry.sessionDate)) {
    index.push(entry.sessionDate);
    index.sort();
    // Keep the index bounded; entries expire on their own TTL anyway.
    await kvSet(INDEX_KEY, index.slice(-120), TTL_SECONDS).catch(() => {});
  }
  return "written";
}

/** The most recent recorded board strictly BEFORE `beforeDate`. */
export async function previousEntry(beforeDate: string): Promise<LedgerEntry | null> {
  const index = (await kvGet<string[]>(INDEX_KEY).catch(() => null)) ?? [];
  const earlier = index.filter((d) => d < beforeDate).sort();
  for (let i = earlier.length - 1; i >= 0; i--) {
    const e = await kvGet<LedgerEntry>(entryKey(earlier[i]!)).catch(() => null);
    // An expired or missing entry is skipped rather than treated as empty: the
    // question is "what is the newest board we still hold", not "was there one".
    if (e && e.picks.length > 0) return e;
  }
  return null;
}

export interface PickOutcome {
  symbol: string;
  referencePrice: number;
  currentPrice: number | null;
  /** Percent change from the printed price. Null when the name cannot be
   *  priced now — delisted, halted, or simply missing from the feed. */
  returnPct: number | null;
  score: number;
}

export interface BoardOutcome {
  sessionDate: string;
  /** Sessions elapsed is not knowable from dates alone (weekends, holidays), so
   *  this is calendar days and is labelled as such. */
  calendarDaysElapsed: number;
  outcomes: PickOutcome[];
  /** How many of the priced names are up. Null when none could be priced. */
  winners: number | null;
  priced: number;
  /** Mean return across priced names, equally weighted. */
  meanReturnPct: number | null;
  /** Median, which a single +129% name cannot drag around. */
  medianReturnPct: number | null;
}

/**
 * Score a recorded board against current prices.
 *
 * Equal weighting, stated: these were a list, not a portfolio, and nobody said
 * how much to put in each. A cap-weighted or score-weighted number would be a
 * different claim requiring an allocation rule nobody published.
 *
 * Both mean and median are reported because they disagree in exactly the case
 * that matters. One name at +129% pulls a five-name mean up by 26 points on its
 * own; the median says whether the rest of the board went anywhere.
 */
export function scoreBoard(
  entry: LedgerEntry,
  priceOf: (symbol: string) => number | null,
  asOf: Date
): BoardOutcome {
  const outcomes: PickOutcome[] = entry.picks.map((p) => {
    const currentPrice = priceOf(p.symbol);
    const returnPct =
      currentPrice !== null && p.referencePrice > 0
        ? (currentPrice / p.referencePrice - 1) * 100
        : null;
    return {
      symbol: p.symbol,
      referencePrice: p.referencePrice,
      currentPrice,
      returnPct,
      score: p.score,
    };
  });

  const priced = outcomes.filter((o) => o.returnPct !== null);
  const rets = priced.map((o) => o.returnPct!).sort((a, b) => a - b);

  const median =
    rets.length === 0
      ? null
      : rets.length % 2 === 1
        ? rets[(rets.length - 1) / 2]!
        : (rets[rets.length / 2 - 1]! + rets[rets.length / 2]!) / 2;

  const days = Math.max(
    0,
    Math.round(
      (asOf.getTime() - new Date(entry.sessionDate + "T00:00:00Z").getTime()) / 86_400_000
    )
  );

  return {
    sessionDate: entry.sessionDate,
    calendarDaysElapsed: days,
    outcomes,
    winners: priced.length ? priced.filter((o) => o.returnPct! > 0).length : null,
    priced: priced.length,
    meanReturnPct: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null,
    medianReturnPct: median,
  };
}

/** The sentence that must accompany any of these numbers. */
export function disclaimer(): string {
  return (
    "Measured from the price printed in that post, which is not an entry price: " +
    "the board publishes after the session, so a real fill would have been the " +
    "next open at best. Equally weighted, before costs."
  );
}
