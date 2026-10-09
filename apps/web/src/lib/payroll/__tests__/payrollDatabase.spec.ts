import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { quoteBatch } from "../pricing";
// Migration 0042 executed on PGlite: the stored fee quote must match the
// TypeScript formula, and the seat fee must land once per merchant per month.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "a");
const line = (units: string, screening = "clear", n = 1) => ({ contractor_id: "", name: `C${n}`, recipient: addr(n), amount_units: units, screening });
type Row = { status: string; gross_units: string; batch_fee_units: string; seat_fee_units: string; total_quote_units: string; merchant_id: string };
const create = async (id: string, merchant: string, lines: object[], seats = 3, cycle = "2026-10") =>
  (await db.query<Row>("select * from payroll_batch_create($1,$2,$3,'base',$4,$5,35,1500000,19000000)", [id, merchant, cycle, JSON.stringify(lines), seats])).rows[0];

describe("payroll batches (0042)", () => {
  it("stores the same quote as the TypeScript formula, with the 1.50 USDC minimum", async () => {
    const m = randomUUID();
    const b = await create(randomUUID(), m, [line("100000000"), line("200000000", "clear", 2)]);
    const q = quoteBatch([100_000_000n, 200_000_000n], 3, false);
    expect(BigInt(b.batch_fee_units)).toBe(q.batchFee); // 0.35% of 300 = 1.05 → minimum 1.50
    expect(BigInt(b.batch_fee_units)).toBe(1_500_000n);
    expect(BigInt(b.seat_fee_units)).toBe(57_000_000n);
    expect(BigInt(b.total_quote_units)).toBe(q.total);
    expect(b.status).toBe("draft");
  });
  it("charges 35 bps above the minimum, rounded down", async () => {
    const b = await create(randomUUID(), randomUUID(), [line("1000000000000")]);
    expect(BigInt(b.batch_fee_units)).toBe(3_500_000_000n);
  });
  it("charges seats only on the first batch of a month", async () => {
    const m = randomUUID();
    expect(BigInt((await create(randomUUID(), m, [line("5000000")])).seat_fee_units)).toBe(57_000_000n);
    expect(BigInt((await create(randomUUID(), m, [line("5000000")])).seat_fee_units)).toBe(0n);
    expect(BigInt((await create(randomUUID(), m, [line("5000000")], 3, "2026-11")).seat_fee_units)).toBe(57_000_000n);
  });
  it("is idempotent per request id and refuses another merchant's id", async () => {
    const id = randomUUID(), m = randomUUID();
    await create(id, m, [line("5000000")]);
    const again = await create(id, m, [line("999000000")]);
    expect(again.gross_units.toString()).toBe("5000000");
    expect((await db.query("select count(*)::int n from payroll_batch_lines where batch_id=$1", [id])).rows[0]).toEqual({ n: 1 });
    await expect(create(id, randomUUID(), [line("5000000")])).rejects.toThrow("request_conflict");
  });
  it("blocks a batch when any recipient is flagged or could not be screened", async () => {
    expect((await create(randomUUID(), randomUUID(), [line("5000000"), line("5000000", "unavailable", 2)])).status).toBe("blocked");
    expect((await create(randomUUID(), randomUUID(), [line("5000000", "blocked")])).status).toBe("blocked");
  });
  it("rejects out-of-range pricing, empty batches and malformed recipients", async () => {
    await expect(db.query("select payroll_batch_create($1,$2,'2026-10','base','[]',1,35,1500000,19000000)", [randomUUID(), randomUUID()])).rejects.toThrow("invalid_lines");
    await expect(db.query("select payroll_batch_create($1,$2,'2026-10','base',$3,1,5000,1500000,19000000)", [randomUUID(), randomUUID(), JSON.stringify([line("1")])])).rejects.toThrow("invalid_pricing");
    await expect(create(randomUUID(), randomUUID(), [{ ...line("5000000"), recipient: "0xnope" }])).rejects.toThrow();
    await expect(create(randomUUID(), randomUUID(), [line("0")])).rejects.toThrow();
    await expect(db.query("select payroll_batch_create($1,$2,'2026-10','ethereum',$3,1,35,1500000,19000000)", [randomUUID(), randomUUID(), JSON.stringify([line("1")])])).rejects.toThrow();
  });
  it("rejects the zero address and lower-case country codes on the roster", async () => {
    const ins = (a: string, country = "DE") => db.query("insert into payroll_contractors(id,merchant_id,name,email,country,payout_chain,payout_address,default_amount_units) values($1,$2,'A','a@b.co',$3,'base',$4,1000000)", [randomUUID(), randomUUID(), country, a]);
    await expect(ins("0x" + "0".repeat(40))).rejects.toThrow();
    await expect(ins(addr(1), "de")).rejects.toThrow();
    await expect(ins(addr(1))).resolves.toBeTruthy();
  });
  it("keeps every new table closed to anon and authenticated", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name in ('payroll_contractors','payroll_batches','payroll_batch_lines','payroll_seat_charges','merchant_pricing','merchant_review_notes','merchant_reconciliation_alerts')");
    expect(r.rows[0].n).toBe(0);
  });
});
