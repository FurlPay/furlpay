#!/usr/bin/env node
// Applies repository migrations only to a fresh, in-memory PostgreSQL engine.
// No environment variables or network database connections are used.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// PGlite does not ship PostGIS. These are reported as unverified, not successful.
const POSTGIS = new Set(['0012_hotels_geo.sql', '0013_places_accommodation.sql', '0015_universal_hotels.sql']);
const db = new PGlite({ extensions: { citext, pg_trgm } });
const applied = [], skipped = [], failures = [];
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create function auth.role() returns text language sql as 'select null::text';
    -- Minimal Supabase Storage prerequisite for 0038, not an application table.
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  for (const file of readdirSync(resolve(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    if (POSTGIS.has(file)) { skipped.push({ file, reason: 'PostGIS unavailable in PGlite' }); continue; }
    await db.exec('begin');
    try {
      await db.exec(readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8'));
      await db.exec('commit');
      applied.push(file);
    } catch (error) {
      await db.exec('rollback');
      failures.push({ file, code: error.code, message: error.message });
    }
  }
  const proposed = process.argv.includes('--with-proposed-view-fix');
  let viewAccessProof = null;
  if (proposed) {
    // Prove actual row exposure, not just catalog privileges, then apply the
    // proposed patch only in this disposable engine and verify both roles.
    await db.exec(`insert into ledger_accounts(id,code,name,type,currency)
      values ('inventory_fixture','inventory_fixture','Synthetic','asset','USD');
      insert into ledger_transactions(id,memo) values ('inventory_tx','Synthetic');
      insert into ledger_postings(transaction_id,account_id,side,amount)
      values ('inventory_tx','inventory_fixture','debit',100);`);
    await db.exec('set role anon');
    const before = (await db.query('select * from ledger_imbalance')).rows[0].total_debits;
    await db.exec('reset role');
    await db.exec(readFileSync(resolve(ROOT, 'supabase/proposed/restrict_sensitive_views.sql'), 'utf8'));
    const views = (await db.query("select viewname from pg_views where schemaname='public' and viewname not like 'pg_%'")).rows;
    let refusals = 0;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const view of views) {
          try { await db.query(`select * from "${view.viewname.replaceAll('"', '""')}" limit 1`); }
          catch (e) { if (e.code !== '42501') throw e; refusals++; continue; }
          throw new Error(`Unexpected public access: ${role}.${view.viewname}`);
        }
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    const after = (await db.query('select * from ledger_imbalance')).rows[0].total_debits;
    for (const view of views) await db.query(`select * from "${view.viewname.replaceAll('"', '""')}" limit 1`);
    await db.exec('reset role');
    if (Number(before) !== 100 || Number(after) !== 100 || refusals !== views.length * 2) throw new Error('View isolation proof failed');
    viewAccessProof = { anonymousSyntheticBalanceBefore: before, publicRoleRefusalsAfter: refusals, serviceRoleSyntheticBalanceAfter: after, serviceRoleViewsReadable: views.length };
    // Reapplying is safe and does not recreate any table or alter data.
    await db.exec(readFileSync(resolve(ROOT, 'supabase/proposed/restrict_sensitive_views.sql'), 'utf8'));
  }
  const results = await db.exec(readFileSync(resolve(ROOT, 'scripts/db/schema-catalog.sql'), 'utf8'));
  const catalog = results.find(r => r.rows?.[0]?.catalog)?.rows[0].catalog;
  const rlsDisabled = catalog.tables.filter(t => !t.extension && !t.rlsEnabled).map(t => t.name);
  const publicPolicies = catalog.tables.filter(t => !t.extension && t.policies.length).map(t => ({ table: t.name, policies: t.policies }));
  const unsafeDefiners = catalog.functions.filter(f => f.securityDefiner && (f.execute?.anon || f.execute?.authenticated)).map(f => f.name);
  const publicReadableViews = catalog.views.filter(v => v.select?.anon || v.select?.authenticated);
  const missingPrimaryKeys = catalog.tables.filter(t => !t.extension && !t.constraints.some(c => c.type === 'p')).map(t => t.name);
  const invalidConstraints = catalog.tables.flatMap(t => t.constraints.filter(c => !c.validated).map(c => `${t.name}.${c.name}`));
  const summary = { environment: 'disposable local PGlite, not staging', proposedViewFix: proposed, viewAccessProof, applied, skipped, failures, publicTables: catalog.tables.length,
    rlsDisabled, publicPolicies, unsafeDefiners, publicReadableViews, missingPrimaryKeys, invalidConstraints,
    foreignKeysWithoutLeadingIndex: catalog.foreignKeysWithoutLeadingIndex };
  const output = process.argv.indexOf('--output');
  if (output !== -1) writeFileSync(process.argv[output + 1], JSON.stringify({ summary, catalog }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length || rlsDisabled.length || publicPolicies.length || unsafeDefiners.length || publicReadableViews.length || missingPrimaryKeys.length || invalidConstraints.length) process.exitCode = 1;
} catch (error) {
  console.error(`Local catalog verification failed: ${error.code ?? 'error'}: ${error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
