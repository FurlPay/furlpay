import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { runReconciliation } from "@/lib/reconciliation";

export const dynamic = "force-dynamic";

// GET /api/ops/reconciliation — are the books internally consistent?
//
// ADMIN_ONLY. The report names payment ids and aggregate money totals, which is
// operator information; it deliberately carries no counterparty addresses or
// PII so it is safe to forward into an alert.
//
// The HTTP status is 200 whether or not the checks pass. A failing
// reconciliation is a successful REPORT of a problem, not a failed request —
// returning 5xx here would make an uptime monitor mask the finding as an API
// outage and, worse, invite someone to mute the endpoint. Read `data.status`:
//
//   ok       — debits equal credits, every settled payment has a ledger entry
//   warn     — checks could not be evaluated (no durable backend, or migration
//              0009 unapplied). NOT the same as clean.
//   critical — a defect is already written to the books. Page someone.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  return opsOk(await runReconciliation());
}
