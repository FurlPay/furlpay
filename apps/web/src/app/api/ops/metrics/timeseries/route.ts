import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { RAILS, type Rail } from "@/lib/ops/controls";
import { METRICS, type MetricName, txEventsBetween, bucketize } from "@/lib/ops/metrics";

export const dynamic = "force-dynamic";

const BUCKETS_MS: Record<string, number> = {
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "6h": 21_600_000,
  "1d": 86_400_000,
};
const MAX_POINTS = 500;
const MAX_RANGE_MS = 90 * 86_400_000;

// GET /api/ops/metrics/timeseries?metric=volume&rail=all&from=...&to=...&bucket=1h
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const q = req.nextUrl.searchParams;
  const metric = (q.get("metric") || "volume") as MetricName;
  const railParam = q.get("rail") || "all";
  const bucket = q.get("bucket") || "1h";
  if (!METRICS.includes(metric)) return opsError("bad_metric", `metric must be one of ${METRICS.join(", ")}`, 400);
  if (railParam !== "all" && !RAILS.includes(railParam as Rail)) return opsError("bad_rail", "unknown rail", 400);
  const bucketMs = BUCKETS_MS[bucket];
  if (!bucketMs) return opsError("bad_bucket", `bucket must be one of ${Object.keys(BUCKETS_MS).join(", ")}`, 400);

  const to = q.get("to") ? Date.parse(q.get("to")!) : Date.now();
  const from = q.get("from") ? Date.parse(q.get("from")!) : to - 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return opsError("bad_range", "invalid from/to", 400);
  if (to - from > MAX_RANGE_MS) return opsError("bad_range", "range exceeds 90 days", 400);
  if ((to - from) / bucketMs > MAX_POINTS) return opsError("bad_range", `too many points (max ${MAX_POINTS}) — use a coarser bucket`, 400);

  const events = await txEventsBetween(from, to, railParam === "all" ? undefined : (railParam as Rail));
  return opsOk({
    metric,
    rail: railParam,
    bucket,
    datapoints: bucketize(events, metric, from, to, bucketMs),
    eventCount: events.length,
  });
}
