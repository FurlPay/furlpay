import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// Migration 0041 executed on PGlite (one connection: semantics, not lock
// contention; concurrent SKIP LOCKED claims were verified on multi-connection
// Postgres separately).
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });
const enqueue = async (merchant = randomUUID()) => {
  const r = await db.query<{ id: string }>("insert into merchant_payment_outbox(merchant_id,intent_id,type,payload) values($1,$2,'payment.succeeded','{}') returning id", [merchant, randomUUID()]);
  return r.rows[0].id;
};
const claim = async (limit = 10, max = 5) => (await db.query<{ id: string; attempts: number }>("select id,attempts from merchant_outbox_claim($1,120,$2)", [limit, max])).rows;
describe("merchant webhook outbox (0041)", () => {
  it("claims due events once, counts the attempt, and leases them", async () => {
    const id = await enqueue();
    const first = await claim();
    expect(first.find((r) => r.id === id)?.attempts).toBe(1);
    expect((await claim()).find((r) => r.id === id)).toBeUndefined();
  });
  it("stops at the attempt limit and never re-claims delivered events", async () => {
    const id = await enqueue();
    await db.query("update merchant_payment_outbox set attempts=5, next_attempt_at=now() - interval '1 second' where id=$1", [id]);
    expect((await claim()).find((r) => r.id === id)).toBeUndefined();
    const done = await enqueue();
    await db.query("update merchant_payment_outbox set delivered_at=now() where id=$1", [done]);
    expect((await claim()).find((r) => r.id === done)).toBeUndefined();
  });
  it("rejects invalid claim arguments and non-https endpoints", async () => {
    await expect(db.query("select merchant_outbox_claim(0,120,5)")).rejects.toThrow("invalid_claim");
    await expect(db.query("insert into merchant_webhook_endpoints(merchant_id,url,secret_enc,secret_last4) values($1,'http://x.example','v1:a','abcd')", [randomUUID()])).rejects.toThrow();
    await expect(db.query("insert into merchant_webhook_endpoints(merchant_id,url,secret_enc,secret_last4) values($1,'https://x.example','plaintext','abcd')", [randomUUID()])).rejects.toThrow();
  });
});
