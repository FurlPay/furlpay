import { NextResponse } from "next/server";
import { kvDel, kvErrorCategory, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";
import { sanitizeError } from "@/lib/cron/runner";

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
  let claimed: boolean;
  try {
    claimed = await kvSetNx(key, new Date().toISOString(), TTL_SECONDS);
  } catch (e) {
    // Without the claim a retry could post twice, so the job does not run.
    // 503, not a thrown 500: the outcome is known (nothing ran) and a retry
    // is safe — the same answer runJob gives for the same outage.
    const detail = `Run store unavailable [${kvErrorCategory(e)}] (${sanitizeError(e instanceof Error ? e.message : String(e))}); job not run.`;
    log.error("cron job not run: once-per-day claim unavailable", { job, detail });
    return NextResponse.json({ ok: false, job, status: "store_unavailable", detail }, { status: 503 });
  }
  if (!claimed) {
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
