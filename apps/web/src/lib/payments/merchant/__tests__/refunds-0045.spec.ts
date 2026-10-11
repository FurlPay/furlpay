import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// Refund lifecycle (0045) on real collections made by 0040's functions. The
// trial balance (sum of signed postings) must be zero after every step.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql", "0045_merchant_refunds.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });

const PAYER = "0x" + "aa".repeat(20);
async function collected(amount: string) {
  const owner = randomUUID(), slug = randomUUID(), intent = randomUUID(), recipient = `0x${randomUUID().replaceAll("-", "").padEnd(40, "b")}`;
  await db.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'M',$3,'Order','1000000000','merchant',array['base'],true,'link')", [randomUUID(), owner, slug]);
  await db.query("insert into merchant_payment_destinations(merchant_id,chain,address,custody_reference,approved_at) values($1,'base',$2,'ref',now())", [owner, recipient]);
  await db.query("select merchant_checkout_reserve($1,$2,'base','r','100')", [intent, slug]);
  await db.query("select merchant_payment_receive($1,$2,0,$3,$4,'101','blk',now(),1)", [intent, "0x" + randomUUID().replaceAll("-", "").padEnd(64, "1"), amount, PAYER]);
  return { owner, intent, recipient };
}
const request = (o: { owner: string; intent: string }, amount: number, to = PAYER, id = randomUUID()) =>
  db.query<{ id: string; status: string; from_hold_units: number | string; from_merchant_units: number | string }>("select * from merchant_refund_request($1,$2,$3,$4,$5,'customer returned goods','merchant')", [id, o.owner, o.intent, amount, to])
    // bigint columns come back as numbers from PGlite and strings from PostgREST: compare as text.
    .then(r => ({ ...r.rows[0], from_hold_units: String(r.rows[0].from_hold_units), from_merchant_units: String(r.rows[0].from_merchant_units) }));
const bal = async (a: string) => BigInt((await db.query<{ b: string }>("select ledger_account_balance($1)::text b", [a])).rows[0].b);
const trial = async () => (await db.query<{ d: string }>("select coalesce(sum(case when side='debit' then amount else -amount end),0)::text d from ledger_postings")).rows[0].d;

describe("merchant refunds (0045)", () => {
  it("reserves a refund from the merchant's net, keeps the books balanced, and refuses over-refunds", async () => {
    const o = await collected("1000000000"); // paid exactly: net 992,500,000 to the merchant
    const r = await request(o, 500_000_000);
    expect(r).toMatchObject({ status: "requested", from_hold_units: "0", from_merchant_units: "500000000" });
    expect(await bal(`mp:merchant:${o.owner}:base`)).toBe(492_500_000n);
    expect(await bal("mp:refunds:base")).toBeGreaterThanOrEqual(500_000_000n);
    expect(await trial()).toBe("0");
    await expect(request(o, 492_500_001)).rejects.toThrow("exceeds_refundable");
    await expect(request(o, 492_500_000)).resolves.toMatchObject({ status: "requested" });
    await expect(request(o, 1)).rejects.toThrow("exceeds_refundable");
  });

  it("refunds an overpayment's excess from the hold first", async () => {
    const o = await collected("1100000000"); // 100,000,000 excess held
    const r = await request(o, 150_000_000);
    expect(r).toMatchObject({ from_hold_units: "100000000", from_merchant_units: "50000000" });
    expect(await bal(`mp:hold:${o.intent}`)).toBe(0n);
    expect(await trial()).toBe("0");
  });

  it("only refunds to an address that paid this intent", async () => {
    const o = await collected("1000000000");
    await expect(request(o, 1_000_000, "0x" + "cc".repeat(20))).rejects.toThrow("refund_address_not_payer");
  });

  it("is idempotent per refund id and refuses another merchant's intent", async () => {
    const o = await collected("1000000000"); const id = randomUUID();
    await request(o, 10_000_000, PAYER, id);
    await request(o, 10_000_000, PAYER, id);
    expect((await db.query<{ n: number }>("select count(*)::int n from merchant_refunds where intent_id=$1", [o.intent])).rows[0].n).toBe(1);
    await expect(request({ owner: randomUUID(), intent: o.intent }, 1_000_000)).rejects.toThrow("intent_missing");
  });

  it("cancels before execution with a single traceable reversal that restores balances", async () => {
    const o = await collected("1000000000");
    const before = await bal(`mp:merchant:${o.owner}:base`);
    const r = await request(o, 200_000_000);
    await db.query("select merchant_refund_cancel($1,$2)", [r.id, o.owner]);
    await db.query("select merchant_refund_cancel($1,$2)", [r.id, o.owner]); // second cancel is a no-op
    expect(await bal(`mp:merchant:${o.owner}:base`)).toBe(before);
    expect((await db.query<{ n: number }>("select count(*)::int n from ledger_transactions where reverses=$1", [`mp:refund:${r.id}:reserve`])).rows[0].n).toBe(1);
    expect(await trial()).toBe("0");
    await expect(request(o, 992_500_000)).resolves.toBeTruthy(); // the cancelled amount is refundable again
  });

  it("completes only after approval, only for the exact transfer, and never twice", async () => {
    const o = await collected("1000000000");
    const r = await request(o, 300_000_000);
    const tx = "0x" + "9".repeat(64);
    const complete = (amount: number, from = o.recipient, to = PAYER, txh = tx) => db.query("select merchant_refund_complete($1,$2,7,$3,$4,$5,'200',now())", [r.id, txh, amount, from, to]);
    await expect(complete(300_000_000)).rejects.toThrow("not_approved");
    await db.query("select merchant_refund_approve($1,'ops-1')", [r.id]);
    await expect(db.query("select merchant_refund_cancel($1,$2)", [r.id, o.owner])).rejects.toThrow("not_cancellable");
    await expect(complete(299_999_999)).rejects.toThrow("amount_mismatch");
    await expect(complete(300_000_000, "0x" + "dd".repeat(20))).rejects.toThrow("party_mismatch");
    await expect(complete(300_000_000, o.recipient, "0x" + "dd".repeat(20))).rejects.toThrow("party_mismatch");
    const treasury = await bal("mp:treasury:base");
    await complete(300_000_000, o.recipient.toUpperCase().replace("0X", "0x"), PAYER);
    expect(await bal("mp:treasury:base")).toBe(treasury - 300_000_000n);
    await complete(300_000_000); // same transfer again: idempotent no-op
    expect(await bal("mp:treasury:base")).toBe(treasury - 300_000_000n);
    expect(await trial()).toBe("0");
    // The same chain transfer cannot settle a second refund.
    const r2 = await request(o, 1_000_000);
    await db.query("select merchant_refund_approve($1,'ops-1')", [r2.id]);
    await expect(db.query("select merchant_refund_complete($1,$2,7,1000000,$3,$4,'200',now())", [r2.id, tx, o.recipient, PAYER])).rejects.toThrow();
  });

  it("refuses to treat a customer's payment transfer as a refund", async () => {
    const o = await collected("1000000000");
    const pay = (await db.query<{ tx_hash: string }>("select tx_hash from merchant_payment_receipts where intent_id=$1", [o.intent])).rows[0].tx_hash;
    const r = await request(o, 1_000_000);
    await db.query("select merchant_refund_approve($1,'ops-1')", [r.id]);
    await expect(db.query("select merchant_refund_complete($1,$2,0,1000000,$3,$4,'200',now())", [r.id, pay, o.recipient, PAYER])).rejects.toThrow("transfer_is_a_payment");
  });
});
