import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { runOncePerDay } from "@/lib/cron/runOnce";
import { cronHttpStatus, runJob } from "@/lib/cron/runner";
import { runWelcomeSweep, type SweepReport } from "@/lib/discordWelcome/welcome";

// ---------------------------------------------------------------------------
// GET /api/cron/discord-welcome — greet members who have joined since the last
// sweep.
//
// WHY A SWEEP AND NOT A LISTENER. `guildMemberAdd` is a gateway event and this
// app has no gateway: Vercel functions do not outlive a request, so there is no
// process to hold the socket. The sweep asks Discord who joined instead, and
// stores which members it has already greeted so each one is welcomed once.
//
// CADENCE IS THE ONE THING THIS ENDPOINT CANNOT SET FOR ITSELF. vercel.json
// runs it daily because the plan rejects anything more frequent at deploy time,
// and a welcome up to a day late is not much of a welcome. Any external
// scheduler can call this as often as it likes with the FURLPAY_CRON_SECRET
// header — every few minutes is the intended production cadence, and the job is
// safe to run at any interval because the per-member claim, not the schedule,
// is what prevents a second greeting.
//
// ?dry=1 reports exactly what it would post, touching neither Discord nor the
// claim store, so configuration can be checked against a live server without
// greeting anybody.
// ---------------------------------------------------------------------------
async function run(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const dry = req.nextUrl.searchParams.get("dry") === "1";

  // `runJob` bodies return void — it owns locking and status — so the report is
  // collected here and returned alongside the outcome.
  let report: SweepReport = { skipped: true, reason: "job did not run" };

  const outcome = await runJob("discord-welcome", async (ctx) => {
    report = await runWelcomeSweep({
      dry,
      expired: ctx.expired,
      remainingMs: ctx.remainingMs,
    });

    // Surface the counters on the job record so "did anyone get welcomed this
    // week" is answerable from the run history rather than from Discord.
    ctx.metric("welcomed", report.welcomed ?? 0);
    ctx.metric("failed", report.failed ?? 0);
    ctx.metric("alreadyWelcomed", report.alreadyWelcomed ?? 0);
    if (report.degraded) ctx.note(report.degraded);
    if (report.reason) ctx.note(report.reason);
  });

  return NextResponse.json({
    job: "discord-welcome",
    status: outcome.status,
    dryRun: dry,
    ...report,
    ...("detail" in outcome ? { detail: outcome.detail } : { recorded: outcome.recorded }),
  }, { status: cronHttpStatus(outcome) });
}

// Vercel Cron calls GET; EventBridge Scheduler (infra/aws/modules/env/scheduler.tf)
// calls POST — it used to get a 405 (audit P1-3). This job posts to an external
// channel, so it runs at most once per UTC day: EventBridge retries after a
// 5-second timeout and would otherwise post several times. Authentication comes
// first, so an unauthenticated request can never consume the day's run.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;
  return runOncePerDay("discord-welcome", () => run(req));
}

export const POST = GET;
