#!/usr/bin/env node
// Upgrade safety for migrations 0032 + 0034 against a REAL PostgreSQL that
// already applied the FIRST committed version of 0032 (git 2e5f3657).
//
//   DATABASE_URL=postgres://.../<name>_test node scripts/db/verify-onchain-upgrade.mjs [<git-ref>]
//
// U-1  the original 0032 (read from git) applies and stores an event.
// U-2  the current 0032 + 0034 apply on top of it, twice (idempotent).
// U-3  the existing row survives unchanged, with the new columns defaulted.
// U-4  new sources/changes are accepted (node_rpc, source_conflict path).
// U-5  calls written against either function signature are unambiguous:
//      onchain_mark_reorged(2 args | 3 args), onchain_node_cursor_advance(EVM 5 args | Solana 6 args).
// U-6  0034 objects exist and work on the upgraded database.
//
// Refuses unless the database name ends in `_test`.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REF = process.argv[2] ?? "2e5f3657";
const url = process.env.DATABASE_URL ?? "";
if (!/_test(\?|$)/.test(url)) {
  console.error("refusing: DATABASE_URL must point at a throwaway database whose name ends in _test");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 4 });
const q = (sql, params) => pool.query(sql, params);
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ok  ${name}`);
};
const current = (f) => readFileSync(join(ROOT, "supabase", "migrations", f), "utf8");
const original = execFileSync("git", ["show", `${REF}:supabase/migrations/0032_onchain_ingestion.sql`], { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

const ev = (over = {}) => ({
  event_key: "base:0xabc1111111111111111111111111111111111111111111111111111111111111:7",
  source: "allium_beam",
  chain: "base",
  tx_hash: "0xabc1111111111111111111111111111111111111111111111111111111111111",
  block_number: 100,
  block_hash: "0xb100",
  block_timestamp: "2026-10-06T10:15:00Z",
  log_index: 7,
  from_address: "0xfrom",
  to_address: "0xto",
  asset_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  asset_symbol: "USDC",
  asset_decimals: 6,
  amount_raw: "1250000000",
  amount: "1250",
  amount_usd: "1250",
  activity_type: "transfer",
  direction: "in",
  tracked_address: "0xto",
  scope: "treasury",
  confirmation_state: "confirmed",
  ...over,
});

try {
  const [{ n }] = (await q("select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'onchain_%'")).rows;
  if (n > 0) throw new Error("database already has onchain_* tables; use a fresh _test database");
  await q(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create table if not exists users (id uuid primary key);`);

  // U-1
  await q(original);
  const r0 = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([ev()])])).rows[0].r;
  assert.equal(r0.inserted, 1);
  const before = (await q("select event_key, amount_raw::text, confirmation_state, revision from onchain_events")).rows;
  ok(`U-1 original 0032 (${REF}) applied; one event stored`);

  // U-2
  for (let i = 0; i < 2; i++) {
    await q(current("0032_onchain_ingestion.sql"));
    await q(current("0034_onchain_asset_index.sql"));
  }
  ok("U-2 current 0032 + 0034 apply on top, twice");

  // U-3
  const after = (await q("select event_key, amount_raw::text, confirmation_state, revision, reorg_final from onchain_events")).rows;
  assert.deepEqual(after.map(({ reorg_final, ...r }) => r), before);
  assert.equal(after[0].reorg_final, false);
  assert.equal((await q("select count(*)::int n from information_schema.columns where table_name = 'onchain_ingest_metrics' and column_name = 'conflicts'")).rows[0].n, 1);
  ok("U-3 existing data preserved; new columns present and defaulted");

  // U-4
  const k2 = "base:0xabc2222222222222222222222222222222222222222222222222222222222222:1";
  const r1 = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([ev({ event_key: k2, tx_hash: "0xabc2222222222222222222222222222222222222222222222222222222222222", log_index: 1, source: "node_rpc" })])])).rows[0].r;
  assert.equal(r1.inserted, 1);
  // amount disagreement from another source -> source_conflict revision (new change kind)
  const r2 = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([ev({ amount_raw: "1", amount: "0.000001" })])])).rows[0].r;
  assert.equal(r2.conflicts, 1);
  assert.equal((await q("select count(*)::int n from onchain_event_revisions where change = 'source_conflict'")).rows[0].n, 1);
  ok("U-4 node_rpc source and source_conflict revisions accepted after upgrade");

  // U-5
  assert.equal((await q("select count(*)::int n from pg_proc where proname = 'onchain_mark_reorged'")).rows[0].n, 1);
  assert.equal((await q("select count(*)::int n from pg_proc where proname = 'onchain_node_cursor_advance'")).rows[0].n, 1);
  assert.equal((await q("select onchain_mark_reorged(p_event_key => $1, p_reason => 'test') r", [k2])).rows[0].r, true);
  assert.equal((await q("select onchain_mark_reorged(p_event_key => $1, p_reason => 'proof', p_final => true) r", [k2])).rows[0].r, true);
  assert.equal((await q("select onchain_node_cursor_advance(p_chain => 'base', p_chain_id => 8453, p_expected => null, p_next => 1, p_hash => '0xh') r")).rows[0].r, true);
  assert.equal((await q("select onchain_node_cursor_advance(p_chain => 'solana', p_chain_id => null, p_expected => null, p_next => 1, p_hash => 'h', p_genesis => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') r")).rows[0].r, true);
  ok("U-5 one signature per function; EVM and Solana calls are unambiguous");

  // U-6
  assert.equal((await q("select onchain_asset_anchor('base', 'usdc', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 8453, 10, '0xh10', now(), 5, 6::smallint, 'test') a")).rows[0].a, true);
  const c = (await q("select onchain_asset_commit('base', 'usdc', 8453, 10, 11, 12, '0xh10', '0xh12', now(), $1::jsonb, '[]'::jsonb, 5, 6::smallint, 'test', 1) r", [JSON.stringify({ transfers: 0, transfer_raw: "0", mints: 0, mint_raw: "0", burns: 0, burn_raw: "0" })])).rows[0].r;
  assert.deepEqual(c, { ok: true, reconciled: true });
  ok("U-6 0034 objects work on the upgraded database");

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("FAILED:", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
