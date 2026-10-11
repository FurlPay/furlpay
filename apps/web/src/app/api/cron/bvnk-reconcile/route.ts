import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { cronHttpStatus, runJob } from "@/lib/cron/runner";
import { BvnkNotConfigured } from "@/lib/bvnk/config";
import { reconcileOpenBvnkRecords, type ReconcileResult } from "@/lib/bvnk/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/bvnk-reconcile — re-read open BVNK transfers and payouts from
// BVNK and record the authoritative state (lib/bvnk/reconcile.ts). Read-only
// towards BVNK; changes no balance. NOT in vercel.json: it is scheduled only
// once BVNK credentials exist. Without them it answers 503 and calls nothing.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;
  let result: ReconcileResult | null = null;
  let notConfigured = false;
  const outcome = await runJob("bvnk.reconcile", async (ctx) => {
    try {
      result = await reconcileOpenBvnkRecords({ expired: ctx.expired });
    } catch (e) {
      if (e instanceof BvnkNotConfigured) { notConfigured = true; ctx.note(e.message); return; }
      throw e;
    }
    for (const [k, v] of Object.entries(result)) ctx.metric(k, v);
  });
  if (notConfigured) return NextResponse.json({ error: "bvnk_not_configured" }, { status: 503 });
  return NextResponse.json({ outcome, result }, { status: cronHttpStatus(outcome) });
}
