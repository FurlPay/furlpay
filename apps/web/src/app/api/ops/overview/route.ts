import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { opsOverview } from "@/lib/ops/overview";

export const dynamic = "force-dynamic";

// GET /api/ops/overview — real rail matrix, totals, control + config state.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  return opsOk(await opsOverview());
}
