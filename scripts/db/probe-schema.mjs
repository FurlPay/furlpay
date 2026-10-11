#!/usr/bin/env node
// READ-ONLY schema probe: what the repository expects vs what a database has
// (audit P1-2). Runs only SELECTs — safe against production.
//
//   DATABASE_URL=postgres://...  node scripts/db/probe-schema.mjs [--json out.json]
//
// Use the Supabase SESSION pooler (port 5432) or a direct connection with a
// read-only role. Nothing here writes, locks or alters anything.
//
// Reports, per migration in supabase/migrations, whether the objects it is
// known to create exist, plus the recorded migration history, and exits 1 when
// anything the money path depends on is missing.

import { readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Objects whose presence proves a migration ran. Money-path objects are
// `critical`: their absence means code already deployed assumes a table,
// function or constraint the database does not have.
export const EXPECTED = [
  { migration: "0001", kind: "table", name: "users", critical: true },
  { migration: "0001", kind: "table", name: "token_balances", critical: true },
  { migration: "0004", kind: "function", name: "save_account_children", critical: true },
  { migration: "0005", kind: "table", name: "linked_wallets", critical: true },
  { migration: "0006", kind: "table", name: "corporate_actions", critical: false },
  { migration: "0006", kind: "table", name: "trade_lots", critical: false },
  { migration: "0006", kind: "column", name: "trade_lots.provenance", critical: false },
  { migration: "0009", kind: "table", name: "ledger_transactions", critical: true },
  { migration: "0009", kind: "table", name: "ledger_postings", critical: true },
  { migration: "0009", kind: "function", name: "ledger_post", critical: true },
  { migration: "0009", kind: "trigger", name: "ledger_postings_no_update", critical: true },
  { migration: "0014", kind: "table", name: "financial_transactions", critical: false },
  { migration: "0017", kind: "function", name: "furlpay_missing_constraints", critical: true },
  { migration: "0022", kind: "table", name: "webhook_events", critical: true },
  { migration: "0022", kind: "function", name: "claim_webhook_event", critical: true },
  { migration: "0024", kind: "function_src", name: "claim_webhook_event", contains: "payload_hash = excluded.payload_hash", critical: true },
  { migration: "0025", kind: "column", name: "ledger_transactions.external_ref", critical: true },
  { migration: "0025", kind: "index", name: "ledger_tx_external_ref_uniq", critical: true },
  { migration: "0025", kind: "function", name: "apply_financial_effect", critical: true },
  { migration: "0025", kind: "function_src", name: "save_account_children", contains: "intentionally untouched", critical: true },
  { migration: "0026", kind: "table", name: "cashback_accruals", critical: true },
  { migration: "0026", kind: "function", name: "claim_cashback", critical: true },
  // Analytics (0027): not money-path. The dashboard degrades to bounded row
  // reads without it and says so, so these are reported but not critical.
  { migration: "0027", kind: "table", name: "analytics_events", critical: false },
  { migration: "0027", kind: "function", name: "analytics_tx_buckets", critical: false },
  { migration: "0027", kind: "function", name: "analytics_rail_users", critical: false },
  { migration: "0027", kind: "function", name: "analytics_active_users", critical: false },
  { migration: "0027", kind: "function", name: "analytics_signup_cohort", critical: false },
  { migration: "0027", kind: "function", name: "analytics_signup_starts", critical: false },
  { migration: "0027", kind: "index", name: "users_created_at_idx", critical: false },
  { migration: "0027", kind: "index", name: "audit_log_created_at_idx", critical: false },
  { migration: "0028", kind: "column", name: "analytics_events.platform", critical: false },
  { migration: "0028", kind: "table", name: "user_devices", critical: false },
  { migration: "0028", kind: "function", name: "analytics_touch_device", critical: false },
  { migration: "0028", kind: "function", name: "analytics_platforms", critical: false },
  { migration: "0028", kind: "function", name: "analytics_versions", critical: false },
  // Non-critical: without 0029 the username save answers 503 "not enabled".
  { migration: "0029", kind: "column", name: "users.username", critical: false },
  { migration: "0029", kind: "index", name: "users_username_key", critical: false },
  { migration: "0029", kind: "function", name: "set_username", critical: false },
];

async function present(c, e) {
  switch (e.kind) {
    case "table":
      return (await c.query("select to_regclass($1) is not null ok", [`public.${e.name}`])).rows[0].ok;
    case "column": {
      const [t, col] = e.name.split(".");
      return (await c.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2) ok", [t, col])).rows[0].ok;
    }
    case "function":
      return (await c.query("select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1) ok", [e.name])).rows[0].ok;
    case "function_src":
      return (await c.query("select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and p.prosrc like '%' || $2 || '%') ok", [e.name, e.contains])).rows[0].ok;
    case "index":
      return (await c.query("select exists(select 1 from pg_indexes where schemaname='public' and indexname=$1) ok", [e.name])).rows[0].ok;
    case "trigger":
      return (await c.query("select exists(select 1 from pg_trigger where tgname=$1) ok", [e.name])).rows[0].ok;
    default:
      throw new Error(`unknown kind ${e.kind}`);
  }
}

// Access control the application relies on (read-only catalog queries). A row
// passes when the privilege matches `expect`; an absent object is reported as
// such, not as a pass.
export const PRIVILEGES = [
  { what: "RLS enabled on analytics_events", sql: "select relrowsecurity v from pg_class where oid = to_regclass('public.analytics_events')", expect: true },
  ...["anon", "authenticated"].flatMap((role) => [
    { what: `${role} cannot SELECT analytics_events`, sql: `select has_table_privilege('${role}', 'public.analytics_events', 'SELECT') v`, expect: false },
    ...["analytics_tx_buckets(timestamptz, timestamptz, text, text)", "analytics_active_users(timestamptz, timestamptz, text)", "analytics_signup_cohort(timestamptz, timestamptz, text)"].map((fn) => ({
      what: `${role} cannot EXECUTE ${fn.split("(")[0]}`,
      sql: `select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') v`,
      expect: false,
    })),
  ]),
  { what: "service_role can SELECT analytics_events", sql: "select has_table_privilege('service_role', 'public.analytics_events', 'SELECT') v", expect: true },
  // 0031 (SEC-P2-005): PostgREST publishes every function anon/authenticated
  // can execute at /rest/v1/rpc/<name>. Extension-owned functions excluded.
  ...["anon", "authenticated"].map((role) => ({
    what: `${role} can EXECUTE no public function (0031)`,
    sql: `select count(*)::int v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
             and has_function_privilege('${role}', p.oid, 'EXECUTE')`,
    expect: 0,
  })),
];

async function privilegeChecks(c) {
  const out = [];
  for (const p of PRIVILEGES) {
    try {
      const v = (await c.query(p.sql)).rows[0]?.v;
      out.push({ what: p.what, ok: v === p.expect, value: v ?? null });
    } catch (e) {
      out.push({ what: p.what, ok: false, value: `unavailable: ${e.message.slice(0, 80)}` });
    }
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (read-only role recommended).");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  const repo = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  const history = await client
    .query("select version from supabase_migrations.schema_migrations order by version")
    .then((r) => r.rows.map((x) => String(x.version)))
    .catch(() => null);
  const objects = [];
  for (const e of EXPECTED) objects.push({ ...e, present: await present(client, e) });
  const missingGuards = await client
    .query("select constraint_name, purpose from furlpay_missing_constraints()")
    .then((r) => r.rows)
    .catch((e) => [{ constraint_name: "(probe unavailable)", purpose: e.message }]);
  const privileges = await privilegeChecks(client);
  await client.end();

  const report = {
    probed_at: new Date().toISOString(),
    repo_migrations: repo,
    recorded_history: history ?? "supabase_migrations.schema_migrations not readable",
    objects,
    furlpay_missing_constraints: missingGuards,
    privileges,
  };
  for (const o of objects) console.log(`${o.present ? "  ok     " : "  MISSING"} ${o.migration} ${o.kind} ${o.name}${o.critical ? "" : " (non-critical)"}`);
  for (const p of privileges) console.log(`${p.ok ? "  ok     " : "  FAIL   "} privilege: ${p.what} (${JSON.stringify(p.value)})`);
  console.log(`missing uniqueness guards: ${missingGuards.length ? missingGuards.map((g) => g.constraint_name).join(", ") : "none"}`);
  const i = process.argv.indexOf("--json");
  if (i > -1) writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2));
  const criticalMissing = objects.filter((o) => o.critical && !o.present).length + missingGuards.length;
  process.exit(criticalMissing ? 1 : 0);
}

/**
 * Strip the DATABASE_URL password (raw and percent-decoded) from a message
 * before it is printed. A driver error can echo part of the URI — notably when
 * a password containing "@" or ":" was not percent-encoded and the parser took
 * a fragment of it for the host (ENOTFOUND <fragment>). Exit-2 output is what
 * an operator pastes into a ticket or chat, so it must never carry the secret.
 */
export function redactSecret(message, url = process.env.DATABASE_URL) {
  let out = String(message ?? "");
  if (!url) return out;
  const secrets = new Set();
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^:/?#@]*:(.*)@[^@]*$/i.exec(url);
  if (m && m[1]) {
    secrets.add(m[1]);
    try {
      secrets.add(decodeURIComponent(m[1]));
    } catch {
      /* malformed escape: the raw form is already covered */
    }
    // Fragments either side of a stray "@" are what a mis-parse exposes.
    for (const part of m[1].split(/[@:]/)) if (part.length >= 4) secrets.add(part);
  }
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) if (s) out = out.split(s).join("[redacted]");
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(redactSecret(e?.message ?? e));
    process.exit(2);
  });
}
