import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { listTxEvents } from "@/lib/ops/events";

export const dynamic = "force-dynamic";

// GET /api/ops/transactions?rail=&state=&limit= — unified money-movement
// ledger across every rail (real events only). Secrets/signatures are never
// stored in the feed, so nothing to redact here.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const p = req.nextUrl.searchParams;
  const rail = p.get("rail");
  const state = p.get("state");
  const limit = Math.min(Number(p.get("limit")) || 200, 1000);

  let rows = await listTxEvents(limit);
  if (rail) rows = rows.filter((r) => r.rail === rail);
  if (state) rows = rows.filter((r) => r.state === state);
  return opsOk({ transactions: rows, count: rows.length });
}
