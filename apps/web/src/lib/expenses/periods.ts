import type { Transaction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Period-bucketed expense aggregation — week / month / year.
//
// WHY THIS EXISTS RATHER THAN EXTENDING spendingSummary.ts. That module reads
// the process-global `db.transactions` and only knows a rolling 7-day window.
// Everything here is PURE: it takes the caller's transactions and returns
// buckets. The route supplies one user's transactions, so a cross-tenant leak
// is not expressible, and the maths is testable without a store.
//
// MONEY IS SUMMED IN INTEGER CENTS. Adding 0.1 + 0.2 in float gives
// 0.30000000000000004; over a year of card transactions that drift becomes
// visible in a total the user can check against their statement. Amounts
// arrive as USD floats from the store, so each is rounded to cents ONCE on the
// way in, summed as integers, and converted back only for display.
//
// BUCKET BOUNDARIES ARE LOCAL-TIME AND INCLUSIVE-EXCLUSIVE [start, end).
// A transaction at 23:59 on the last day of a month belongs to that month, and
// one at 00:00 on the 1st belongs to the next. Using UTC boundaries for a user
// in UTC+13 would file a third of their evening spending under the wrong day.
// ---------------------------------------------------------------------------

export type Period = "week" | "month" | "year";

export const PERIODS: Period[] = ["week", "month", "year"];

export function isPeriod(v: unknown): v is Period {
  return v === "week" || v === "month" || v === "year";
}

export interface Bucket {
  /** ISO date of the bucket start (local midnight). */
  start: string;
  /** Short display label — "Mon", "W12", "Mar". */
  label: string;
  spentUsd: number;
  receivedUsd: number;
  count: number;
}

export interface CategorySlice {
  category: string;
  amountUsd: number;
  /** Share of period outflow, 0-100, rounded to 1dp. */
  percentage: number;
  count: number;
}

export interface PeriodSummary {
  period: Period;
  /** Inclusive start of the current period, ISO. */
  periodStart: string;
  /** Exclusive end, ISO. */
  periodEnd: string;
  totalSpentUsd: number;
  totalReceivedUsd: number;
  netUsd: number;
  transactionCount: number;
  /** Time series across the period — daily for week/month, monthly for year. */
  buckets: Bucket[];
  categories: CategorySlice[];
  largestExpense: { title: string; amountUsd: number; category: string; timestamp: string } | null;
  /** Change vs the immediately preceding period of equal length, or null when
   *  that period had no outflow (a percentage of zero is not meaningful). */
  changePct: number | null;
  /** Mean daily outflow across elapsed days — not total/period-length, which
   *  would understate a period still in progress. */
  dailyAverageUsd: number;
}

const toCents = (usd: number) => Math.round(usd * 100);
const toUsd = (cents: number) => cents / 100;

/** Local midnight at the start of `d`'s day. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-start week. Sunday (getDay()===0) belongs to the week that began six
 *  days earlier, not the one starting tomorrow. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = s.getDay();
  s.setDate(s.getDate() - (dow === 0 ? 6 : dow - 1));
  return s;
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);

/** [start, end) of the period containing `now`. */
export function periodBounds(period: Period, now: Date): { start: Date; end: Date } {
  switch (period) {
    case "week": {
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case "month": {
      const start = startOfMonth(now);
      return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
    }
    case "year": {
      const start = startOfYear(now);
      return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
    }
  }
}

/** The equal-length period immediately before `start`. Calendar-aware: the
 *  month before March 1 is February, whose length is not 30 days. */
function previousBounds(period: Period, start: Date): { start: Date; end: Date } {
  switch (period) {
    case "week": {
      const prev = new Date(start);
      prev.setDate(prev.getDate() - 7);
      return { start: prev, end: start };
    }
    case "month":
      return { start: new Date(start.getFullYear(), start.getMonth() - 1, 1), end: start };
    case "year":
      return { start: new Date(start.getFullYear() - 1, 0, 1), end: start };
  }
}

/** Declined transactions never moved money, so they are excluded from totals
 *  everywhere. Pending ones DID commit funds and are counted. */
function isOutflow(t: Transaction): boolean {
  return t.direction === "out" && t.status !== "declined";
}
function isInflow(t: Transaction): boolean {
  return t.direction === "in" && t.status !== "declined";
}

function inRange(t: Transaction, start: Date, end: Date): boolean {
  const ts = new Date(t.timestamp).getTime();
  return !Number.isNaN(ts) && ts >= start.getTime() && ts < end.getTime();
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Empty buckets spanning the period, so a chart shows the shape of the whole
 *  period rather than only the days that happened to have activity. */
function emptyBuckets(period: Period, start: Date, end: Date): Bucket[] {
  const out: Bucket[] = [];
  if (period === "year") {
    for (let m = 0; m < 12; m++) {
      const d = new Date(start.getFullYear(), m, 1);
      out.push({ start: d.toISOString(), label: MONTH[m], spentUsd: 0, receivedUsd: 0, count: 0 });
    }
    return out;
  }
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    out.push({
      start: day.toISOString(),
      label: period === "week" ? WEEKDAY[day.getDay()] : String(day.getDate()),
      spentUsd: 0,
      receivedUsd: 0,
      count: 0,
    });
  }
  return out;
}

/** Index of the bucket a transaction falls into. */
function bucketIndex(period: Period, t: Date, start: Date): number {
  if (period === "year") return t.getMonth();
  return Math.floor((startOfDay(t).getTime() - start.getTime()) / 86_400_000);
}

/**
 * Aggregate one user's transactions into a period summary.
 *
 * `transactions` MUST already be scoped to the acting user — this function has
 * no notion of ownership and will happily total whatever it is given.
 */
export function summarizePeriod(
  transactions: Transaction[],
  period: Period,
  now: Date = new Date()
): PeriodSummary {
  const { start, end } = periodBounds(period, now);
  const prev = previousBounds(period, start);

  const current = transactions.filter((t) => inRange(t, start, end));
  const buckets = emptyBuckets(period, start, end);

  let spentCents = 0;
  let receivedCents = 0;
  const byCategory = new Map<string, { cents: number; count: number }>();
  let largest: Transaction | null = null;

  for (const t of current) {
    const when = new Date(t.timestamp);
    const i = bucketIndex(period, when, start);
    const bucket = buckets[i];

    if (isOutflow(t)) {
      const cents = toCents(t.amountUsd);
      spentCents += cents;
      if (bucket) {
        bucket.spentUsd = toUsd(toCents(bucket.spentUsd) + cents);
        bucket.count++;
      }
      const entry = byCategory.get(t.category) ?? { cents: 0, count: 0 };
      entry.cents += cents;
      entry.count++;
      byCategory.set(t.category, entry);

      if (largest === null || t.amountUsd > largest.amountUsd) largest = t;
    } else if (isInflow(t)) {
      const cents = toCents(t.amountUsd);
      receivedCents += cents;
      if (bucket) bucket.receivedUsd = toUsd(toCents(bucket.receivedUsd) + cents);
    }
  }

  const prevSpentCents = transactions
    .filter((t) => inRange(t, prev.start, prev.end) && isOutflow(t))
    .reduce((s, t) => s + toCents(t.amountUsd), 0);

  const categories: CategorySlice[] = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      amountUsd: toUsd(v.cents),
      percentage: spentCents > 0 ? Math.round((v.cents / spentCents) * 1000) / 10 : 0,
      count: v.count,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd);

  // Elapsed days, not period length: on the 3rd of the month a user has spent
  // over 3 days, and dividing by 31 would report an average that makes their
  // burn look a tenth of what it is.
  const elapsedMs = Math.min(now.getTime(), end.getTime()) - start.getTime();
  const elapsedDays = Math.max(1, Math.ceil(elapsedMs / 86_400_000));

  return {
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    totalSpentUsd: toUsd(spentCents),
    totalReceivedUsd: toUsd(receivedCents),
    netUsd: toUsd(receivedCents - spentCents),
    transactionCount: current.filter((t) => t.status !== "declined").length,
    buckets,
    categories,
    largestExpense: largest
      ? {
          title: (largest as Transaction).title,
          amountUsd: (largest as Transaction).amountUsd,
          category: (largest as Transaction).category,
          timestamp: (largest as Transaction).timestamp,
        }
      : null,
    changePct:
      prevSpentCents > 0
        ? Math.round(((spentCents - prevSpentCents) / prevSpentCents) * 1000) / 10
        : null,
    dailyAverageUsd: Math.round(spentCents / elapsedDays) / 100,
  };
}

// ── Travel ─────────────────────────────────────────────────────────────────
//
// Travel expenses are NOT transactions. `TxCategory` has no "travel" member —
// bookings live in the trips store with their own shape, status vocabulary and
// cashback field. Filtering transactions for a travel category would silently
// return an empty report forever, so travel is aggregated from trips directly.

/** The subset of a Trip this module needs. Structural, so the travel store's
 *  Trip satisfies it without this module importing that store. */
export interface TripExpense {
  name: string;
  city: string;
  amountUsd: number;
  cashbackUsd: number;
  /** "cancelled" contributes nothing to spend — see below. */
  status: string;
  method: string;
  createdAt: string;
}

export interface TravelSummary extends PeriodSummary {
  /** Cashback earned in-period. Reported separately, never netted off spend:
   *  an expense report that quietly shows spend-minus-rewards will not
   *  reconcile against the card statement it is checked against. */
  cashbackUsd: number;
  topCities: { city: string; amountUsd: number; trips: number }[];
  tripCount: number;
}

/**
 * Aggregate one user's trips into a period summary.
 *
 * `trips` MUST already be scoped to the acting user (`listTrips(userId)`).
 * Cancelled trips are excluded from spend — the money came back — but are
 * still counted in `tripCount` so a report does not appear to lose bookings.
 */
export function summarizeTravel(
  trips: TripExpense[],
  period: Period,
  now: Date = new Date()
): TravelSummary {
  const { start, end } = periodBounds(period, now);
  const prev = previousBounds(period, start);

  const inPeriod = (t: TripExpense, from: Date, to: Date) => {
    const ts = new Date(t.createdAt).getTime();
    return !Number.isNaN(ts) && ts >= from.getTime() && ts < to.getTime();
  };
  const billable = (t: TripExpense) => t.status !== "cancelled" && t.status !== "pending";

  const current = trips.filter((t) => inPeriod(t, start, end));
  const buckets = emptyBuckets(period, start, end);

  let spentCents = 0;
  let cashbackCents = 0;
  const byCity = new Map<string, { cents: number; trips: number }>();
  const byMethod = new Map<string, { cents: number; count: number }>();
  let largest: TripExpense | null = null;

  for (const t of current) {
    if (!billable(t)) continue;
    const cents = toCents(t.amountUsd);
    spentCents += cents;
    cashbackCents += toCents(t.cashbackUsd);

    const i = bucketIndex(period, new Date(t.createdAt), start);
    const bucket = buckets[i];
    if (bucket) {
      bucket.spentUsd = toUsd(toCents(bucket.spentUsd) + cents);
      bucket.count++;
    }

    const city = byCity.get(t.city) ?? { cents: 0, trips: 0 };
    city.cents += cents;
    city.trips++;
    byCity.set(t.city, city);

    const method = byMethod.get(t.method) ?? { cents: 0, count: 0 };
    method.cents += cents;
    method.count++;
    byMethod.set(t.method, method);

    if (largest === null || t.amountUsd > largest.amountUsd) largest = t;
  }

  const prevCents = trips
    .filter((t) => inPeriod(t, prev.start, prev.end) && billable(t))
    .reduce((s, t) => s + toCents(t.amountUsd), 0);

  const elapsedMs = Math.min(now.getTime(), end.getTime()) - start.getTime();
  const elapsedDays = Math.max(1, Math.ceil(elapsedMs / 86_400_000));

  return {
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    totalSpentUsd: toUsd(spentCents),
    totalReceivedUsd: 0,
    netUsd: -toUsd(spentCents),
    transactionCount: current.filter(billable).length,
    buckets,
    // "Categories" for travel are payment methods — the axis a finance team
    // actually reconciles along.
    categories: [...byMethod.entries()]
      .map(([category, v]) => ({
        category,
        amountUsd: toUsd(v.cents),
        percentage: spentCents > 0 ? Math.round((v.cents / spentCents) * 1000) / 10 : 0,
        count: v.count,
      }))
      .sort((a, b) => b.amountUsd - a.amountUsd),
    largestExpense: largest
      ? {
          title: `${(largest as TripExpense).name} · ${(largest as TripExpense).city}`,
          amountUsd: (largest as TripExpense).amountUsd,
          category: (largest as TripExpense).method,
          timestamp: (largest as TripExpense).createdAt,
        }
      : null,
    changePct:
      prevCents > 0 ? Math.round(((spentCents - prevCents) / prevCents) * 1000) / 10 : null,
    dailyAverageUsd: Math.round(spentCents / elapsedDays) / 100,
    cashbackUsd: toUsd(cashbackCents),
    topCities: [...byCity.entries()]
      .map(([city, v]) => ({ city, amountUsd: toUsd(v.cents), trips: v.trips }))
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .slice(0, 5),
    tripCount: current.length,
  };
}
