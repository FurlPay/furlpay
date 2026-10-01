// ---------------------------------------------------------------------------
// Time ranges for the admin analytics dashboard. UTC throughout: buckets are
// UTC hours (24h) or UTC days (everything else), so the same request gives the
// same buckets on every instance.
//
// Bounded on purpose: the longest window is 90 days. An unbounded `from` is a
// query that scans the whole table on every 15-second poll.
// ---------------------------------------------------------------------------

export const RANGE_KEYS = ["24h", "7d", "30d", "90d", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const MAX_RANGE_DAYS = 90;

const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface AnalyticsRange {
  key: RangeKey;
  fromMs: number; // inclusive
  toMs: number; // exclusive
  /** The equally long window immediately before, for period-over-period change. */
  prevFromMs: number;
  prevToMs: number;
  bucket: "hour" | "day";
  /** Start of each bucket, ascending. */
  buckets: number[];
}

export type RangeResult = { ok: true; range: AnalyticsRange } | { ok: false; error: string };

const startOfUtcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function build(key: RangeKey, fromMs: number, toMs: number, bucket: "hour" | "day"): AnalyticsRange {
  const step = bucket === "hour" ? HOUR : DAY;
  const buckets: number[] = [];
  for (let t = Math.floor(fromMs / step) * step; t < toMs; t += step) buckets.push(t);
  const span = toMs - fromMs;
  return { key, fromMs, toMs, prevFromMs: fromMs - span, prevToMs: fromMs, bucket, buckets };
}

export function parseRange(params: URLSearchParams, now = Date.now()): RangeResult {
  const key = (params.get("range") ?? "30d") as RangeKey;
  if (!RANGE_KEYS.includes(key)) return { ok: false, error: `range must be one of ${RANGE_KEYS.join(", ")}` };

  // Rolling ranges end at now INCLUSIVE (toMs is exclusive, so now + 1): an
  // event recorded in the same millisecond as the query belongs to it.
  if (key === "24h") return { ok: true, range: build(key, Math.floor(now / HOUR) * HOUR - 23 * HOUR, now + 1, "hour") };
  if (key !== "custom") {
    const days = Number(key.slice(0, -1));
    return { ok: true, range: build(key, startOfUtcDay(now) - (days - 1) * DAY, now + 1, "day") };
  }

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return { ok: false, error: "custom range needs from and to as YYYY-MM-DD" };
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toDay = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toDay)) return { ok: false, error: "invalid date" };
  if (fromMs > toDay) return { ok: false, error: "from must not be after to" };
  if (toDay > startOfUtcDay(now)) return { ok: false, error: "to must not be in the future" };
  const days = (toDay - fromMs) / DAY + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `custom range is limited to ${MAX_RANGE_DAYS} days` };
  return { ok: true, range: build("custom", fromMs, Math.min(toDay + DAY, now + 1), "day") };
}

/** Index of the bucket a timestamp falls in, or -1 outside the range. */
export function bucketIndex(range: AnalyticsRange, ms: number): number {
  if (!(ms >= range.fromMs && ms < range.toMs)) return -1;
  const step = range.bucket === "hour" ? HOUR : DAY;
  const i = Math.floor((ms - range.buckets[0]) / step);
  return i >= 0 && i < range.buckets.length ? i : -1;
}

/** UTC hour stamps (YYYY-MM-DDTHH) covering a range, for hourly counters. */
export function hourStamps(fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  for (let t = Math.floor(fromMs / HOUR) * HOUR; t < toMs; t += HOUR) out.push(new Date(t).toISOString().slice(0, 13));
  return out;
}

/** UTC day stamps (YYYY-MM-DD) covering a range. */
export function dayStamps(fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  for (let t = startOfUtcDay(fromMs); t < toMs; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
