import type { OnchainDashboard } from "./dashboard";

export interface VolumePoint { at: number; ledger: number | null; raw: number | null }
const DAY = 86_400_000;
/** Daily provider values cannot be split into hourly estimates. Missing days
 * stay null, and partially overlapping provider days are excluded. Ledger
 * values keep the API's exact buckets, including genuine zero buckets. */
export function volumeTimeline(d: OnchainDashboard): VolumePoint[] {
  const points = new Map<number, VolumePoint>();
  const from = Date.parse(d.range.from), to = Date.parse(d.range.to);
  if (d.ledger.status === "ok") for (const row of d.ledger.data.volumeByBucket) {
    const at = Date.parse(row.bucket);
    if (!Number.isFinite(at)) continue;
    points.set(at, { at, raw: null, ledger: Object.values(row.tokens).reduce((n, value) => n + value, 0) });
  }
  if (d.chain === "all" && d.range.bucket === "day" && d.alliumDaily.status === "ok") {
    for (const row of d.alliumDaily.data.days) {
      const at = Date.parse(row.day + "T00:00:00Z");
      if (!Number.isFinite(at) || at < from || at + DAY > to) continue;
      const p = points.get(at) ?? { at, ledger: null, raw: null };
      p.raw = row.volumeUsd;
      points.set(at, p);
    }
  }
  // Insert explicit gaps across absent days so a line never bridges missing data.
  const step = d.range.bucket === "hour" ? 3_600_000 : DAY;
  const times = [...points.keys()].sort((a, b) => a - b);
  if (times.length) for (let at = times[0]; at <= times[times.length - 1]; at += step) {
    if (!points.has(at)) points.set(at, { at, ledger: null, raw: null });
  }
  return [...points.values()].sort((a, b) => a.at - b.at);
}
