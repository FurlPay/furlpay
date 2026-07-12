import { listTxEvents, type OpsTxEvent, type TxState } from "@/lib/ops/events";
import type { Rail } from "@/lib/ops/controls";

// ---------------------------------------------------------------------------
// Time-series aggregation over the ops tx event ledger. Events come from
// listTxEvents() (Supabase durable record, Redis hot-feed fallback) and are
// bucketed in JS — at current volumes a single bounded fetch beats pushing
// GROUP BY through PostgREST, and it works identically on both backends.
// No fabricated data: buckets with no traffic report 0 (or null for rates).
// ---------------------------------------------------------------------------

export type MetricName = "volume" | "fees" | "tx_count" | "success_rate";
export const METRICS: MetricName[] = ["volume", "fees", "tx_count", "success_rate"];

const FETCH_LIMIT = 5000;

export async function txEventsBetween(fromMs: number, toMs: number, rail?: Rail): Promise<OpsTxEvent[]> {
  const all = await listTxEvents(FETCH_LIMIT);
  return all.filter((e) => {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) return false;
    return !rail || e.rail === rail;
  });
}

export interface Datapoint {
  ts: string;
  value: number | null; // null = no traffic in the bucket (rates only)
}

export function bucketize(
  events: OpsTxEvent[],
  metric: MetricName,
  fromMs: number,
  toMs: number,
  bucketMs: number
): Datapoint[] {
  const buckets = Math.max(1, Math.ceil((toMs - fromMs) / bucketMs));
  const settled = new Array(buckets).fill(0);
  const failed = new Array(buckets).fill(0);
  const value = new Array(buckets).fill(0);

  for (const e of events) {
    const i = Math.floor((Date.parse(e.ts) - fromMs) / bucketMs);
    if (i < 0 || i >= buckets) continue;
    if (e.state === "settled") settled[i]++;
    if (e.state === "failed" || e.state === "rejected") failed[i]++;
    if (metric === "volume" && e.state === "settled") value[i] += e.amountUsd ?? 0;
    if (metric === "fees" && e.state === "settled") value[i] += e.feeUsd ?? 0;
    if (metric === "tx_count") value[i]++;
  }

  return Array.from({ length: buckets }, (_, i) => {
    const ts = new Date(fromMs + i * bucketMs).toISOString();
    if (metric === "success_rate") {
      const attempted = settled[i] + failed[i];
      return { ts, value: attempted > 0 ? Number((settled[i] / attempted).toFixed(4)) : null };
    }
    return { ts, value: Number(value[i].toFixed(2)) };
  });
}

const STATES: TxState[] = ["prepared", "settled", "pending", "failed", "rejected"];

export interface WindowSummary {
  total: number;
  settled: number;
  failed: number;
  pending: number;
  prepared: number;
  rejected: number;
  volumeUsd: number;
  feeUsd: number;
  successRate: number | null;
}

export function summarize(events: OpsTxEvent[]): WindowSummary & { byRail: Record<string, WindowSummary> } {
  const empty = (): WindowSummary => ({
    total: 0, settled: 0, failed: 0, pending: 0, prepared: 0, rejected: 0,
    volumeUsd: 0, feeUsd: 0, successRate: null,
  });
  const acc = (s: WindowSummary, e: OpsTxEvent) => {
    s.total++;
    s[e.state]++;
    if (e.state === "settled") {
      s.volumeUsd += e.amountUsd ?? 0;
      s.feeUsd += e.feeUsd ?? 0;
    }
  };
  const finish = (s: WindowSummary) => {
    const attempted = s.settled + s.failed + s.rejected;
    s.successRate = attempted > 0 ? Number((s.settled / attempted).toFixed(4)) : null;
    s.volumeUsd = Number(s.volumeUsd.toFixed(2));
    s.feeUsd = Number(s.feeUsd.toFixed(2));
  };

  const overall = empty();
  const byRail: Record<string, WindowSummary> = {};
  for (const e of events) {
    acc(overall, e);
    byRail[e.rail] = byRail[e.rail] ?? empty();
    acc(byRail[e.rail], e);
  }
  finish(overall);
  Object.values(byRail).forEach(finish);
  return { ...overall, byRail };
}

/** Simple relative trend of the last quarter of a series vs the previous
 *  quarter. Returns null when there is not enough signal. */
export function trendOf(points: Datapoint[]): number | null {
  const vals = points.map((p) => p.value ?? 0);
  const q = Math.floor(vals.length / 4);
  if (q < 2) return null;
  const prev = vals.slice(-2 * q, -q).reduce((a, b) => a + b, 0);
  const last = vals.slice(-q).reduce((a, b) => a + b, 0);
  if (prev === 0) return last > 0 ? 1 : null;
  return Number(((last - prev) / prev).toFixed(4));
}
