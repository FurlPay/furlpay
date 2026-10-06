// ---------------------------------------------------------------------------
// SEC-P2-005 / migration 0031: no public-schema function is executable by anon
// or authenticated, because PostgREST publishes every function those roles can
// execute as /rest/v1/rpc/<name>.
//
// Runs the REAL migration SQL in PGlite with the Supabase roles and Supabase's
// default function privileges recreated, then calls the functions AS anon —
// first to show the exposure on the migrations as they stood, then to show
// 0031 closes it. PGlite lacks citext/postgis, so only the migrations defining
// the exposed money and webhook functions are applied (as in
// schemaAssertionsV2.spec.ts).
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
const BEFORE = [
  "0009_payments_and_ledger.sql",
  "0014_financial_transactions.sql",
  "0016_rls_money_tables.sql",
  "0020_control_plane.sql",
  "0021_recipient_attestation.sql",
  "0022_webhook_events.sql",
  "0024_webhook_claim_hash_guard.sql",
  "0030_cp_approval_decisions.sql",
];
const FIX = "0031_revoke_public_function_execute.sql";

const DEFINER_MONEY_FNS = [
  "ledger_post",
  "settle_payment_atomic",
  "ftx_transition",
  "claim_webhook_event",
  "mark_webhook_processed",
  "mark_webhook_failed",
];

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // What a Supabase project has before any migration runs: the API roles, and
  // default privileges that grant every new public function to them.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
    create or replace function auth.role() returns text language sql as 'select null::text';
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  for (const f of BEFORE) await db.exec(fs.readFileSync(path.join(DIR, f), "utf8"));
  await db.exec(`
    insert into ledger_accounts (id, code, name, type, currency) values
      ('acct_cash', '1000', 'Cash', 'asset', 'USD'),
      ('acct_user', '2000', 'User funds', 'liability', 'USD');
  `);
  return db;
}

const canExecute = async (db: PGlite, role: string, fn: string) =>
  (
    await db.query<{ ok: boolean }>(
      `select bool_or(has_function_privilege($1, p.oid, 'execute')) as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $2`,
      [role, fn]
    )
  ).rows[0].ok;

/** Every non-extension public function the role can execute. */
const executableBy = async (db: PGlite, role: string) =>
  (
    await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
          and has_function_privilege($1, p.oid, 'execute')
        order by 1`,
      [role]
    )
  ).rows.map((r) => r.proname);

async function asRole<T>(db: PGlite, role: string, sql: string): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
}

const FORGED_POST = `select ledger_post('lx_forged', 'forged by anon',
  '[{"account_id":"acct_cash","side":"debit","amount":5000000},{"account_id":"acct_user","side":"credit","amount":5000000}]'::jsonb)`;

describe("public-schema functions vs anon (SEC-P2-005)", () => {
  describe("migrations before 0031", () => {
    let db: PGlite;
    beforeAll(async () => {
      db = await freshDb();
    }, 60_000);

    it("left SECURITY DEFINER money/webhook functions executable by anon", async () => {
      for (const fn of DEFINER_MONEY_FNS) expect(await canExecute(db, "anon", fn), fn).toBe(true);
    });

    it("so anon could write a balanced ledger transaction past RLS", async () => {
      await asRole(db, "anon", FORGED_POST);
      const rows = (await db.query("select id from ledger_transactions where id = 'lx_forged'")).rows;
      expect(rows).toHaveLength(1);
    });
  });

  describe("with 0031 applied", () => {
    let db: PGlite;
    beforeAll(async () => {
      db = await freshDb();
      await db.exec(fs.readFileSync(path.join(DIR, FIX), "utf8"));
    }, 60_000);

    it("anon and authenticated can execute no public function", async () => {
      expect(await executableBy(db, "anon")).toEqual([]);
      expect(await executableBy(db, "authenticated")).toEqual([]);
    });

    it("anon's forged ledger_post is refused and writes nothing", async () => {
      await expect(asRole(db, "anon", FORGED_POST)).rejects.toThrow(/permission denied/);
      expect((await db.query("select id from ledger_transactions where id = 'lx_forged'")).rows).toHaveLength(0);
    });

    it("anon cannot mark a webhook processed (deposit suppression)", async () => {
      await expect(asRole(db, "anon", "select mark_webhook_processed('stripe', 'evt_1')")).rejects.toThrow(
        /permission denied/
      );
    });

    it("service_role keeps EXECUTE on every one of them", async () => {
      for (const fn of DEFINER_MONEY_FNS) expect(await canExecute(db, "service_role", fn), fn).toBe(true);
      await asRole(db, "service_role", FORGED_POST.replace("lx_forged", "lx_service"));
      expect((await db.query("select id from ledger_transactions where id = 'lx_service'")).rows).toHaveLength(1);
    });

    it("a function added by a LATER migration is not executable by anon either", async () => {
      await db.exec("create function later_migration_fn() returns int language sql as 'select 1'");
      expect(await canExecute(db, "anon", "later_migration_fn")).toBe(false);
      expect(await canExecute(db, "authenticated", "later_migration_fn")).toBe(false);
      expect(await canExecute(db, "service_role", "later_migration_fn")).toBe(true);
    });

    it("is idempotent (re-applying changes nothing and does not fail)", async () => {
      await db.exec(fs.readFileSync(path.join(DIR, FIX), "utf8"));
      expect(await executableBy(db, "anon")).toEqual([]);
    });
  });
});
