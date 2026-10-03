import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { cronHttpStatus, runJob } from "@/lib/cron/runner";
import { runSettlementSweep } from "@/lib/settlementSweep";
import { autoHaltMode } from "@/lib/settlementSafety";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/settlement-safety — chain health, settlement-token integrity
// and reconciliation for every settlement network (lib/settlementSweep.ts).
//
// AUTHENTICATED by requireCron: CRON_SECRET (Vercel Cron) or
// FURLPAY_CRON_SECRET (an external scheduler). Unconfigured → 503, never open.
// Run under runJob: a durable lock skips overlapping runs, a budget stops the
// loop before the platform does, and every run is recorded.
//
// Vercel's schedule in vercel.json is daily, which is a backstop, not a
// monitor. Faster cadence = an external scheduler calling this route with
// FURLPAY_CRON_SECRET (docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md §8).
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  let summary: Awaited<ReturnType<typeof runSettlementSweep>> | null = null;
  const outcome = await runJob("settlement.safety", async (ctx) => {
    summary = await runSettlementSweep(ctx.expired);
    for (const r of summary.results) {
      ctx.metric("networks", 1);
      ctx.metric("unresolved", r.unresolved);
      ctx.metric("reorged", r.reorged);
      ctx.note(`${r.network}: state=${r.state} findings=[${r.findings.join(",")}] unresolved=${r.unresolved} reorged=${r.reorged}${r.cleared ? " (degraded cleared)" : ""}`);
    }
    if (summary.skipped.length) ctx.note(`budget exhausted; skipped: ${summary.skipped.join(",")}`);
  });

  return NextResponse.json({ outcome, mode: autoHaltMode(), summary }, { status: cronHttpStatus(outcome) });
}
