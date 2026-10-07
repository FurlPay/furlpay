import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsAdmin, opsError, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { syncOnchain } from "@/lib/onchain/sync";
import { refreshRwaSnapshot } from "@/lib/rwaRefresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/ops/onchain/sync (ADMIN_ONLY) — run a historical backfill or a
// reconciliation pass now: { kind: "backfill" | "reconcile", lookbackHours }.
// Independent of the cron runner on purpose: the runner's lock lives in KV,
// and a KV outage must not leave operators unable to reconcile.
// Only reads Allium and writes the onchain read model; never the ledger.
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["backfill", "reconcile"]), lookbackHours: z.number().int().positive().max(24 * 90) }),
  // Replace today's tokenized-assets snapshot from ALLIUM_RWA_QUERY_ID.
  z.object({ kind: z.literal("rwa") }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "ops-onchain-sync", { limit: 4, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  if (body.kind === "rwa") {
    const rwa = await refreshRwaSnapshot();
    if (rwa.status === "not_configured") return opsError("not_configured", rwa.reason ?? "not configured", 503);
    return rwa.status === "ok" ? opsOk(rwa) : opsError("refresh_failed", rwa.reason ?? "refresh failed", 502);
  }
  const started = Date.now();
  const report = await syncOnchain(body.kind, { lookbackHours: body.lookbackHours, deadline: () => Date.now() - started > 240_000 });
  if (report.status === "not_configured") return opsError("not_configured", report.reason ?? "not configured", 503);
  return opsOk(report);
}
