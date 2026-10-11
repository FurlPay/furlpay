import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// 0043 on PGlite: Sui destinations, links and a full collection through 0040's functions.
let db: PGlite;
const sql = (f: string) => readFileSync(resolve(process.cwd(), `../../supabase/migrations/${f}`), "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const f of ["0009_payments_and_ledger.sql", "0040_stablecoin_payments.sql", "0041_merchant_webhooks.sql", "0042_payroll_and_merchant_extensions.sql", "0043_sui_collection.sql", "0044_payroll_contractor_self_service.sql", "0045_merchant_refunds.sql", "0046_merchant_liveness_alerts.sql", "0047_arc_testnet_collection.sql"]) await db.exec(sql(f));
}, 30000);
afterAll(async () => { await db?.close(); });
const SUI = "0x9f63425709069336fec108bd4ba69a8f3d23e8ab237311f3ce58ae2bb0ed4d7f";
const dest = (owner: string, chain: string, address: string) => db.query("insert into merchant_payment_destinations(merchant_id,chain,address,custody_reference,approved_at) values($1,$2,$3,'ref',now())", [owner, chain, address]);

describe("Sui collection schema (0043)", () => {
  it("accepts full lowercase Sui addresses only, and keeps EVM/Solana rules", async () => {
    await expect(dest(randomUUID(), "sui", SUI)).resolves.toBeTruthy();
    await expect(dest(randomUUID(), "sui", SUI.toUpperCase().replace("0X", "0x"))).rejects.toThrow();
    await expect(dest(randomUUID(), "sui", "0x" + "0".repeat(64))).rejects.toThrow();
    await expect(dest(randomUUID(), "sui", "0x" + "ab".repeat(20))).rejects.toThrow();
    await expect(dest(randomUUID(), "base", SUI)).rejects.toThrow();
    await expect(dest(randomUUID(), "base", "0x" + "ab".repeat(20))).resolves.toBeTruthy();
    await expect(dest(randomUUID(), "aptos", SUI)).rejects.toThrow();
    // 0047: Arc testnet uses EVM addresses.
    await expect(dest(randomUUID(), "arc-testnet", "0x" + "ab".repeat(20))).resolves.toBeTruthy();
    await expect(dest(randomUUID(), "arc-testnet", SUI)).rejects.toThrow();
  });
  it("reserves a Sui checkout and credits a verified receipt through the balanced journal", async () => {
    const owner = randomUUID(), slug = randomUUID(), intent = randomUUID();
    const address = "0x" + randomUUID().replaceAll("-", "").padEnd(64, "a");
    await db.query("insert into merchant_payment_links(id,merchant_id,merchant_name,slug,title,amount_units,fee_payer,chains,reusable,kind) values($1,$2,'M',$3,'Order','1462500','merchant',array['arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche','sui','arc-testnet'],true,'link')", [randomUUID(), owner, slug]);
    await dest(owner, "sui", address);
    const r = await db.query<{ recipient: string }>("select recipient from merchant_checkout_reserve($1,$2,'sui','ref','331902700')", [intent, slug]);
    expect(r.rows[0].recipient).toBe(address);
    const paid = await db.query<{ status: string }>("select status from merchant_payment_receive($1,'4bmJYoQ1K3HSgLq5xRMKNwNfzrcQQc39c7uJgvK2UqH8',0,'1462500',$2,'331902798','2hcjZM1pxWyJd5vKag2nPQg9e9QwTPYZahL7WusHmGaj',now(),1)", [intent, "0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114"]);
    expect(paid.rows[0].status).toBe("paid");
    const bal = await db.query<{ b: string }>("select ledger_account_balance($1)::text b", [`mp:treasury:sui`]);
    expect(bal.rows[0].b).toBe("1462500");
    expect((await db.query<{ n: number }>("select merchant_reconcile(now() - interval '1 hour') n")).rows[0].n).toBe(0);
  });
});
