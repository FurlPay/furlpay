import type { RevenueEngine, RevenueEvent, RevenueSource, RevenueStatus } from "./types";

// ---------------------------------------------------------------------------
// Aggregation.
//
// ── THE FORMULAS, WRITTEN DOWN ─────────────────────────────────────────────
//
//   realized revenue = Σ feeMinor WHERE status = "realized"
//                      (+ Σ feeMinor WHERE status = "reversed", which is
//                       negative, so a refund reduces revenue rather than
//                       being silently dropped)
//
//   pending revenue  = Σ feeMinor WHERE status = "pending"
//   simulated        = Σ feeMinor WHERE status = "simulated"    ← NOT revenue
//
//   applicable volume = Σ volumeMinor WHERE volumeMinor IS NOT NULL
//                       AND status ∈ {realized, reversed}
//
//   effective take rate = realized revenue / applicable volume
//
// That denominator is the part most often got wrong. It is NOT total TPV: a
// flat subscription charge has no volume, and dividing realized revenue
// (which includes subscriptions) by a TPV that excludes them inflates the take
// rate. So only events that HAVE a volume contribute to either side of the
// ratio — `takeRateBps` computes its own numerator from exactly the events in
// its denominator.
//
//   ARPU = realized revenue / distinct users with a realized event
//
// Distinct PAYING users, not all users. ARPU over the whole user base is a
// different metric (ARPPU vs ARPU) and mixing them makes the number move for
// reasons nobody can explain.
//
// ── ONE ASSET AT A TIME ────────────────────────────────────────────────────
//
// Minor units are only comparable within an asset: 100 USD-cents and 100
// USDC-micro-units are not the same magnitude. Totals are therefore returned
// PER ASSET, as a map keyed by asset id. A single "total revenue" number
// across assets needs FX rates at a point in time, which is a decision this
// module refuses to make silently — the caller supplies rates if it wants one.
// ---------------------------------------------------------------------------

/** Sums in minor units, keyed by asset id. */
export type ByAsset = Record<string, string>;

export interface RevenueTotals {
  realized: ByAsset;
  pending: ByAsset;
  simulated: ByAsset;
  reversed: ByAsset;
  /** Volume on events that carry one, whatever their status. */
  volume: ByAsset;
  /** Volume on realized/reversed events only — the take-rate denominator. */
  applicableVolume: ByAsset;
  eventCount: number;
  /** Distinct users with at least one realized event. */
  payingUsers: number;
}

const STATUS_BUCKET: Partial<Record<RevenueStatus, keyof Pick<RevenueTotals, "realized" | "pending" | "simulated" | "reversed">>> =
  {
    realized: "realized",
    pending: "pending",
    simulated: "simulated",
    reversed: "reversed",
    // "voided" is deliberately absent: it was never earned, so it contributes
    // to nothing except the event count.
  };

function add(into: ByAsset, asset: string, minorUnits: string): void {
  const current = BigInt(into[asset] ?? "0");
  into[asset] = (current + BigInt(minorUnits)).toString();
}

/** Bucket a set of events into totals. Pure — no I/O, no clock. */
export function totals(events: RevenueEvent[]): RevenueTotals {
  const out: RevenueTotals = {
    realized: {},
    pending: {},
    simulated: {},
    reversed: {},
    volume: {},
    applicableVolume: {},
    eventCount: events.length,
    payingUsers: 0,
  };
  const paying = new Set<string>();

  for (const e of events) {
    const bucket = STATUS_BUCKET[e.status];
    if (bucket) add(out[bucket], e.asset, e.feeMinor);

    if (e.volumeMinor != null) {
      add(out.volume, e.asset, e.volumeMinor);
      if (e.status === "realized" || e.status === "reversed") {
        add(out.applicableVolume, e.asset, e.volumeMinor);
      }
    }
    if (e.status === "realized" && e.userId) paying.add(e.userId);
  }

  out.payingUsers = paying.size;
  return out;
}

/**
 * Realized revenue net of reversals, per asset.
 *
 * Reversal fees are stored negative, so this is a plain sum — a refund reduces
 * the total rather than being dropped, which is what makes the number agree
 * with what actually landed in the bank.
 */
export function netRealized(t: RevenueTotals): ByAsset {
  const out: ByAsset = { ...t.realized };
  for (const [asset, minorUnits] of Object.entries(t.reversed)) {
    add(out, asset, minorUnits);
  }
  return out;
}

/**
 * Effective take rate in basis points, per asset.
 *
 * Numerator and denominator are drawn from the SAME events: only those with a
 * volume and a realized/reversed status. Returns null for an asset with no
 * applicable volume rather than 0, because "no rate" and "a rate of zero" are
 * different statements and a dashboard should not print the second when it
 * means the first.
 */
export function takeRateBps(events: RevenueEvent[]): Record<string, number | null> {
  const fee: ByAsset = {};
  const vol: ByAsset = {};

  for (const e of events) {
    if (e.volumeMinor == null) continue;
    if (e.status !== "realized" && e.status !== "reversed") continue;
    add(fee, e.asset, e.feeMinor);
    add(vol, e.asset, e.volumeMinor);
  }

  const out: Record<string, number | null> = {};
  for (const asset of Object.keys(vol)) {
    const denominator = BigInt(vol[asset]);
    if (denominator === 0n) {
      out[asset] = null;
      continue;
    }
    const numerator = BigInt(fee[asset] ?? "0") * 10_000n;
    const whole = numerator / denominator;
    const rem = numerator % denominator;
    out[asset] = Number(rem * 2n >= denominator ? whole + 1n : whole);
  }
  return out;
}

/**
 * ARPU over PAYING accounts, per asset, in minor units.
 *
 * Named for what it is: average revenue per paying user. Accounts with no
 * realized event are not in the denominator.
 */
export function arpuMinor(events: RevenueEvent[]): ByAsset {
  const fee: ByAsset = {};
  const users: Record<string, Set<string>> = {};

  for (const e of events) {
    if (e.status !== "realized" || !e.userId) continue;
    add(fee, e.asset, e.feeMinor);
    (users[e.asset] ??= new Set()).add(e.userId);
  }

  const out: ByAsset = {};
  for (const [asset, sum] of Object.entries(fee)) {
    const n = BigInt(users[asset]?.size ?? 0);
    out[asset] = n === 0n ? "0" : (BigInt(sum) / n).toString();
  }
  return out;
}

/** Group events by an arbitrary key, then total each group. */
function groupBy<K extends string>(
  events: RevenueEvent[],
  key: (e: RevenueEvent) => K,
): Record<K, RevenueTotals> {
  const buckets = {} as Record<K, RevenueEvent[]>;
  for (const e of events) {
    const k = key(e);
    (buckets[k] ??= []).push(e);
  }
  const out = {} as Record<K, RevenueTotals>;
  for (const [k, list] of Object.entries(buckets) as [K, RevenueEvent[]][]) {
    out[k] = totals(list);
  }
  return out;
}

export function byEngine(events: RevenueEvent[]): Record<RevenueEngine, RevenueTotals> {
  return groupBy(events, (e) => e.engine) as Record<RevenueEngine, RevenueTotals>;
}

export function bySource(events: RevenueEvent[]): Record<RevenueSource, RevenueTotals> {
  return groupBy(events, (e) => e.source) as Record<RevenueSource, RevenueTotals>;
}

/** UTC day key, "YYYY-MM-DD". UTC so a report does not shift with the viewer. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC month key, "YYYY-MM". */
export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function byDay(events: RevenueEvent[]): Record<string, RevenueTotals> {
  return groupBy(events, (e) => dayKey(e.createdAt));
}

export function byMonth(events: RevenueEvent[]): Record<string, RevenueTotals> {
  return groupBy(events, (e) => monthKey(e.createdAt));
}

/**
 * Period-over-period growth in realized revenue, per asset, as a percentage
 * with two decimal places.
 *
 * Returns null when the prior period is zero: growth from nothing is undefined,
 * and printing "∞%" or "100%" both misrepresent it.
 */
export function growthPct(current: ByAsset, prior: ByAsset): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const asset of new Set([...Object.keys(current), ...Object.keys(prior)])) {
    const before = BigInt(prior[asset] ?? "0");
    const after = BigInt(current[asset] ?? "0");
    if (before === 0n) {
      out[asset] = null;
      continue;
    }
    // Scaled integer math to two decimals, then divided once at the end.
    const delta = (after - before) * 10_000n;
    out[asset] = Number(delta / before) / 100;
  }
  return out;
}
