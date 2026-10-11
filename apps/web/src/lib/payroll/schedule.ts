import { createHash } from "node:crypto";
import { z } from "zod";
import { sbInsertIgnoreDuplicates, sbSelect, sbUpdate } from "@/lib/supabase";
import { parseUsdc } from "@/lib/payments/merchant/money";
import { payrollChainSchema, type Contractor, type PayrollChain } from "./model";
import { createBatch, PayrollConflict, requireStorage } from "./repository";

// Recurring payroll schedules (migration 0051).
//
// A schedule PREPARES payroll; it never pays. Payroll is non-custodial: every
// line is a payment intent the employer's own wallet signs, and FurlPay holds
// no employer funds. So a run does exactly what the employer would do by hand
// — create a DRAFT batch from the saved roster, with every recipient screened
// and the fees quoted — and stops there. Nothing moves until the employer
// reviews, submits and signs it.
//
// A run's batch id is derived from (schedule id, run date), and batch creation
// returns the existing batch for an existing id, so a retried or doubled run
// produces one batch.

export const cadenceSchema = z.enum(["weekly", "biweekly", "monthly"]);
export type Cadence = z.infer<typeof cadenceSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a real date");
const amount = z.string().max(20).refine((v) => { try { return parseUsdc(v) > 0n; } catch { return false; } }, "Enter an amount above zero and at most 1,000,000 USDC (up to six decimals)");
const lines = z.array(z.object({ contractorId: z.string().uuid(), amount: amount.optional() }).strict()).min(1).max(100)
  .refine((l) => new Set(l.map((x) => x.contractorId)).size === l.length, "Each contractor can appear once per schedule");

export const scheduleSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  chain: payrollChainSchema,
  cadence: cadenceSchema,
  /** First date a draft is prepared (UTC). Weekly and fortnightly runs repeat from it. */
  startOn: isoDate,
  /** Monthly only: 1-28, so every month has the day. */
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  lines,
}).strict().superRefine((s, ctx) => {
  if (s.cadence === "monthly" && s.dayOfMonth === undefined) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Monthly schedules need a day of the month (1-28)" });
  if (s.cadence !== "monthly" && s.dayOfMonth !== undefined) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Only monthly schedules take a day of the month" });
});

export const scheduleActionSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume"]) }).strict(),
  z.object({ id: z.string().uuid(), action: z.literal("update"), name: z.string().trim().min(1).max(120).optional(), lines: lines.optional() }).strict(),
]);

export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type ScheduleLine = { contractorId: string; amount?: string };
export type Schedule = {
  id: string; merchant_id: string; name: string; chain: PayrollChain; cadence: Cadence; day_of_month: number | null;
  lines: ScheduleLine[]; active: boolean; next_run_on: string; last_run_on: string | null; last_batch_id: string | null;
  last_status: "created" | "failed" | null; last_error: string | null; created_at: string; updated_at: string;
};

const eq = (v: string) => encodeURIComponent(v);
const DAY_MS = 86_400_000;
const MAX_START_DAYS = 366;

export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first run date on or after `from` for a monthly schedule. */
export function monthlyOnOrAfter(from: string, day: number): string {
  const f = new Date(toMs(from));
  const sameMonth = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), day);
  return toDate(sameMonth >= f.getTime() ? sameMonth : Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, day));
}

/** The first run date of a new schedule. */
export function firstRunOn(cadence: Cadence, startOn: string, dayOfMonth?: number | null): string {
  return cadence === "monthly" ? monthlyOnOrAfter(startOn, dayOfMonth as number) : startOn;
}

/** The run date after `runOn`. */
export function nextRunAfter(cadence: Cadence, runOn: string, dayOfMonth?: number | null): string {
  if (cadence === "weekly") return toDate(toMs(runOn) + 7 * DAY_MS);
  if (cadence === "biweekly") return toDate(toMs(runOn) + 14 * DAY_MS);
  const r = new Date(toMs(runOn));
  return toDate(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, dayOfMonth as number));
}

/**
 * The batch id of one run: a UUID (version 5 layout) derived from the schedule
 * and the run date, so the same run always names the same batch.
 */
export function runBatchId(scheduleId: string, runOn: string): string {
  const h = createHash("sha1").update(`furlpay:payroll-schedule:${scheduleId}:${runOn}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The roster rules a batch enforces, checked when the schedule is saved so the employer hears now, not at the first run. */
async function checkRoster(owner: string, chain: PayrollChain, selected: ScheduleLine[]) {
  const ids = selected.map((l) => l.contractorId);
  const roster = await sbSelect<Pick<Contractor, "id" | "name" | "active" | "payout_chain">>(
    "payroll_contractors",
    `select=id,name,active,payout_chain&merchant_id=eq.${eq(owner)}&id=in.(${ids.map(eq).join(",")})&limit=100`,
  );
  const byId = new Map(roster.map((c) => [c.id, c]));
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) throw new PayrollConflict("A contractor in this schedule was not found");
    if (!c.active) throw new PayrollConflict(`${c.name} is inactive`);
    if (c.payout_chain !== chain) throw new PayrollConflict(`${c.name} is paid on ${c.payout_chain}, not ${chain}`);
  }
}

export async function listSchedules(owner: string) {
  requireStorage();
  return sbSelect<Schedule>("payroll_schedules", `merchant_id=eq.${eq(owner)}&order=created_at.desc&limit=100`);
}

export async function createSchedule(owner: string, input: ScheduleInput, now = Date.now()) {
  requireStorage();
  const today = todayUtc(now);
  if (input.startOn < today) throw new PayrollConflict("The first run cannot be in the past");
  if (toMs(input.startOn) - toMs(today) > MAX_START_DAYS * DAY_MS) throw new PayrollConflict("The first run must be within a year");
  await checkRoster(owner, input.chain, input.lines);
  const stamp = new Date(now).toISOString();
  const row: Schedule = {
    id: input.requestId, merchant_id: owner, name: input.name, chain: input.chain, cadence: input.cadence,
    day_of_month: input.dayOfMonth ?? null, lines: input.lines, active: true,
    next_run_on: firstRunOn(input.cadence, input.startOn, input.dayOfMonth),
    last_run_on: null, last_batch_id: null, last_status: null, last_error: null, created_at: stamp, updated_at: stamp,
  };
  await sbInsertIgnoreDuplicates("payroll_schedules", row);
  const saved = (await sbSelect<Schedule>("payroll_schedules", `id=eq.${eq(input.requestId)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if (!saved) throw new PayrollConflict("Request ID already in use");
  return saved;
}

export async function updateSchedule(owner: string, input: z.infer<typeof scheduleActionSchema>, now = Date.now()) {
  requireStorage();
  const current = (await sbSelect<Schedule>("payroll_schedules", `id=eq.${eq(input.id)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if (!current) return null;
  const patch: Partial<Schedule> = { updated_at: new Date(now).toISOString() };
  if (input.action === "pause") patch.active = false;
  if (input.action === "resume") {
    patch.active = true;
    // Resuming does not back-fill the periods it was paused for: the next run
    // is the first scheduled date from today.
    let next = current.next_run_on;
    const today = todayUtc(now);
    while (next < today) next = nextRunAfter(current.cadence, next, current.day_of_month);
    patch.next_run_on = next;
  }
  if (input.action === "update") {
    if (input.name !== undefined) patch.name = input.name;
    if (input.lines !== undefined) {
      await checkRoster(owner, current.chain, input.lines);
      patch.lines = input.lines;
    }
  }
  return (await sbUpdate<Schedule>("payroll_schedules", `id=eq.${eq(input.id)}&merchant_id=eq.${eq(owner)}`, patch))[0] ?? null;
}

// ── the runner ────────────────────────────────────────────────────────────────

/** Periods one schedule may catch up in one pass (a runner that was down). */
const MAX_CATCH_UP = 6;
const DUE_PER_PASS = 50;

export type RunResult = { scheduleId: string; runOn: string; batchId: string; status: "created" | "failed"; error?: string };

/**
 * Prepare every due run. For each due period: create its draft batch (or find
 * the one a previous attempt created), then advance the schedule with a
 * compare-and-set on next_run_on, so two runners cannot both advance it.
 *
 * A roster problem (contractor removed, deactivated, moved chain) is the
 * employer's to fix: the run is recorded as failed with the reason and the
 * schedule moves on, so it does not fail again every pass. A storage or
 * network error is ours: the schedule is NOT advanced and the next pass
 * retries the same period — and gets the same batch id.
 */
export async function runDueSchedules(opts: { now?: number; expired?: () => boolean } = {}): Promise<RunResult[]> {
  requireStorage();
  const now = opts.now ?? Date.now();
  const today = todayUtc(now);
  const due = await sbSelect<Schedule>("payroll_schedules", `active=eq.true&next_run_on=lte.${today}&order=next_run_on.asc&limit=${DUE_PER_PASS}`);
  const results: RunResult[] = [];
  for (const s of due) {
    let runOn = s.next_run_on;
    for (let i = 0; i < MAX_CATCH_UP && runOn <= today; i++) {
      if (opts.expired?.()) return results;
      const batchId = runBatchId(s.id, runOn);
      let status: RunResult["status"] = "created";
      let error: string | undefined;
      try {
        await createBatch(s.merchant_id, { requestId: batchId, cycle: runOn.slice(0, 7), chain: s.chain, lines: s.lines });
      } catch (e) {
        if (!(e instanceof PayrollConflict)) throw e;
        status = "failed";
        error = e.message.slice(0, 500);
      }
      const next = nextRunAfter(s.cadence, runOn, s.day_of_month);
      const advanced = await sbUpdate<Schedule>("payroll_schedules", `id=eq.${eq(s.id)}&next_run_on=eq.${runOn}`, {
        next_run_on: next, last_run_on: runOn, last_batch_id: status === "created" ? batchId : s.last_batch_id,
        last_status: status, last_error: error ?? null, updated_at: new Date(now).toISOString(),
      });
      results.push({ scheduleId: s.id, runOn, batchId, status, ...(error ? { error } : {}) });
      if (!advanced[0]) break; // another runner advanced it; it owns the rest
      runOn = next;
    }
  }
  return results;
}
