import { afterAll,beforeAll,describe,it,expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// Executes the actual migrations. PGlite has one connection: these assertions
// prove SQL behavior and atomic rollback, not multi-connection lock contention.
let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(resolve(process.cwd(),"../../supabase/migrations/0009_payments_and_ledger.sql"),"utf8"));
  await db.exec(readFileSync(resolve(process.cwd(),"../../supabase/migrations/0040_stablecoin_payments.sql"),"utf8"));
},30000);
afterAll(async()=>{await db?.close();});
async function link(reusable=true,kind="link"){
  const id=randomUUID(),owner=randomUUID(),slug=randomUUID();
  await db.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'Merchant',$3,'Order','1000000000','merchant',array['base'],$4,$5)",[id,owner,slug,reusable,kind]);
  await db.query("insert into merchant_payment_destinations(merchant_id,chain,address,custody_reference,approved_at) values($1,'base',$2,'provider-wallet-reference',now())",[owner,`0x${randomUUID().replaceAll("-","").padEnd(40,"a")}`]);
  return {id,owner,slug};
}
async function reserve(slug:string,id=randomUUID()){
  const result=await db.query<{id:string;recipient:string;status:string;created_at:string}>("select * from merchant_checkout_reserve($1,$2,'base','reference','100')",[id,slug]);return result.rows[0];
}
async function receive(id:string,amount:string,tx=randomUUID(),log=0){
  const row=await db.query<{status:string;received_units:string;ledger_tx_id:string}>("select * from merchant_payment_receive($1,$2,$3,$4,'payer','101','block',now(),1)",[id,tx,log,amount]);return {row:row.rows[0],tx};
}
describe("durable merchant collection",()=>{
  it("reserves once and never reuses a destination",async()=>{
    const l=await link();const i=await reserve(l.slug);expect((await reserve(l.slug,i.id)).recipient).toBe(i.recipient);
    await expect(reserve(l.slug)).rejects.toThrow("rail_unavailable");
  });
  it("refuses a second active checkout on a single-use link",async()=>{const l=await link(false);await reserve(l.slug);await expect(reserve(l.slug)).rejects.toThrow("checkout_in_progress");});
  it("holds underpayments, credits only the complete amount, and does not replay",async()=>{
    const l=await link();const i=await reserve(l.slug);const first=await receive(i.id,"990000000");expect(first.row.status).toBe("underpaid");
    expect((await receive(i.id,"990000000",first.tx)).row.received_units).toBe("990000000");
    const last=await receive(i.id,"10000000");expect(last.row.status).toBe("paid");
    const balance=await db.query<{balance:string}>("select ledger_account_balance($1)::text as balance",[`mp:merchant:${l.owner}:base`]);expect(balance.rows[0].balance).toBe("992500000");
    const fees=await db.query<{amount:string}>("select sum(amount)::text as amount from ledger_postings where transaction_id=$1 and account_id='mp:fees:base'",[last.row.ledger_tx_id]);expect(fees.rows[0].amount).toBe("7500000");
    const outbox=await db.query("select * from merchant_payment_outbox where intent_id=$1",[i.id]);expect(outbox.rows).toHaveLength(1);
  });
  it("isolates an overpayment as a refundable liability, including micro-units",async()=>{
    const l=await link();const i=await reserve(l.slug);expect((await receive(i.id,"1100000001")).row.status).toBe("overpaid");
    const balances=await db.query<{hold:string;net:string}>("select ledger_account_balance($1)::text as hold, ledger_account_balance($2)::text as net",[`mp:hold:${i.id}`,`mp:merchant:${l.owner}:base`]);expect(balances.rows[0]).toEqual({hold:"100000001",net:"992500000"});
  });
  it("rejects transfer reuse by a different checkout",async()=>{
    const l=await link();const i=await reserve(l.slug);const result=await receive(i.id,"1000000000");const other=await link();const second=await reserve(other.slug);await expect(receive(second.id,"1000000000",result.tx)).rejects.toThrow("receipt_already_claimed");
    const evidence=await db.query("select * from merchant_payment_receipts where intent_id=$1",[second.id]);expect(evidence.rows).toHaveLength(0);
  });
  it("commits invoice completion and both outbox events with the journal",async()=>{
    const l=await link(false,"invoice");const i=await reserve(l.slug);await receive(i.id,"1000000000");
    const result=await db.query<{type:string}>("select type from merchant_payment_outbox where intent_id=$1 order by type",[i.id]);expect(result.rows.map(r=>r.type)).toEqual(["invoice.paid","payment.succeeded"]);
    const imbalance=await db.query<{imbalance:string}>("select imbalance::text from ledger_imbalance");expect(imbalance.rows[0].imbalance).toBe("0");
  });
  it("keeps evidence immutable and anonymous callers out",async()=>{
    await expect(db.exec("delete from merchant_payment_receipts")).rejects.toThrow("append-only");
    await db.exec("set role anon");try{await expect(db.exec("select * from merchant_payment_intents")).rejects.toThrow("permission denied");}finally{await db.exec("reset role");}
  });
});
