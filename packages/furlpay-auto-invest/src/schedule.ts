import { Schedule } from "./types";

/**
 * Pure scheduling logic — no I/O, fully deterministic given a `now`. This is what
 * the runner uses to decide which DCA schedules are due, and it's what the tests
 * pin down. All times are computed in UTC.
 */

export function defaults(s: Schedule): Required<Pick<Schedule, "dayOfWeek" | "dayOfMonth" | "hour">> {
  return {
    dayOfWeek: s.dayOfWeek ?? 1, // Monday
    dayOfMonth: s.dayOfMonth ?? 1,
    hour: s.hour ?? 14, // 14:00 UTC
  };
}

/**
 * The first eligible run time at or after `from`, in UTC. For weekly/monthly this
 * lands on the configured day and hour; for daily it lands on the configured hour.
 */
export function nextRun(s: Schedule, from: Date): Date {
  const { dayOfWeek, dayOfMonth, hour } = defaults(s);

  if (s.frequency === "daily") {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour));
    if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  if (s.frequency === "weekly") {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour));
    let delta = (dayOfWeek - d.getUTCDay() + 7) % 7;
    if (delta === 0 && d.getTime() <= from.getTime()) delta = 7;
    d.setUTCDate(d.getUTCDate() + delta);
    return d;
  }

  // monthly
  const target = Math.min(Math.max(dayOfMonth, 1), 28);
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  let d = new Date(Date.UTC(year, month, target, hour));
  if (d.getTime() <= from.getTime()) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    d = new Date(Date.UTC(year, month, target, hour));
  }
  return d;
}

/**
 * Whether a schedule should fire at `now`: it's active and `now` has reached the
 * next scheduled instant after its anchor (lastRun, else createdAt).
 *
 * This is catch-up by design — if the runner was down over a slot, the schedule
 * fires once on the next tick and then advances (recording lastRun pushes the next
 * instant a full period forward), so a slot never double-fires.
 */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.active) return false;
  const anchor = new Date(s.lastRun ?? s.createdAt);
  return now.getTime() >= nextRun(s, anchor).getTime();
}
