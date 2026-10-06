import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsAdmin, opsError, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { syncOnchain } from "@/lib/onchain/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/ops/onchain/sync (ADMIN_ONLY) — run a historical backfill or a
// reconciliation pass now: { kind: "backfill" | "reconcile", lookbackHours }.
// Independent of the cron runner on purpose: the runner's lock lives in KV,
// and a KV outage must not leave operators unable to reconcile.
// Only reads Allium and writes the onchain read model; never the ledger.
const Body = z.object({
  kind: z.enum(["backfill", "reconcile"]),
  lookbackHours: z.number().int().positive().max(24 * 90),
});

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "ops-onchain-sync", { limit: 4, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const started = Date.now();
  const report = await syncOnchain(body.kind, { lookbackHours: body.lookbackHours, deadline: () => Date.now() - started > 240_000 });
  if (report.status === "not_configured") return opsError("not_configured", report.reason ?? "not configured", 503);
  return opsOk(report);
}
