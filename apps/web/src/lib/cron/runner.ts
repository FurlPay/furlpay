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

import { kvDel, kvGet, kvListPush, kvListRange, kvSet, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";

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

export interface JobRecord {
  job: string;
  runId: string;
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
  | { status: "completed"; record: JobRecord }
  | { status: "skipped_locked"; detail: string }
  | { status: "failed"; record: JobRecord };

/**
 * Run a job under lock, deadline and recording.
 *
 * `skipped_locked` is a NORMAL outcome, not an error: it means the previous run
 * is still going, which is exactly what the lock is for. Reporting it as a
 * failure would train an operator to ignore the job's alerts.
 */
export async function runJob(
  job: string,
  body: JobBody,
  opts: { budgetMs?: number } = {}
): Promise<RunOutcome> {
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  // ---- 1. Lock ---------------------------------------------------------
  let locked = false;
  try {
    locked = await kvSetNx(lockKey(job), { runId, at: new Date().toISOString() }, LOCK_TTL_SECONDS);
  } catch (e) {
    // A KV outage means we cannot prove exclusivity. Refuse to run rather than
    // risk two concurrent passes over financial state.
    return {
      status: "skipped_locked",
      detail: `Lock store unavailable (${e instanceof Error ? e.message : "error"}); job not run.`,
    };
  }
  if (!locked) {
    return { status: "skipped_locked", detail: "A previous run of this job is still in progress." };
  }

  // ---- 2. Deadline + context ------------------------------------------
  const startedAtMs = Date.now();
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
    error = e instanceof Error ? e.message : String(e);
    log.error("cron job threw", { job, runId, error });
  }

  const finishedAtMs = Date.now();
  const record: JobRecord = {
    job,
    runId,
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
  try {
    await kvSet(recordKey(job, runId), record, RECORD_TTL_SECONDS);
    await kvSet(lastKey(job), record, RECORD_TTL_SECONDS);
    await kvListPush(historyKey(job), runId, HISTORY_MAX);
  } catch (e) {
    log.error("cron run record could not be stored", { job, runId, error: (e as Error).message });
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

  return record.ok ? { status: "completed", record } : { status: "failed", record };
}

/** The most recent run of a job, for the ops console. */
export async function lastRun(job: string): Promise<JobRecord | null> {
  try {
    return await kvGet<JobRecord>(lastKey(job));
  } catch {
    return null;
  }
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
  const last = await lastRun(job);
  if (!last) return { healthy: false, detail: `${job} has no recorded run.` };
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
