import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { configReadiness } from "@/lib/ops/overview";

export const dynamic = "force-dynamic";

// GET /api/ops/configuration — CONFIGURED/MISSING readiness per integration.
// Booleans only; raw secret values are never returned (spec requirement).
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  return opsOk(configReadiness());
}
