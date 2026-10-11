import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Recurring payroll schedules: a schedule prepares a DRAFT batch per period and
// never pays. Storage is an in-memory stand-in for the two PostgREST calls the
// runner makes; batch creation is mocked at the repository boundary.
const h = vi.hoisted(() => ({
  schedules: [] as Record<string, unknown>[],
  contractors: [] as Record<string, unknown>[],
  createBatch: vi.fn(),
  failUpdate: false,
}));

vi.mock("@/lib/supabase", () => {
  const param = (q: string, k: string) => new URLSearchParams(q).get(k) ?? "";
  const val = (s: string) => decodeURIComponent(s.replace(/^(eq|lte)\./, ""));
  return {
    supabaseBackend: "supabase",
    sbSelect: vi.fn(async (table: string, q: string) => {
      if (table === "payroll_contractors") {
        const ids = decodeURIComponent(param(q, "id")).replace(/^in\.\(|\)$/g, "").split(",");
        return h.contractors.filter((c) => ids.includes(c.id as string) && c.merchant_id === val(param(q, "merchant_id")));
      }
      if (param(q, "next_run_on")) {
        const lte = val(param(q, "next_run_on"));
        return h.schedules.filter((s) => s.active && (s.next_run_on as string) <= lte).map((s) => ({ ...s }));
      }
      return h.schedules.filter((s) => (!param(q, "id") || s.id === val(param(q, "id"))) && (!param(q, "merchant_id") || s.merchant_id === val(param(q, "merchant_id")))).map((s) => ({ ...s }));
    }),
    sbInsertIgnoreDuplicates: vi.fn(async (_t: string, row: Record<string, unknown>) => {
      if (!h.schedules.some((s) => s.id === row.id)) h.schedules.push({ ...row });
    }),
    sbUpdate: vi.fn(async (_t: string, q: string, patch: Record<string, unknown>) => {
      if (h.failUpdate) return [];
      const id = val(param(q, "id"));
      const runOn = param(q, "next_run_on") ? val(param(q, "next_run_on")) : null;
      const owner = param(q, "merchant_id") ? val(param(q, "merchant_id")) : null;
      const mustBeLive = param(q, "cancelled_at") === "is.null";
      const row = h.schedules.find((s) => s.id === id && (runOn === null || s.next_run_on === runOn) && (owner === null || s.merchant_id === owner) && (!mustBeLive || !s.cancelled_at));
      if (!row) return [];
      Object.assign(row, patch);
      return [{ ...row }];
    }),
  };
});
vi.mock("../repository", async (orig) => ({ ...(await orig<typeof import("../repository")>()), createBatch: h.createBatch }));

import {
  createSchedule, firstRunOn, monthlyOnOrAfter, nextRunAfter, runBatchId, runDueSchedules, scheduleSchema, updateSchedule,
} from "../schedule";
import { PayrollConflict } from "../repository";

const OWNER = "11111111-1111-4111-8111-111111111111";
const S1 = "44444444-4444-4444-8444-444444444444";
const C1 = "33333333-3333-4333-8333-333333333333";
const at = (d: string) => Date.parse(`${d}T09:00:00Z`);
const contractor = (over = {}) => ({ id: C1, merchant_id: OWNER, name: "Ada", active: true, payout_chain: "arbitrum", ...over });
const input = (over = {}) => ({ requestId: S1, name: "Monthly team", chain: "arbitrum" as const, cadence: "monthly" as const, startOn: "2026-10-20", dayOfMonth: 25, lines: [{ contractorId: C1 }], ...over });

beforeEach(() => {
  h.schedules.length = 0;
  h.contractors.length = 0;
  h.contractors.push(contractor());
  h.createBatch.mockReset().mockResolvedValue({});
  h.failUpdate = false;
});

describe("run dates (UTC)", () => {
  it("weekly and fortnightly repeat from the start date", () => {
    expect(nextRunAfter("weekly", "2026-10-28")).toBe("2026-11-04");
    expect(nextRunAfter("biweekly", "2026-12-24")).toBe("2027-01-07");
  });
  it("monthly runs on the chosen day, rolling into next month when it has passed", () => {
    expect(monthlyOnOrAfter("2026-10-20", 25)).toBe("2026-10-25");
    expect(monthlyOnOrAfter("2026-10-26", 25)).toBe("2026-11-25");
    expect(monthlyOnOrAfter("2026-10-25", 25)).toBe("2026-10-25");
    expect(nextRunAfter("monthly", "2026-12-25", 25)).toBe("2027-01-25");
    expect(firstRunOn("monthly", "2027-01-29", 28)).toBe("2027-02-28");
  });
});

describe("a run's batch id", () => {
  it("is a valid UUID, stable for the same run and distinct across runs and schedules", () => {
    const id = runBatchId(S1, "2026-10-25");
    expect(z.string().uuid().safeParse(id).success).toBe(true);
    expect(runBatchId(S1, "2026-10-25")).toBe(id);
    expect(runBatchId(S1, "2026-11-25")).not.toBe(id);
    expect(runBatchId(C1, "2026-10-25")).not.toBe(id);
  });
});

describe("schedule validation", () => {
  it("requires a day of the month for monthly schedules and refuses one otherwise", () => {
    expect(scheduleSchema.safeParse(input({ dayOfMonth: undefined })).success).toBe(false);
    expect(scheduleSchema.safeParse(input({ cadence: "weekly" })).success).toBe(false);
    expect(scheduleSchema.safeParse(input({ cadence: "weekly", dayOfMonth: undefined })).success).toBe(true);
    expect(scheduleSchema.safeParse(input({ dayOfMonth: 31 })).success).toBe(false);
  });
  it("refuses impossible dates, duplicate contractors and unknown fields", () => {
    expect(scheduleSchema.safeParse(input({ startOn: "2026-02-30" })).success).toBe(false);
    expect(scheduleSchema.safeParse(input({ lines: [{ contractorId: C1 }, { contractorId: C1 }] })).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input(), autoSubmit: true }).success).toBe(false);
  });
});

describe("creating a schedule", () => {
  it("stores the first run date and refuses a start in the past", async () => {
    const s = await createSchedule(OWNER, input(), at("2026-10-11"));
    expect(s.next_run_on).toBe("2026-10-25");
    expect(s.active).toBe(true);
    await expect(createSchedule(OWNER, input({ requestId: C1, startOn: "2026-10-10" }), at("2026-10-11"))).rejects.toBeInstanceOf(PayrollConflict);
  });
  it("checks the roster now: unknown, inactive or wrong-chain contractors are refused", async () => {
    h.contractors[0] = contractor({ active: false });
    await expect(createSchedule(OWNER, input(), at("2026-10-11"))).rejects.toThrow(/inactive/);
    h.contractors[0] = contractor({ payout_chain: "base" });
    await expect(createSchedule(OWNER, input(), at("2026-10-11"))).rejects.toThrow(/paid on base/);
    h.contractors[0] = contractor({ merchant_id: "someone-else" });
    await expect(createSchedule(OWNER, input(), at("2026-10-11"))).rejects.toThrow(/not found/);
  });
});

describe("the runner", () => {
  async function seeded(cadence: "weekly" | "monthly" = "monthly") {
    await createSchedule(OWNER, input(cadence === "weekly" ? { cadence, dayOfMonth: undefined, startOn: "2026-10-12" } : {}), at("2026-10-11"));
  }

  it("prepares a draft batch for a due run with the run's id and month, then advances", async () => {
    await seeded();
    const results = await runDueSchedules({ now: at("2026-10-25") });
    expect(results).toEqual([{ scheduleId: S1, runOn: "2026-10-25", batchId: runBatchId(S1, "2026-10-25"), status: "created" }]);
    expect(h.createBatch).toHaveBeenCalledWith(OWNER, { requestId: runBatchId(S1, "2026-10-25"), cycle: "2026-10", chain: "arbitrum", lines: [{ contractorId: C1 }] });
    expect(h.schedules[0]).toMatchObject({ next_run_on: "2026-11-25", last_run_on: "2026-10-25", last_status: "created", last_batch_id: runBatchId(S1, "2026-10-25") });
  });

  it("does nothing before the run date, and nothing twice", async () => {
    await seeded();
    expect(await runDueSchedules({ now: at("2026-10-24") })).toEqual([]);
    await runDueSchedules({ now: at("2026-10-25") });
    await runDueSchedules({ now: at("2026-10-26") });
    expect(h.createBatch).toHaveBeenCalledTimes(1);
  });

  it("catches up missed weekly periods, one draft each, at most six per pass", async () => {
    await seeded("weekly");
    const results = await runDueSchedules({ now: at("2027-01-31") });
    expect(results).toHaveLength(6);
    expect(new Set(results.map((r) => r.batchId)).size).toBe(6);
    expect(results.map((r) => r.runOn)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("records a roster problem as a failed run and moves on, so it does not fail every pass", async () => {
    await seeded();
    h.createBatch.mockRejectedValueOnce(new PayrollConflict("Ada is inactive"));
    const [r] = await runDueSchedules({ now: at("2026-10-25") });
    expect(r).toMatchObject({ status: "failed", error: "Ada is inactive" });
    expect(h.schedules[0]).toMatchObject({ next_run_on: "2026-11-25", last_status: "failed", last_error: "Ada is inactive", last_batch_id: null });
  });

  it("does NOT advance on a storage or network error: the next pass retries the same run and batch id", async () => {
    await seeded();
    h.createBatch.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(runDueSchedules({ now: at("2026-10-25") })).rejects.toThrow("fetch failed");
    expect(h.schedules[0].next_run_on).toBe("2026-10-25");
    await runDueSchedules({ now: at("2026-10-25") });
    expect(h.createBatch.mock.calls.map((c) => c[1].requestId)).toEqual([runBatchId(S1, "2026-10-25"), runBatchId(S1, "2026-10-25")]);
  });

  it("stops on a schedule another runner already advanced", async () => {
    await seeded("weekly");
    h.failUpdate = true;
    const results = await runDueSchedules({ now: at("2026-11-30") });
    expect(results).toHaveLength(1);
  });

  it("skips paused schedules, and resuming does not back-fill the paused periods", async () => {
    await seeded("weekly");
    await updateSchedule(OWNER, { id: S1, action: "pause" }, at("2026-10-11"));
    expect(await runDueSchedules({ now: at("2026-11-30") })).toEqual([]);
    const resumed = await updateSchedule(OWNER, { id: S1, action: "resume" }, at("2026-11-30"));
    expect(resumed?.next_run_on).toBe("2026-11-30");
    expect(resumed?.active).toBe(true);
  });

  it("stops early when the job's time budget is spent", async () => {
    await seeded("weekly");
    expect(await runDueSchedules({ now: at("2026-11-30"), expired: () => true })).toEqual([]);
    expect(h.createBatch).not.toHaveBeenCalled();
  });
});

describe("cancelling and tenant isolation", () => {
  const OTHER = "55555555-5555-4555-8555-555555555555";

  it("cancel is terminal: the schedule never runs and cannot be resumed, paused or edited", async () => {
    await createSchedule(OWNER, input(), at("2026-10-11"));
    const c = await updateSchedule(OWNER, { id: S1, action: "cancel" }, at("2026-10-12"));
    expect(c).toMatchObject({ active: false, cancelled_at: new Date(at("2026-10-12")).toISOString() });
    expect(await runDueSchedules({ now: at("2026-12-31") })).toEqual([]);
    for (const action of ["resume", "pause", "cancel"] as const) {
      await expect(updateSchedule(OWNER, { id: S1, action }, at("2026-10-13"))).rejects.toThrow(/cancelled/);
    }
    await expect(updateSchedule(OWNER, { id: S1, action: "update", name: "x" }, at("2026-10-13"))).rejects.toThrow(/cancelled/);
  });

  it("a resume that races a cancel cannot reactivate it (compare-and-set on cancelled_at)", async () => {
    await createSchedule(OWNER, input(), at("2026-10-11"));
    // The resume read the row before the cancel landed...
    h.schedules[0].cancelled_at = new Date(at("2026-10-12")).toISOString();
    h.schedules[0].active = false;
    const { sbUpdate } = await import("@/lib/supabase");
    const res = await (sbUpdate as unknown as (t: string, q: string, p: object) => Promise<unknown[]>)(
      "payroll_schedules", `id=eq.${S1}&merchant_id=eq.${OWNER}&cancelled_at=is.null`, { active: true });
    expect(res).toEqual([]);
    expect(h.schedules[0].active).toBe(false);
  });

  it("another employer can neither read, pause, resume, cancel nor edit a schedule", async () => {
    await createSchedule(OWNER, input(), at("2026-10-11"));
    const { listSchedules } = await import("../schedule");
    expect(await listSchedules(OTHER)).toEqual([]);
    for (const action of ["pause", "resume", "cancel"] as const) {
      expect(await updateSchedule(OTHER, { id: S1, action }, at("2026-10-12"))).toBeNull();
    }
    expect(await updateSchedule(OTHER, { id: S1, action: "update", name: "hijack" }, at("2026-10-12"))).toBeNull();
    expect(h.schedules[0]).toMatchObject({ active: true, name: "Monthly team", cancelled_at: null });
  });

  it("another employer cannot reuse a schedule's request id to read it", async () => {
    await createSchedule(OWNER, input(), at("2026-10-11"));
    await expect(createSchedule(OTHER, input(), at("2026-10-11"))).rejects.toThrow(/not found|already in use/);
    expect(h.schedules).toHaveLength(1);
    expect(h.schedules[0].merchant_id).toBe(OWNER);
  });

  it("a run prepares the batch for the schedule's own employer only", async () => {
    await createSchedule(OWNER, input(), at("2026-10-11"));
    await runDueSchedules({ now: at("2026-10-25") });
    expect(h.createBatch.mock.calls.every((c) => c[0] === OWNER)).toBe(true);
  });
});
