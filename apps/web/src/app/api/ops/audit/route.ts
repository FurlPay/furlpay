import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { auditEntries } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/ops/audit?limit= — append-only privileged-action trail.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 200, 2000);
  return opsOk({ entries: auditEntries(limit) });
}
