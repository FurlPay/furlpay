import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseBvnkEvent } from "../webhook";
import { isTerminal, recordFromEvent, type BvnkRecordRow } from "../records";

// Migration 0052 on PGlite, fed with rows built from BVNK's documented webhook
// examples through the same mapping the route uses.
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/migrations/0052_bvnk_records.sql"), "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8").trim();
const rowOf = (name: string) => {
  const raw = fixture(name);
  return recordFromEvent(parseBvnkEvent(raw, Date.parse(JSON.parse(raw).timestamp) + 1000)) as BvnkRecordRow;
};
const upsert = async (row: BvnkRecordRow) => (await db.query<{ r: string }>("select bvnk_record_upsert($1::jsonb) r", [JSON.stringify(row)])).rows[0].r;
const get = async (kind: string, id: string, dir = "") =>
  (await db.query<Record<string, string>>("select * from bvnk_records where kind=$1 and provider_id=$2 and direction=$3", [kind, id, dir])).rows[0];

describe("bvnk_records (0052)", () => {
  it("records a documented pay-in with exact amounts and its wallet", async () => {
    const row = rowOf("payment-payin-status-change-v-2");
    expect(await upsert(row)).toBe("inserted");
    const stored = await get("payin", row.provider_id, row.direction);
    expect(stored.status).toBe("COMPLETED");
    expect(stored.wallet_id).toBe(row.wallet_id);
    expect(String(stored.beneficiary_amount)).toBe(row.beneficiary_amount);
  });

  it("applies a newer report and ignores an older or repeated one (out-of-order safe)", async () => {
    const base = rowOf("payment-payout-status-change-v-2");
    const t0 = Date.parse(base.provider_updated_at);
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    expect(await upsert({ ...base, status: "PROCESSING", provider_updated_at: at(0) })).toBe("inserted");
    expect(await upsert({ ...base, status: "COMPLETED", provider_updated_at: at(60_000) })).toBe("updated");
    // A late PROCESSING delivery after COMPLETED must not regress the status.
    expect(await upsert({ ...base, status: "PROCESSING", provider_updated_at: at(30_000) })).toBe("stale");
    expect(await upsert({ ...base, status: "FAILED", provider_updated_at: at(60_000) })).toBe("stale");
    expect((await get("payout", base.provider_id, base.direction)).status).toBe("COMPLETED");
  });

  it("keeps IN and OUT of the same transfer as separate rows", async () => {
    const out = rowOf("payment-transfer-status-change-v-3");
    await upsert(out);
    await upsert({ ...out, direction: out.direction === "OUT" ? "IN" : "OUT" });
    const n = await db.query<{ n: number }>("select count(*)::int n from bvnk_records where kind='transfer' and provider_id=$1", [out.provider_id]);
    expect(n.rows[0].n).toBe(2);
  });

  it("stores amounts as exact numeric, never float", async () => {
    const row = { ...rowOf("payment-transfer-status-change-v-3"), provider_id: "exact-1", originator_amount: "0.1", beneficiary_amount: "123456789.123456" };
    await upsert(row);
    const s = await db.query<{ sum: string }>("select (originator_amount + 0.2)::text sum from bvnk_records where provider_id='exact-1' limit 1");
    expect(s.rows[0].sum).toBe("0.3");
  });

  it("refuses incomplete rows and negative amounts", async () => {
    await expect(db.query("select bvnk_record_upsert($1::jsonb)", [JSON.stringify({ kind: "payin" })])).rejects.toThrow(/incomplete/);
    const neg = { ...rowOf("payment-payin-status-change-v-2"), provider_id: "neg-1", originator_amount: "-1" };
    await expect(upsert(neg)).rejects.toThrow();
  });

  it("is closed to anon and authenticated", async () => {
    const g = await db.query<{ grantee: string }>("select grantee from information_schema.role_table_grants where table_name='bvnk_records'");
    const roles = new Set(g.rows.map((r) => r.grantee));
    expect(roles.has("anon") || roles.has("authenticated")).toBe(false);
  });

  it("marks only BVNK's documented final states terminal", () => {
    expect(isTerminal("transfer", "PROCESSING")).toBe(false);
    expect(isTerminal("transfer", "PENDING_QUOTE_ACCEPTANCE")).toBe(false);
    expect(isTerminal("transfer", "EXPIRED")).toBe(true);
    expect(isTerminal("payout", "ON_HOLD")).toBe(false);
    expect(isTerminal("payout", "RETURNED")).toBe(true);
  });

  it("customer status events carry no recordable money state", () => {
    const raw = fixture("platform-customer-status-change");
    expect(recordFromEvent(parseBvnkEvent(raw, Date.parse(JSON.parse(raw).timestamp) + 1000))).toBeNull();
  });
});
