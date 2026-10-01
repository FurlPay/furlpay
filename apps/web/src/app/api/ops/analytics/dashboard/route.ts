import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { analyticsDashboard } from "@/lib/analytics/request";

export const dynamic = "force-dynamic";

// GET /api/ops/analytics/dashboard?range=24h|7d|30d|90d|custom[&from&to]&product=all|<rail>
// (ADMIN_ONLY). Every section of /analytics in ONE response: the page polls
// this one path, so a 15-second refresh is one request (and, because admin
// requests are announced, one deduplicated "admin action" alert per minute)
// rather than one per panel.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const r = await analyticsDashboard(req, auth, "ops-analytics-dashboard");
  if (!r.ok) return r.res;
  return opsOk(r.dashboard);
}
