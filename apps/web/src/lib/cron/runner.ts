// ---------------------------------------------------------------------------
// The job runner.
//
// Every scheduled job goes through this, so the four things that make a cron
// job survivable are written once instead of per job:
//
//   1. A LOCK. Vercel Cron does not guarantee exactly-once delivery, and a slow
//      job can still be running when the next tick fires. Two reconcilers on
//      one account race each other into contradictory conclusions. The lock is
//      taken with an atomic set-if-absent and carries a TTL, so a crashed run
//      releases it instead of wedging the job forever.
//
//   2. A DEADLINE. A serverless function is killed at the platform's ceiling
//      with no chance to record what it did. Jobs get a budget shorter than
//      that ceiling and stop cleanly when it expires — a partial pass that
//      REPORTS being partial is worth far more than a complete pass that
//      vanishes.
//
//   3. AN EXECUTION RECORD. Written whether the job succeeded, failed or
//      timed out. "Did reconciliation run last night?" must be answerable
//      without grepping logs, and a job that silently stops running is
//      otherwise invisible — the most dangerous failure a scheduler has.
//
//   4. NO THROWING. A job that throws returns a 500, and Vercel Cron's retry
//      then re-runs work that may have half-completed. Failures are caught,
//      recorded and reported as a 200 with `ok: false` — the scheduler's job is
//      to invoke, not to decide what a failure means.
// ---------------------------------------------------------------------------

import { kvDel, kvErrorCategory, kvGet, kvListPush, kvListRange, kvSet, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// A PLATFORM CONSTRAINT WORTH KNOWING, because it changes what this scheduler
// can promise. This Vercel project is on the Hobby plan, which permits cron
// expressions that fire AT MOST ONCE PER DAY -- a `*/30 * * * *` schedule is
// rejected at deploy time. vercel.json therefore runs reconciliation daily.
//
// Daily reconciliation is real and far better than none, but it is not the
// cadence this code was designed for: a discrepancy can now stand for up to 24
// hours before anything notices. The mitigations already in place are what make
// that survivable rather than acceptable:
//
//   - GET /api/investing/orders syncs on read, so a user looking at their own
//     orders gets current state without waiting for the daily tick.
//   - The order record is written before submission, so nothing is lost in the
//     interval -- only unnoticed.
//
// Raising the cadence needs a Pro plan, or an external scheduler calling
// /api/cron/* with FURLPAY_CRON_SECRET on whatever interval it likes. The
// endpoints are indifferent to who invokes them.
// ---------------------------------------------------------------------------

/** How long a job's lock survives if the process dies holding it. */
const LOCK_TTL_SECONDS = 300;
/** Execution records are kept long enough to answer "did it run last week". */
const RECORD_TTL_SECONDS = 14 * 24 * 3600;
/** How many runs to keep per job. */
const HISTORY_MAX = 100;

/**
 * Wall-clock budget for a job.
 *
 * Deliberately below Vercel's function ceiling. A job that stops itself can
 * write down what it completed; a job the platform kills cannot, so its work
 * is both lost and unrecorded.
 */
export const DEFAULT_BUDGET_MS = 45_000;

const lockKey = (job: string) => `cron:lock:${job}`;
const recordKey = (job: string, runId: string) => `cron:run:${job}:${runId}`;
const historyKey = (job: string) => `cron:history:${job}`;
const lastKey = (job: string) => `cron:last:${job}`;

/**
 * Bumped when JobRecord changes shape. Readers can tell a v1 record (no
 * `status`, no `env`) from a current one without guessing.
 */
export const JOB_RECORD_SCHEMA = 2;

export interface JobRecord {
  schema?: number;
  job: string;
  runId: string;
  /**
   * `running` exists only in the per-run record (`cron:run:*`), written BEFORE
   * the body starts. A run that is still `running` long after its budget is a
   * run the platform killed — visible instead of absent. `cron:last:*` is only
   * ever written with a finished status.
   */
  status?: "running" | "success" | "failed";
  /** Where it ran — VERCEL_ENV and a short deployment id. Never a secret. */
  env?: { vercelEnv: string | null; deployment: string | null };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  /** True when the deadline stopped the job before it finished its work. */
  partial: boolean;
  /** Job-specific counters — items processed, findings raised. */
  metrics: Record<string, number>;
  /** Human-readable notes; findings a person should read. */
  notes: string[];
  error: string | null;
}

/** What a job body receives. */
export interface JobContext {
  job: string;
  runId: string;
  /** True once the budget is spent. Long loops MUST check this. */
  expired: () => boolean;
  /** Milliseconds left. */
  remainingMs: () => number;
  metric: (name: string, delta?: number) => void;
  note: (message: string) => void;
}

export type JobBody = (ctx: JobContext) => Promise<void>;

export type RunOutcome =
  | { status: "completed"; record: JobRecord; recorded: boolean }
  | { status: "skipped_locked"; detail: string }
  | { status: "store_unavailable"; detail: string }
  | { status: "failed"; record: JobRecord; recorded: boolean };

/**
 * The HTTP status a cron route answers with.
 *
 * `store_unavailable` is 503: the job did NOT run, nothing was half-done, so a
 * retry is safe and the scheduler's dashboard should show red. Until this
 * existed a KV outage was reported as `skipped_locked` with a 200 — the shape
 * of a healthy overlap — and on 2026-10-02 every job had been skipping that way
 * since the Upstash database hit its plan limit, with nothing anywhere saying so.
 *
 * `failed` stays 200 with `ok: false` on purpose (header, point 4): the body ran
 * and may have half-completed, and a non-2xx invites a retry of that work.
 */
export function cronHttpStatus(outcome: RunOutcome): number {
  return outcome.status === "store_unavailable" ? 503 : 200;
}

/**
 * Bounded and scrubbed for storage and logs. Error messages from fetch-based
 * clients can carry URLs (Telegram puts the bot token in the path), bearer
 * values or long key-like strings; none of that belongs in a run record.
 */
export function sanitizeError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(/\b(bearer|bot|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <redacted>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>")
    .slice(0, 300);
}

function runEnv(): JobRecord["env"] {
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  return { vercelEnv: process.env.VERCEL_ENV ?? null, deployment: deployment ? deployment.slice(0, 16) : null };
}

/**
 * Run a job under lock, deadline and recording.
 *
 * `skipped_locked` is a NORMAL outcome, not an error: it means the previous run
 * is still going, which is exactly what the lock is for. Reporting it as a
 * failure would train an operator to ignore the job's alerts.
 *
 * Delivery is AT-LEAST-ONCE from the scheduler's side; the lock makes runs of
 * one job mutually exclusive, not exactly-once. Jobs with external side effects
 * add their own idempotency (runOncePerDay, edit-in-place, per-order sync).
 */
export async function runJob(
  job: string,
  body: JobBody,
  opts: { budgetMs?: number } = {}
): Promise<RunOutcome> {
  const runId = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const env = runEnv();

  // ---- 1. Lock ---------------------------------------------------------
  let locked = false;
  try {
    locked = await kvSetNx(lockKey(job), { runId, at: new Date().toISOString() }, LOCK_TTL_SECONDS);
  } catch (e) {
    // A KV outage means we cannot prove exclusivity. Refuse to run rather than
    // risk two concurrent passes over financial state — and SAY so: the run
    // store is down too, so this log line is the only record there will be.
    const detail = `Lock store unavailable [${kvErrorCategory(e)}] (${sanitizeError(e instanceof Error ? e.message : String(e))}); job not run.`;
    log.error("cron job not run: lock store unavailable", { job, runId, detail });
    return { status: "store_unavailable", detail };
  }
  if (!locked) {
    return { status: "skipped_locked", detail: "A previous run of this job is still in progress." };
  }

  // ---- 2. Deadline + context ------------------------------------------
  const startedAtMs = Date.now();

  // The start record, BEFORE the body. A run the platform kills mid-flight
  // otherwise leaves nothing at all; with this it leaves `status: running`.
  try {
    await kvSet(
      recordKey(job, runId),
      {
        schema: JOB_RECORD_SCHEMA,
        job,
        runId,
        status: "running",
        env,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: "",
        durationMs: 0,
        ok: false,
        partial: false,
        metrics: {},
        notes: [],
        error: null,
      } satisfies JobRecord,
      RECORD_TTL_SECONDS
    );
    await kvListPush(historyKey(job), runId, HISTORY_MAX);
  } catch (e) {
    // The lock write succeeded a moment ago, so this is KV failing mid-run.
    // A job that cannot record its start will not be able to record its end
    // either; running it would be the invisible failure this file exists to
    // prevent.
    await kvDel(lockKey(job)).catch(() => undefined);
    const detail = `Run store unavailable [${kvErrorCategory(e)}] (${sanitizeError(e instanceof Error ? e.message : String(e))}); job not run.`;
    log.error("cron job not run: start record could not be stored", { job, runId, detail });
    return { status: "store_unavailable", detail };
  }
  const deadline = startedAtMs + budgetMs;
  const metrics: Record<string, number> = {};
  const notes: string[] = [];

  const ctx: JobContext = {
    job,
    runId,
    expired: () => Date.now() >= deadline,
    remainingMs: () => Math.max(0, deadline - Date.now()),
    metric: (name, delta = 1) => {
      metrics[name] = (metrics[name] ?? 0) + delta;
    },
    // Bounded: a job that notes per item would otherwise write an unbounded
    // record and blow the KV value limit.
    note: (message) => {
      if (notes.length < 200) notes.push(message);
    },
  };

  let error: string | null = null;
  try {
    await body(ctx);
  } catch (e) {
    // Caught, never rethrown — see the header. A 500 invites a retry of
    // half-completed work.
    error = sanitizeError(e instanceof Error ? e.message : String(e));
    log.error("cron job threw", { job, runId, error });
  }

  const finishedAtMs = Date.now();
  const record: JobRecord = {
    schema: JOB_RECORD_SCHEMA,
    job,
    runId,
    status: error === null ? "success" : "failed",
    env,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    ok: error === null,
    partial: ctx.expired(),
    metrics,
    notes,
    error,
  };

  // ---- 3. Record, then release ----------------------------------------
  //
  // Recording BEFORE releasing matters: if the process dies between the two,
  // the run is on the books and the lock expires on its own. The other order
  // loses the record of work that actually happened.
  //
  // The history entry was pushed with the start record, so it is not pushed
  // again here — one run, one list entry, newest first.
  let recorded = true;
  try {
    await kvSet(recordKey(job, runId), record, RECORD_TTL_SECONDS);
    await kvSet(lastKey(job), record, RECORD_TTL_SECONDS);
  } catch (e) {
    // The job's own result stands — a storage failure must not turn a success
    // into a failure or the reverse — but the caller is told it is unrecorded.
    recorded = false;
    log.error("cron run record could not be stored", {
      job,
      runId,
      ok: record.ok,
      error: sanitizeError(e instanceof Error ? e.message : String(e)),
    });
  }

  try {
    await kvDel(lockKey(job));
  } catch {
    // The TTL releases it. Not worth failing the run over.
  }

  log.info("cron job finished", {
    job,
    runId,
    ok: record.ok,
    partial: record.partial,
    durationMs: record.durationMs,
    ...metrics,
  });

  return record.ok ? { status: "completed", record, recorded } : { status: "failed", record, recorded };
}

/**
 * The most recent run, with the difference between "no record" and "could not
 * read the store" kept. Collapsing the two is how a KV outage reads as "this
 * job has never run" — a different problem with a different fix.
 */
export async function readLastRun(
  job: string
): Promise<{ state: "found"; record: JobRecord } | { state: "missing" } | { state: "store_error"; detail: string }> {
  try {
    const record = await kvGet<JobRecord>(lastKey(job));
    return record ? { state: "found", record } : { state: "missing" };
  } catch (e) {
    return { state: "store_error", detail: sanitizeError(e instanceof Error ? e.message : String(e)) };
  }
}

/** The most recent run of a job, for the ops console. Null when absent OR unreadable. */
export async function lastRun(job: string): Promise<JobRecord | null> {
  const r = await readLastRun(job);
  return r.state === "found" ? r.record : null;
}

/** Recent runs, newest first. */
export async function runHistory(job: string, limit = 20): Promise<JobRecord[]> {
  try {
    const ids = await kvListRange(historyKey(job), limit);
    const records = await Promise.all(ids.map((id) => kvGet<JobRecord>(recordKey(job, id))));
    return records.filter((r): r is JobRecord => r !== null);
  } catch {
    return [];
  }
}

/**
 * Has this job run recently enough?
 *
 * The check that catches a scheduler which has silently stopped — the failure
 * nothing else notices, because a job that does not run generates no errors.
 */
export async function isJobHealthy(job: string, maxAgeSeconds: number): Promise<{ healthy: boolean; detail: string }> {
  const read = await readLastRun(job);
  if (read.state === "store_error") {
    return { healthy: false, detail: `${job}: run store unavailable (${read.detail}); run state unknown.` };
  }
  if (read.state === "missing") {
    return {
      healthy: false,
      detail: `${job} has no recorded run (never ran here, or its record expired after ${RECORD_TTL_SECONDS / 86400} days).`,
    };
  }
  const last = read.record;
  const ageSeconds = (Date.now() - Date.parse(last.finishedAt)) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    return {
      healthy: false,
      detail: `${job} last ran ${Math.round(ageSeconds / 60)} minutes ago, over its ${Math.round(maxAgeSeconds / 60)} minute threshold.`,
    };
  }
  if (!last.ok) return { healthy: false, detail: `${job} last run failed: ${last.error}` };
  return { healthy: true, detail: `${job} ran ${Math.round(ageSeconds)}s ago.` };
}
