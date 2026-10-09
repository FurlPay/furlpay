import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// 0044 on PGlite: one roster entry per email, paired invite/link/proof columns,
// and the address_verified flag carried through payroll_batch_create.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });
const add = (merchant: string, email: string) => db.query("insert into payroll_contractors(id,merchant_id,name,email,country,payout_chain,payout_address,default_amount_units) values($1,$2,'A',$3,'DE','base',$4,1000000) returning id", [randomUUID(), merchant, email, "0x" + "ab".repeat(20)]);

describe("contractor self-service schema (0044)", () => {
  it("allows one roster entry per email per employer, case-insensitively", async () => {
    const m = randomUUID();
    await add(m, "ada@example.com");
    await expect(add(m, "ADA@example.com")).rejects.toThrow();
    await expect(add(randomUUID(), "ada@example.com")).resolves.toBeTruthy();
  });
  it("keeps invite, link and proof columns paired", async () => {
    const id = (await add(randomUUID(), "b@example.com")).rows[0] as { id: string };
    await expect(db.query("update payroll_contractors set invite_token_hash=$1 where id=$2", ["a".repeat(64), id.id])).rejects.toThrow();
    await expect(db.query("update payroll_contractors set linked_user_id=$1 where id=$2", [randomUUID(), id.id])).rejects.toThrow();
    await expect(db.query("update payroll_contractors set address_proof=$1 where id=$2", ["0x" + "1".repeat(130), id.id])).rejects.toThrow();
    await expect(db.query("update payroll_contractors set invite_token_hash=$1, invite_expires_at=now() where id=$2", ["not-hex", id.id])).rejects.toThrow();
    await expect(db.query("update payroll_contractors set address_proof=$1, address_verified_at=now() where id=$2", ["0x" + "1".repeat(130), id.id])).resolves.toBeTruthy();
  });
  it("records per line whether the paid address was proven by its owner", async () => {
    const id = randomUUID();
    const lines = [{ contractor_id: "", name: "A", recipient: "0x" + "ab".repeat(20), amount_units: "5000000", screening: "clear", address_verified: true },
      { contractor_id: "", name: "B", recipient: "0x" + "cd".repeat(20), amount_units: "5000000", screening: "clear" }];
    await db.query("select payroll_batch_create($1,$2,'2026-10','base',$3,2,35,1500000,19000000)", [id, randomUUID(), JSON.stringify(lines)]);
    const r = await db.query<{ name: string; address_verified: boolean }>("select name,address_verified from payroll_batch_lines where batch_id=$1 order by name", [id]);
    expect(r.rows).toEqual([{ name: "A", address_verified: true }, { name: "B", address_verified: false }]);
  });
});
