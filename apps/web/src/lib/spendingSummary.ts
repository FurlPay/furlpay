import type { Transaction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Spending summary — "how much did I spend today?" computed from the ledger.
//
// This is the server-side twin of Guardian's ComputeSpendingSummaryUseCase
// (guardian/core/domain/.../ComputeSpendingSummaryUseCase.kt). Both Guardian
// clients previously pulled the WHOLE transaction list and did this math
// on-device because no summary endpoint existed. That works, but it ships every
// transaction to a watch to answer one number, and it means the phone, the
// watch tile, and the voice answer each re-derive the figure independently.
//
// The contract is deliberately identical to the Kotlin one so a client can
// switch to the endpoint without changing what it displays:
//   - only OUTGOING, non-declined transactions count as spending
//   - windows are TODAY / ISO week (Monday start) / calendar month
//   - topCategory is the category with the largest total in the window
//
// TIMEZONE. "Today" is a local-calendar question, so the window is computed in
// the CALLER's IANA zone, not the server's. Guardian computes it in the device
// zone (TimeZone.currentSystemDefault()), so an endpoint that assumed UTC would
// disagree with the on-device tile for most of the world for part of every day.
// The zone is a required-in-practice parameter, defaulted to UTC only so a
// caller that omits it gets a defined answer rather than a wrong local one.
// ---------------------------------------------------------------------------

export const SPENDING_PERIODS = ["today", "this_week", "this_month"] as const;
export type SpendingPeriod = (typeof SPENDING_PERIODS)[number];

export interface SpendingSummary {
  period: SpendingPeriod;
  /** Start of the window, as an ISO instant — lets a client show "since when". */
  since: string;
  totalUsd: number;
  transactionCount: number;
  /** Budgets are a client-side preference; the server does not store one. */
  budgetUsd: number | null;
  topCategory: string | null;
  byCategory: Record<string, number>;
}

/** True when `tz` is a zone this runtime's ICU data actually knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    // RangeError — an unknown or malformed identifier. Asking Intl beats
    // shipping a zone table that goes stale every time the IANA db changes.
    return false;
  }
}

/** The offset (ms) to ADD to a UTC instant to get wall-clock time in `tz`. */
function zoneOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const at = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asIfUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second"));
  // Compare against the instant truncated to whole seconds, since the formatted
  // parts carry no milliseconds.
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock calendar date in `tz` at the given instant. */
function localDate(instant: number, tz: string): { year: number; month: number; day: number } {
  const shifted = new Date(instant + zoneOffsetMs(instant, tz));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * The UTC instant of local midnight on the given calendar date in `tz`.
 *
 * Two-pass because the offset depends on the instant we are solving for: the
 * first pass guesses using the offset at UTC-midnight, the second corrects it
 * using the offset actually in force at the guessed instant. That second pass
 * is what keeps DST-transition days right — on a spring-forward day the naive
 * guess lands an hour off, which would silently drop or double-count an hour of
 * transactions at the window edge.
 */
function startOfLocalDay(year: number, month: number, day: number, tz: string): number {
  const naive = Date.UTC(year, month - 1, day);
  const guess = naive - zoneOffsetMs(naive, tz);
  return naive - zoneOffsetMs(guess, tz);
}

/** ISO day-of-week, Monday = 1 … Sunday = 7. */
function isoDayOfWeek(year: number, month: number, day: number): number {
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

/** The UTC instant at which `period` began, in the caller's zone. */
export function windowStart(period: SpendingPeriod, now: number, tz: string): number {
  const { year, month, day } = localDate(now, tz);
  switch (period) {
    case "today":
      return startOfLocalDay(year, month, day, tz);
    case "this_week": {
      // Back up to Monday. Done in UTC-date arithmetic (which handles month and
      // year rollover) before converting to a local-midnight instant.
      const monday = new Date(Date.UTC(year, month - 1, day - (isoDayOfWeek(year, month, day) - 1)));
      return startOfLocalDay(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), tz);
    }
    case "this_month":
      return startOfLocalDay(year, month, 1, tz);
  }
}

/**
 * Sum outgoing, non-declined spending in the period. Pure — `now` and `tz` are
 * injected so the windowing is testable without touching the system clock.
 */
export function computeSpendingSummary(
  transactions: Transaction[],
  period: SpendingPeriod,
  now: number,
  tz: string
): SpendingSummary {
  const since = windowStart(period, now, tz);

  const spent = transactions.filter((t) => {
    if (t.direction !== "out" || t.status === "declined") return false;
    const at = Date.parse(t.timestamp);
    // A malformed timestamp is excluded rather than coerced to epoch 0, which
    // would silently park it outside every window anyway but read as intent.
    return Number.isFinite(at) && at >= since && at <= now;
  });

  const byCategory: Record<string, number> = {};
  for (const t of spent) {
    if (!t.category) continue;
    byCategory[t.category] = round2((byCategory[t.category] ?? 0) + t.amountUsd);
  }

  let topCategory: string | null = null;
  for (const [category, total] of Object.entries(byCategory)) {
    if (topCategory === null || total > byCategory[topCategory]) topCategory = category;
  }

  return {
    period,
    since: new Date(since).toISOString(),
    totalUsd: round2(spent.reduce((sum, t) => sum + t.amountUsd, 0)),
    transactionCount: spent.length,
    budgetUsd: null,
    topCategory,
    byCategory,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
