import { NextRequest } from "next/server";
import { opsOk, requireOpsAdmin } from "@/lib/ops/respond";

export const dynamic = "force-dynamic";

// GET /api/ops/analytics/access (ADMIN_ONLY): 200 for an ops admin, 401/403
// otherwise. Called by middleware before an /analytics PAGE renders, so a
// non-admin gets a real HTTP 403 — the page itself streams (root loading.tsx)
// and could only answer 200 by the time its layout runs. Returns no data.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  return opsOk({ admin: true });
}
