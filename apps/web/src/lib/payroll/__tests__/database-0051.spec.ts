import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runBatchId } from "../schedule";

// Migration 0051 on PGlite, after the payroll migrations it builds on.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql", "0045_merchant_refunds.sql", "0046_merchant_liveness_alerts.sql", "0047_arc_testnet_collection.sql", "0048_payroll_exclusions_and_fee_ledger.sql", "0051_payroll_schedules.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });

const lines = JSON.stringify([{ contractorId: randomUUID() }]);
const insert = (over: Record<string, unknown> = {}) => {
  const r = { id: randomUUID(), merchant_id: randomUUID(), name: "Team", chain: "arbitrum", cadence: "monthly", day_of_month: 25, lines, next_run_on: "2026-10-25", ...over };
  return db.query("insert into payroll_schedules(id,merchant_id,name,chain,cadence,day_of_month,lines,next_run_on) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
    [r.id, r.merchant_id, r.name, r.chain, r.cadence, r.day_of_month, r.lines, r.next_run_on]);
};

describe("payroll_schedules (0051)", () => {
  it("accepts a monthly schedule with a day and a weekly one without", async () => {
    await insert();
    await insert({ cadence: "weekly", day_of_month: null });
  });

  it("refuses a monthly schedule without a day, a weekly one with a day, and day 29-31", async () => {
    await expect(insert({ day_of_month: null })).rejects.toThrow();
    await expect(insert({ cadence: "weekly" })).rejects.toThrow();
    await expect(insert({ day_of_month: 31 })).rejects.toThrow();
  });

  it("refuses an empty roster, more than 100 lines, a non-array and an unknown chain or cadence", async () => {
    await expect(insert({ lines: "[]" })).rejects.toThrow();
    await expect(insert({ lines: JSON.stringify(Array.from({ length: 101 }, () => ({ contractorId: randomUUID() }))) })).rejects.toThrow();
    await expect(insert({ lines: '{"contractorId":"x"}' })).rejects.toThrow();
    await expect(insert({ chain: "solana" })).rejects.toThrow();
    await expect(insert({ cadence: "daily", day_of_month: null })).rejects.toThrow();
  });

  it("a retried run reuses its batch: payroll_batch_create returns the existing batch for the run's id", async () => {
    const merchant = randomUUID();
    const id = runBatchId(randomUUID(), "2026-10-25");
    const line = [{ contractor_id: "", name: "Ada", recipient: "0x" + "ab".repeat(20), amount_units: "1000000", screening: "clear" }];
    const create = () => db.query<{ id: string }>("select id from payroll_batch_create($1,$2,'2026-10','arbitrum',$3,1,35,1500000,19000000)", [id, merchant, JSON.stringify(line)]);
    const [a, b] = await Promise.all([create(), create()]);
    expect(a.rows[0].id).toBe(id);
    expect(b.rows[0].id).toBe(id);
    const n = await db.query<{ n: number }>("select count(*)::int n from payroll_batch_lines where batch_id=$1", [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it("is closed to anon and authenticated", async () => {
    const g = await db.query<{ grantee: string }>("select grantee from information_schema.role_table_grants where table_name='payroll_schedules'");
    const roles = new Set(g.rows.map((r) => r.grantee));
    expect(roles.has("anon")).toBe(false);
    expect(roles.has("authenticated")).toBe(false);
    expect(roles.has("service_role")).toBe(true);
  });
});
