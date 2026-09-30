// ---------------------------------------------------------------------------
// Migration 0023: furlpay_missing_constraints() sees every uniqueness guard the
// money and webhook paths rely on — constraints AND unique indexes.
//
// Runs the REAL migration SQL in PGlite (in-process Postgres). PGlite lacks the
// citext/postgis extensions some early migrations need, so only the migrations
// that define the guarded tables are applied: 0009, 0014, 0016, 0017, 0020,
// 0022, 0023. That is enough to prove the function's logic; it proves nothing
// about which migrations a real database has — that is what the function is
// FOR, run against production by an operator (docs/release/PRODUCTION_CAPABILITY_MATRIX.md).
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
const APPLY = [
  "0009_payments_and_ledger.sql",
  "0014_financial_transactions.sql",
  "0016_rls_money_tables.sql",
  "0017_schema_assertions.sql",
  "0020_control_plane.sql",
  "0022_webhook_events.sql",
  "0023_schema_assertions_v2.sql",
];

const NEW_GUARDS = [
  "webhook_events_provider_provider_event_id_key",
  "payments_idempotency_uniq",
  "payments_tx_uniq",
  "ledger_transactions_reverses_uniq",
  "ftx_idempotency_uniq",
  "ftx_provider_ref_uniq",
  "ftx_chain_tx_uniq",
  "cp_mandates_nonce_uniq",
  "cp_auth_idem_uniq",
];

let db: PGlite;
const missing = async () =>
  (await db.query<{ constraint_name: string }>("select constraint_name from furlpay_missing_constraints()")).rows.map(
    (r) => r.constraint_name
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create schema if not exists auth;" +
      "create or replace function auth.uid() returns uuid language sql as 'select null::uuid';" +
      "create or replace function auth.role() returns text language sql as 'select null::text';"
  );
  for (const f of APPLY) await db.exec(fs.readFileSync(path.join(DIR, f), "utf8"));
}, 60_000);

describe("furlpay_missing_constraints() v2", () => {
  it("finds all nine newer guards when their migrations are applied", async () => {
    const gone = await missing();
    for (const g of NEW_GUARDS) expect(gone).not.toContain(g);
    // 0006/0008 were not applied here, so their guards are honestly reported.
    expect(gone.sort()).toEqual(["dividend_once_per_user", "reorg_once_per_user"]);
  });

  it("reports a dropped unique INDEX and a dropped unique CONSTRAINT", async () => {
    await db.exec("drop index payments_idempotency_uniq");
    await db.exec("alter table webhook_events drop constraint webhook_events_provider_provider_event_id_key");
    const gone = await missing();
    expect(gone).toContain("payments_idempotency_uniq");
    expect(gone).toContain("webhook_events_provider_provider_event_id_key");
  });
});
