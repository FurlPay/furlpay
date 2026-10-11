import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// merchant_reconcile (0042) against real collections made by 0040's functions.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });
async function paidIntent() {
  const id = randomUUID(), owner = randomUUID(), slug = randomUUID(), intent = randomUUID();
  await db.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'M',$3,'Order','1000000000','merchant',array['base'],true,'link')", [id, owner, slug]);
  await db.query("insert into merchant_payment_destinations(merchant_id,chain,address,custody_reference,approved_at) values($1,'base',$2,'ref',now())", [owner, `0x${randomUUID().replaceAll("-", "").padEnd(40, "a")}`]);
  await db.query("select merchant_checkout_reserve($1,$2,'base','reference','100')", [intent, slug]);
  await db.query("select merchant_payment_receive($1,$2,0,'1000000000','payer','101','block',now(),1)", [intent, randomUUID()]);
  return intent;
}
const alerts = async (intent: string) => (await db.query<{ kind: string }>("select kind from merchant_reconciliation_alerts where intent_id=$1 and resolved_at is null order by kind", [intent])).rows.map(r => r.kind);
const run = async () => (await db.query<{ n: number }>("select merchant_reconcile(now() - interval '1 day') n")).rows[0].n;

describe("merchant reconciliation (0042)", () => {
  it("finds nothing wrong with a verified, balanced collection", async () => {
    const i = await paidIntent();
    await run();
    expect(await alerts(i)).toEqual([]);
  });
  it("flags an intent whose recorded amount disagrees with its receipts, once", async () => {
    const i = await paidIntent();
    await db.query("update merchant_payment_intents set received_units='2000000000' where id=$1", [i]);
    expect(await run()).toBeGreaterThanOrEqual(1);
    expect(await alerts(i)).toEqual(["amount_mismatch"]);
    await run();
    expect(await alerts(i)).toEqual(["amount_mismatch"]); // open alert is not duplicated
  });
  it("flags a paid intent with no chain receipt", async () => {
    const owner = randomUUID(), link = randomUUID(), i = randomUUID();
    await db.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'M',$3,'Order','1000000','merchant',array['base'],true,'link')", [link, owner, randomUUID()]);
    await db.query("insert into merchant_payment_intents(id,link_id,merchant_id,chain,recipient,reference,status,gross_units,fee_units,charge_units,net_units,received_units,start_block,scan_block,expires_at) values($1,$2,$3,'base','0xabc','r','paid','1000000','7500','1000000','992500','1000000','1','1',now()+interval '1 hour')", [i, link, owner]);
    await run();
    expect(await alerts(i)).toEqual(["missing_receipt"]);
  });
  it("records chain findings through the alert function without duplicates", async () => {
    const i = await paidIntent();
    const once = await db.query<{ ok: boolean }>("select merchant_reconciliation_alert($1,'receipt_failed','reverted','high') ok", [i]);
    const twice = await db.query<{ ok: boolean }>("select merchant_reconciliation_alert($1,'receipt_failed','reverted','high') ok", [i]);
    expect([once.rows[0].ok, twice.rows[0].ok]).toEqual([true, false]);
    await expect(db.query("select merchant_reconciliation_alert($1,'made_up','x','high')", [i])).rejects.toThrow();
  });
});

describe("liveness alerts (0046)", () => {
  let live: PGlite;
  beforeAll(async () => {
    live = new PGlite();
    await live.exec("create role anon; create role authenticated; create role service_role;");
    for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql", "0045_merchant_refunds.sql", "0046_merchant_liveness_alerts.sql"]) await live.exec(sql(f));
  }, 30000);
  afterAll(async () => { await live?.close(); });
  const intent = async (status: string, createdAgo: string, checkedAgo: string, expiresIn = "1 hour") => {
    const owner = randomUUID(), link = randomUUID(), id = randomUUID();
    await live.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'M',$3,'T','1000000','merchant',array['base'],true,'link')", [link, owner, randomUUID()]);
    await live.query(`insert into merchant_payment_intents(id,link_id,merchant_id,chain,recipient,reference,status,gross_units,fee_units,charge_units,net_units,start_block,scan_block,expires_at,created_at,last_checked_at)
      values($1,$2,$3,'base','0xabc','r',$4,'1000000','7500','1000000','992500','1','1',now()+$5::interval,now()-$6::interval,now()-$7::interval)`, [id, link, owner, status, expiresIn, createdAgo, checkedAgo]);
    return id;
  };
  const kinds = async (id: string) => (await live.query<{ kind: string }>("select kind from merchant_reconciliation_alerts where intent_id=$1 order by kind", [id])).rows.map(r => r.kind);
  it("flags stuck confirmations, a stopped scanner and unreviewed holds, once each", async () => {
    const stuck = await intent("confirming", "2 hours", "1 minute");
    const stale = await intent("awaiting_payment", "30 minutes", "20 minutes");
    const held = await intent("review", "2 days", "1 day");
    const fine = await intent("awaiting_payment", "30 minutes", "1 minute");
    const expired = await intent("awaiting_payment", "2 hours", "2 hours", "-1 minute");
    expect((await live.query<{ n: number }>("select merchant_liveness() n")).rows[0].n).toBe(3);
    expect(await kinds(stuck)).toEqual(["confirmation_delayed"]);
    expect(await kinds(stale)).toEqual(["verification_stale"]);
    expect(await kinds(held)).toEqual(["review_overdue"]);
    expect(await kinds(fine)).toEqual([]);
    expect(await kinds(expired)).toEqual([]);
    expect((await live.query<{ n: number }>("select merchant_liveness() n")).rows[0].n).toBe(0);
  });
  it("does not nag about a held payment that has an operator decision", async () => {
    const held = await intent("review", "2 days", "1 day");
    await live.query("insert into merchant_review_notes(intent_id,author,decision,note) values($1,'ops','confirmed_hold','checked payer, holding')", [held]);
    await live.query("select merchant_liveness()");
    expect(await kinds(held)).toEqual([]);
  });
});
