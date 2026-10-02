import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { runJob } from "@/lib/cron/runner";
import { sweepStaleOrders } from "@/lib/ramp/staleOrders";
import { processPartnerRetries } from "@/lib/ramp/partnerWebhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// /api/cron/ramp-maintenance — the ramp's background work.
//
//   1. Stale orders nobody is reading (lib/ramp/staleOrders.ts): unpaid
//      checkouts past 30 min → ABANDONED, undelivered crypto past 1 h → one
//      more on-chain check then MANUAL_REVIEW, payouts past 24 h → MANUAL_REVIEW.
//   2. Partner callbacks that failed and are due for another attempt
//      (lib/ramp/partnerWebhooks.ts, backoff 1 min → 6 h, five attempts).
//
// SCHEDULE: needs to run every few minutes to keep the 30-minute promise and
// the 1-minute first retry. It is NOT in vercel.json: the existing jobs there
// are daily, and a sub-daily Vercel cron depends on the plan. Schedule it
// externally (EventBridge, as the other jobs on AWS, or any scheduler sending
// x-furlpay-cron-key). Order reads still resolve staleness without it.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const outcome = await runJob("ramp.maintenance", async (ctx) => {
    const sweep = await sweepStaleOrders();
    ctx.metric("stale_checked", sweep.checked);
    ctx.metric("stale_changed", sweep.changed);
    ctx.metric("stale_errors", sweep.errors);
    if (ctx.expired()) {
      ctx.note("Budget spent after the stale sweep; partner retries wait for the next run.");
      return;
    }
    const retries = await processPartnerRetries();
    ctx.metric("callbacks_attempted", retries.attempted);
    ctx.metric("callbacks_delivered", retries.delivered);
    ctx.metric("callbacks_dropped", retries.dropped);
  });

  // 200 even on a failed run, like the other jobs: a scheduler retry would
  // re-run work that may have half-completed.
  return NextResponse.json({
    job: "ramp.maintenance",
    status: outcome.status,
    ...(outcome.status === "skipped_locked" ? { detail: outcome.detail } : { record: outcome.record }),
  });
}

export const POST = GET;
