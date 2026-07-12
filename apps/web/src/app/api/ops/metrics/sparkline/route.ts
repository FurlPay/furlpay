import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { RAILS, type Rail } from "@/lib/ops/controls";
import { METRICS, type MetricName, txEventsBetween, bucketize, trendOf } from "@/lib/ops/metrics";

export const dynamic = "force-dynamic";

// GET /api/ops/metrics/sparkline?metric=volume&rail=all — 7 days in 24
// buckets, compact enough to render inline in a metric card.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const metric = (req.nextUrl.searchParams.get("metric") || "volume") as MetricName;
  const railParam = req.nextUrl.searchParams.get("rail") || "all";
  if (!METRICS.includes(metric)) return opsError("bad_metric", `metric must be one of ${METRICS.join(", ")}`, 400);
  if (railParam !== "all" && !RAILS.includes(railParam as Rail)) return opsError("bad_rail", "unknown rail", 400);

  const to = Date.now();
  const from = to - 7 * 86_400_000;
  const bucketMs = (to - from) / 24;
  const events = await txEventsBetween(from, to, railParam === "all" ? undefined : (railParam as Rail));
  const datapoints = bucketize(events, metric, from, to, bucketMs);
  const trend = trendOf(datapoints);

  return opsOk({
    metric,
    rail: railParam,
    points: datapoints.map((d) => d.value ?? 0),
    trend,
    trendDirection: trend === null ? "flat" : trend > 0.02 ? "up" : trend < -0.02 ? "down" : "flat",
  });
}
