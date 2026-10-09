import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// 0048 on PGlite: excluding flagged payroll recipients, and the verified-fee journal.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql", "0045_merchant_refunds.sql", "0046_merchant_liveness_alerts.sql", "0047_arc_testnet_collection.sql", "0048_payroll_exclusions_and_fee_ledger.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });

const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
async function batch(screenings: string[], amounts: number[]) {
  const id = randomUUID(), merchant = randomUUID();
  const lines = screenings.map((s, i) => ({ name: `C${i}`, recipient: addr(i + 1), amount_units: String(amounts[i]), screening: s }));
  const b = (await db.query<{ status: string }>("select status from payroll_batch_create($1,$2,'2026-10','arc',$3::jsonb,2,35,1500000,19000000)", [id, merchant, JSON.stringify(lines)])).rows[0];
  return { id, merchant, status: b.status };
}
const row = async (id: string) => (await db.query<{ status: string; headcount: number; gross_units: string; batch_fee_units: string; seat_fee_units: string; total_quote_units: string }>("select status,headcount,gross_units::text,batch_fee_units::text,seat_fee_units::text,total_quote_units::text from payroll_batches where id=$1", [id])).rows[0];
const exclude = (b: { id: string; merchant: string }, note = "flagged by screening") => db.query("select * from payroll_batch_exclude_unscreened($1,$2,'employer',$3,35,1500000)", [b.id, b.merchant, note]);

describe("excluding flagged payroll recipients (0048)", () => {
  it("removes only the lines that did not clear, records them, and reprices the rest", async () => {
    const b = await batch(["clear", "blocked", "clear", "unavailable"], [1_000_000_000, 500_000_000, 2_000_000_000, 70_000_000]);
    expect(b.status).toBe("blocked");
    await exclude(b);
    const r = await row(b.id);
    expect(r).toMatchObject({ status: "draft", headcount: 2, gross_units: "3000000000", batch_fee_units: "10500000", seat_fee_units: "38000000" });
    expect(r.total_quote_units).toBe(String(3_000_000_000 + 10_500_000 + 38_000_000));
    const kept = (await db.query<{ screening: string }>("select screening from payroll_batch_lines where batch_id=$1", [b.id])).rows;
    expect(kept.every(l => l.screening === "clear")).toBe(true);
    const ex = (await db.query<{ screening: string; excluded_by: string; note: string }>("select screening,excluded_by,note from payroll_batch_exclusions where batch_id=$1 order by amount_units", [b.id])).rows;
    expect(ex).toEqual([{ screening: "unavailable", excluded_by: "employer", note: "flagged by screening" }, { screening: "blocked", excluded_by: "employer", note: "flagged by screening" }]);
  });
  it("applies the 1.50 USDC minimum to what remains", async () => {
    const b = await batch(["clear", "blocked"], [10_000_000, 10_000_000]);
    await exclude(b);
    expect((await row(b.id)).batch_fee_units).toBe("1500000");
  });
  it("cancels a batch with nobody left, and refuses non-blocked batches, other merchants and empty notes", async () => {
    const all = await batch(["blocked"], [10_000_000]);
    await exclude(all);
    expect((await row(all.id)).status).toBe("cancelled");
    const ok = await batch(["clear"], [10_000_000]);
    await expect(exclude(ok)).rejects.toThrow(/batch_not_blocked/);
    const b = await batch(["clear", "blocked"], [10_000_000, 10_000_000]);
    await expect(db.query("select * from payroll_batch_exclude_unscreened($1,$2,'x','flagged',35,1500000)", [b.id, randomUUID()])).rejects.toThrow(/batch_missing/);
    await expect(exclude(b, " ")).rejects.toThrow(/note_required/);
    expect((await row(b.id)).status).toBe("blocked");
  });
});

describe("verified payroll execution journals the fee once (0048)", () => {
  it("records the line and posts DR fee treasury / CR fee revenue, idempotently", async () => {
    const b = await batch(["clear"], [1_000_000_000]);
    const line = (await db.query<{ id: string }>("select id from payroll_batch_lines where batch_id=$1", [b.id])).rows[0].id;
    await db.query("update payroll_batch_lines set payment_id='pay_1', sign_data='{}'::jsonb, sign_deadline=now(), signature=$2, signer=$3, signed_at=now() where id=$1", [line, "0x" + "11".repeat(65), addr(9)]);
    const tx = "0x" + "ab".repeat(32);
    const call = () => db.query<{ r: boolean }>("select payroll_line_executed($1,$2,$3,77,'pay_1',3500000,now()) r", [b.id, line, tx]);
    expect((await call()).rows[0].r).toBe(true);
    expect((await call()).rows[0].r).toBe(false); // retry: nothing recorded twice
    const bal = async (a: string) => (await db.query<{ v: string }>("select ledger_account_balance($1)::text v", [a])).rows[0].v;
    expect(await bal("payroll:fee_treasury:arc")).toBe("3500000");
    expect(await bal("payroll:fees:arc")).toBe("3500000");
    expect((await db.query<{ n: number }>("select count(*)::int n from ledger_transactions where id=$1", [`payroll:arc:${tx}:pay_1`])).rows[0].n).toBe(1);
  });
  it("refuses a payment id that is not the line's", async () => {
    const b = await batch(["clear"], [1_000_000_000]);
    const line = (await db.query<{ id: string }>("select id from payroll_batch_lines where batch_id=$1", [b.id])).rows[0].id;
    await db.query("update payroll_batch_lines set payment_id='pay_2', sign_data='{}'::jsonb, sign_deadline=now(), signature=$2, signer=$3, signed_at=now() where id=$1", [line, "0x" + "11".repeat(65), addr(9)]);
    expect((await db.query<{ r: boolean }>("select payroll_line_executed($1,$2,$3,77,'someone_else',1,now()) r", [b.id, line, "0x" + "cd".repeat(32)])).rows[0].r).toBe(false);
  });
});
