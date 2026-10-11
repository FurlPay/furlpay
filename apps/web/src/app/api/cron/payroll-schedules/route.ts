import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { cronHttpStatus, runJob } from "@/lib/cron/runner";
import { runDueSchedules, type RunResult } from "@/lib/payroll/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/payroll-schedules — prepare the draft batch for every recurring
// payroll schedule that is due (lib/payroll/schedule.ts). Prepares, never pays:
// each run is a DRAFT the employer reviews, submits and signs.
//
// AUTHENTICATED by requireCron (CRON_SECRET or FURLPAY_CRON_SECRET); fails
// closed when neither is set. runJob holds a durable lock, so overlapping runs
// skip, and stops the loop before the platform's time limit; a run cut short
// resumes on the next pass with the same batch ids.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  let results: RunResult[] = [];
  const outcome = await runJob("payroll.schedules", async (ctx) => {
    results = await runDueSchedules({ expired: ctx.expired });
    for (const r of results) {
      ctx.metric(r.status === "created" ? "created" : "failed", 1);
      if (r.status === "failed") ctx.note(`schedule ${r.scheduleId} ${r.runOn}: ${r.error}`);
    }
  });

  return NextResponse.json(
    { outcome, created: results.filter((r) => r.status === "created").length, failed: results.filter((r) => r.status === "failed").length },
    { status: cronHttpStatus(outcome) },
  );
}
