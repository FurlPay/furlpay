import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { analyticsDashboard } from "@/lib/analytics/request";

export const dynamic = "force-dynamic";

const KINDS = new Set(["signup", "transaction", "security"]);

// GET /api/ops/analytics/events?kind=signup|transaction|security (ADMIN_ONLY):
// the live activity feed. User ids are pseudonyms (usr_ab12…ef34); no email,
// IP, location guess or KYC field is ever included.
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const r = await analyticsDashboard(req, auth, "ops-analytics-events");
  if (!r.ok) return r.res;
  if (kind && !KINDS.has(kind)) return opsError("invalid_kind", "kind must be signup, transaction or security", 400);
  const feed = r.dashboard.feed;
  if (feed.status !== "ok" || !kind) return opsOk(feed);
  return opsOk({ ...feed, data: { items: feed.data.items.filter((i) => i.kind === kind) } });
}
