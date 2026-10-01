import { NextResponse } from "next/server";
import { kvDel, kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// At-most-once-per-day guard for scheduled jobs with EXTERNAL side effects
// (posting to Discord/Telegram). Audit P1-3.
//
// EventBridge's API destination gives up after 5 seconds and retries; these
// jobs run for up to a minute. Without a guard a single scheduled run becomes
// several identical posts. The claim is a KV set-if-not-exists on
// (job, UTC date): the first invocation of the day runs, a retry or a second
// scheduler answers 200 "already_ran". If the job itself FAILS, the claim is
// released so the retry can do the work.
//
// Read-only jobs (health) and jobs with their own idempotency (reconcile)
// do not use this.
// ---------------------------------------------------------------------------

const TTL_SECONDS = 36 * 3600;

export function runKey(job: string, now = new Date()): string {
  return `cron:ran:${job}:${now.toISOString().slice(0, 10)}`;
}

export async function runOncePerDay(job: string, work: () => Promise<Response>): Promise<Response> {
  const key = runKey(job);
  if (!(await kvSetNx(key, new Date().toISOString(), TTL_SECONDS))) {
    return NextResponse.json({ ok: true, job, skipped: "already_ran_today" });
  }
  let res: Response;
  try {
    res = await work();
  } catch (e) {
    await kvDel(key).catch(() => undefined);
    throw e;
  }
  if (!res.ok) await kvDel(key).catch(() => undefined);
  return res;
}
