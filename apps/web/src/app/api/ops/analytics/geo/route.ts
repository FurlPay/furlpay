import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { analyticsDashboard } from "@/lib/analytics/request";

export const dynamic = "force-dynamic";

// GET /api/ops/analytics/geo (ADMIN_ONLY): the "geo" section of the dashboard
// build (lib/analytics/dashboard.ts). Same range/product parameters.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const r = await analyticsDashboard(req, auth, "ops-analytics-geo");
  if (!r.ok) return r.res;
  return opsOk(r.dashboard.geo);
}
