#!/usr/bin/env node
// Migration 0032 (onchain ingestion read model) against a REAL PostgreSQL.
//
//   DATABASE_URL=postgres://.../<name>_test node scripts/db/verify-onchain-ingest.mjs
//
// Applies the REAL migration file (plus the minimal `users` table it
// references) and proves:
//
//   I-1  20 concurrent deliveries of one event on 20 connections -> 1 row,
//        19 duplicates, no unique-violation escaping.
//   I-2  promotion observed -> confirmed -> finalized; a late 'observed'
//        redelivery never walks the state backwards (out-of-order safety).
//   I-3  same event key in a different block_hash -> reorg_replaced, old
//        version preserved in onchain_event_revisions, rollup corrected.
//   I-4  onchain_mark_reorged excludes the event from the hourly rollup and
//        never deletes it; a redelivery in the same block reinstates it.
//   I-5  revisions are append-only (UPDATE/DELETE raise).
//   I-6  nonce claimed once (replay protection).
//   I-7  anon/authenticated cannot read the tables or execute the functions.
//   I-8  amounts are exact: a uint256-sized raw amount round-trips unchanged.
//   I-9  onchain_flag_ledger flags without touching amounts.
//
// Refuses unless the database name ends in `_test`.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = process.env.DATABASE_URL ?? "";
if (!/_test(\?|$)/.test(url)) {
  console.error("refusing: DATABASE_URL must point at a throwaway database whose name ends in _test");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 25 });
const q = (sql, params) => pool.query(sql, params);
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ok  ${name}`);
};

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
const ingest = async (events, client = pool) => (await client.query("select onchain_ingest($1::jsonb) as r", [JSON.stringify(events)])).rows[0].r;
const row = async (key) => (await q("select * from onchain_events where event_key = $1", [key])).rows[0];
const hour = async () => (await q("select coalesce(sum(n),0)::int n, coalesce(sum(volume_usd),0)::numeric v from onchain_hourly where bucket = '2026-10-06T10:00:00Z'")).rows[0];

try {
  await q(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create table if not exists users (id uuid primary key);`);
  await q(readFileSync(join(ROOT, "supabase", "migrations", "0032_onchain_ingestion.sql"), "utf8"));
  // Idempotent re-apply (migrations may be re-run).
  await q(readFileSync(join(ROOT, "supabase", "migrations", "0032_onchain_ingestion.sql"), "utf8"));
  ok("migration applies twice cleanly");

  // I-1
  const results = await Promise.all(Array.from({ length: 20 }, async () => {
    const c = await pool.connect();
    try {
      return await ingest([ev()], c);
    } finally {
      c.release();
    }
  }));
  const ins = results.reduce((a, r) => a + r.inserted, 0);
  const dup = results.reduce((a, r) => a + r.duplicates, 0);
  assert.equal(ins, 1);
  assert.equal(dup, 19);
  assert.equal((await q("select count(*)::int n from onchain_events")).rows[0].n, 1);
  assert.deepEqual(await hour(), { n: 1, v: "1250.00000000" });
  ok("I-1 20 concurrent deliveries -> 1 row, 19 duplicates");

  // I-2
  let r = await ingest([ev({ confirmation_state: "finalized" })]);
  assert.equal(r.promoted, 1);
  r = await ingest([ev({ confirmation_state: "observed" })]);
  assert.equal(r.duplicates, 1);
  assert.equal((await row("base:0xabc1111111111111111111111111111111111111111111111111111111111111:7")).confirmation_state, "finalized");
  ok("I-2 promotion only moves forward; late 'observed' is a no-op");

  // I-3
  r = await ingest([ev({ block_hash: "0xb100x", block_number: 101, amount_raw: "2000000000", amount: "2000", amount_usd: "2000", confirmation_state: "confirmed" })]);
  assert.equal(r.reorg_replaced, 1);
  const after = await row("base:0xabc1111111111111111111111111111111111111111111111111111111111111:7");
  assert.equal(after.block_hash, "0xb100x");
  assert.equal(after.revision, 3);
  const revs = (await q("select change, previous->>'block_hash' bh from onchain_event_revisions where event_key = 'base:0xabc1111111111111111111111111111111111111111111111111111111111111:7' order by id")).rows;
  assert.deepEqual(revs.map((x) => x.change), ["promoted", "reorg_replaced"]);
  assert.equal(revs[1].bh, "0xb100");
  assert.deepEqual(await hour(), { n: 1, v: "2000.00000000" });
  ok("I-3 reorg replacement keeps the old version and corrects the rollup");

  // I-4
  assert.equal((await q("select onchain_mark_reorged('base:0xabc1111111111111111111111111111111111111111111111111111111111111:7', 'not returned by provider') as m")).rows[0].m, true);
  assert.equal((await row("base:0xabc1111111111111111111111111111111111111111111111111111111111111:7")).confirmation_state, "reorged");
  assert.deepEqual(await hour(), { n: 0, v: "0" });
  assert.equal((await q("select count(*)::int n from onchain_events")).rows[0].n, 1);
  r = await ingest([ev({ block_hash: "0xb100x", block_number: 101, amount_raw: "2000000000", amount: "2000", amount_usd: "2000", confirmation_state: "confirmed" })]);
  assert.equal(r.reinstated, 1);
  assert.deepEqual(await hour(), { n: 1, v: "2000.00000000" });
  ok("I-4 reorged rows leave the rollup, are never deleted, can be reinstated");

  // I-5
  await assert.rejects(q("update onchain_event_revisions set reason = 'x'"), /append-only/);
  await assert.rejects(q("delete from onchain_event_revisions"), /append-only/);
  ok("I-5 revisions are append-only");

  // I-6
  const nonce = "6f1c2c1e-6a51-4d8b-9a56-3c1d7a0e9b10";
  assert.equal((await q("select onchain_claim_nonce($1) c", [nonce])).rows[0].c, true);
  assert.equal((await q("select onchain_claim_nonce($1) c", [nonce])).rows[0].c, false);
  ok("I-6 a nonce is claimed exactly once");

  // I-7
  for (const role of ["anon", "authenticated"]) {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}`);
      await assert.rejects(c.query("select * from onchain_events"), /permission denied/);
      await assert.rejects(c.query("select onchain_health()"), /permission denied/);
      await assert.rejects(c.query(`select onchain_ingest('[]'::jsonb)`), /permission denied/);
      await c.query("reset role");
    } finally {
      c.release();
    }
  }
  ok("I-7 anon/authenticated: no table access, no function execute");

  // I-8
  const big = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
  await ingest([ev({ event_key: "ethereum:0xdef2222222222222222222222222222222222222222222222222222222222222:1", chain: "ethereum", tx_hash: "0xdef2222222222222222222222222222222222222222222222222222222222222", log_index: 1, amount_raw: big, amount: "115792089237316195423570985008687907853269984665640564039457.584007913129639935", amount_usd: null })]);
  const b = await row("ethereum:0xdef2222222222222222222222222222222222222222222222222222222222222:1");
  assert.equal(b.amount_raw, big);
  assert.equal(b.amount, "115792089237316195423570985008687907853269984665640564039457.584007913129639935");
  ok("I-8 uint256 raw amount and 18-decimal amount round-trip exactly");

  // I-9
  assert.equal((await q("select onchain_flag_ledger('ethereum:0xdef2222222222222222222222222222222222222222222222222222222222222:1', 'tx_123', 'amount differs from ledger') f")).rows[0].f, true);
  const fl = await row("ethereum:0xdef2222222222222222222222222222222222222222222222222222222222222:1");
  assert.equal(fl.reconciliation_required, true);
  assert.equal(fl.amount_raw, big);
  assert.equal((await q("select onchain_flag_ledger('ethereum:0xdef2222222222222222222222222222222222222222222222222222222222222:1', 'tx_123', 'again') f")).rows[0].f, false);
  ok("I-9 ledger disagreement is flagged once, amounts untouched");

  const h = (await q("select onchain_health() h")).rows[0].h;
  assert.equal(h.events_total, 2);
  ok("onchain_health reports");

  // I-11 observability + AML flagging.
  const blockedKey = "base:0x" + "b".repeat(64) + ":3";
  const blocked = ev({ event_key: blockedKey, tx_hash: "0x" + "b".repeat(64), log_index: 3, risk_action: "block", risk_flags: ["ofac-sdn"] });
  let br = await ingest([blocked]);
  assert.deepEqual(br.blocked_keys, [blockedKey]);
  br = await ingest([blocked]); // redelivery
  assert.deepEqual(br.blocked_keys, []);
  assert.equal((await row(blockedKey)).risk_action, "block");
  const m = (await q("select sum(received)::int received, sum(inserted)::int inserted, sum(duplicates)::int duplicates from onchain_ingest_metrics where source = 'allium_beam'")).rows[0];
  assert.ok(m.received > 0 && m.inserted > 0 && m.duplicates > 0, JSON.stringify(m));
  const h2 = (await q("select onchain_health() h")).rows[0].h;
  assert.ok(h2.metrics_1h.allium_beam.received > 0);
  await q("select onchain_touch_source('allium_beam', true, null, '2026-10-06T10:15:00Z')");
  await q("select onchain_touch_source('allium_beam', false, 'boom', null)");
  await q("select onchain_touch_source('allium_beam', true, null, '2026-10-05T00:00:00Z')"); // older data must not move last_data_at back
  const src = (await q("select onchain_health() h")).rows[0].h.sources.allium_beam;
  assert.equal(src.last_error, "boom");
  assert.equal(new Date(src.last_data_at).toISOString(), "2026-10-06T10:15:00.000Z");
  for (const role of ["anon", "authenticated"]) {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}`);
      await assert.rejects(c.query("select * from onchain_ingest_metrics"), /permission denied/);
      await assert.rejects(c.query("select * from onchain_source_status"), /permission denied/);
      await assert.rejects(c.query("select onchain_touch_source('x', true)"), /permission denied/);
      await c.query("reset role");
    } finally {
      c.release();
    }
  }
  ok("I-11 metrics counted in-transaction; blocked counterparty reported once; source freshness monotonic; new tables service-role only");

  // I-10 throughput (local PG18, this machine — a measurement, not a production SLA).
  const mk = (i, hourOffset = 0) =>
    ev({
      event_key: `base:0x${i.toString(16).padStart(64, "0")}:0`,
      tx_hash: `0x${i.toString(16).padStart(64, "0")}`,
      log_index: 0,
      block_number: 1000 + i,
      block_hash: `0xb${i}`,
      block_timestamp: new Date(Date.UTC(2026, 9, 5, (i % 24) + hourOffset, i % 60)).toISOString(),
    });
  let next = 10_000;
  for (const [label, batch, callers] of [["1 caller x 10", 10, 1], ["1 caller x 100", 100, 1], ["1 caller x 500", 500, 1], ["20 callers x 50 (1000 events)", 50, 20]]) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: callers }, async () => {
      const c = await pool.connect();
      try {
        const events = Array.from({ length: batch }, () => mk(next++));
        await ingest(events, c);
      } finally {
        c.release();
      }
    }));
    const ms = performance.now() - t0;
    console.log(`       ${label}: ${ms.toFixed(0)} ms (${((batch * callers) / (ms / 1000)).toFixed(0)} events/s, rollup included)`);
  }
  // Redelivering all of them is all-duplicates and leaves the count unchanged.
  const before = (await q("select count(*)::int n from onchain_events")).rows[0].n;
  const dupRes = await ingest(Array.from({ length: 500 }, (_, i) => mk(10_000 + i)));
  assert.equal(dupRes.duplicates, 500);
  assert.equal((await q("select count(*)::int n from onchain_events")).rows[0].n, before);
  // Rollup == raw aggregate after everything above.
  const [raw] = (await q("select count(*)::int n, sum(amount_usd)::numeric v from onchain_events where confirmation_state <> 'reorged'")).rows;
  const [roll] = (await q("select sum(n)::int n, sum(volume_usd)::numeric v from onchain_hourly")).rows;
  assert.equal(roll.n, raw.n);
  assert.equal(Number(roll.v), Number(raw.v));
  ok("I-10 throughput measured; 500 redeliveries = 500 duplicates; rollup equals raw aggregate");

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("\nFAILED:", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
