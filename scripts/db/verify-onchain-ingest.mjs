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

  // I-2 (its own event, in another hour, so I-3/I-4 keep a non-final one)
  const k8 = "base:0xabc1111111111111111111111111111111111111111111111111111111111111:8";
  const e8 = (over) => ev({ event_key: k8, log_index: 8, block_timestamp: "2026-10-06T12:15:00Z", ...over });
  let r = await ingest([e8({ confirmation_state: "observed" })]);
  assert.equal(r.inserted, 1);
  r = await ingest([e8({ confirmation_state: "confirmed" })]);
  assert.equal(r.promoted, 1);
  r = await ingest([e8({ confirmation_state: "finalized" })]);
  assert.equal(r.promoted, 1);
  r = await ingest([e8({ confirmation_state: "observed" })]);
  assert.equal(r.duplicates, 1);
  assert.equal((await row(k8)).confirmation_state, "finalized");
  // Finality is final: a different block for a finalized event is a conflict
  // for an operator, never a silent replacement.
  r = await ingest([e8({ block_hash: "0xfork", confirmation_state: "confirmed" })]);
  assert.equal(r.conflicts, 1);
  assert.equal(r.reorg_replaced, 0);
  assert.equal((await row(k8)).block_hash, "0xb100");
  assert.equal((await row(k8)).reconciliation_required, true);
  ok("I-2 promotion only moves forward; late 'observed' is a no-op; a finalized event is never replaced by a fork");

  // I-3
  r = await ingest([ev({ block_hash: "0xb100x", block_number: 101, amount_raw: "2000000000", amount: "2000", amount_usd: "2000", confirmation_state: "confirmed" })]);
  assert.equal(r.reorg_replaced, 1);
  const after = await row("base:0xabc1111111111111111111111111111111111111111111111111111111111111:7");
  assert.equal(after.block_hash, "0xb100x");
  assert.equal(after.revision, 2);
  const revs = (await q("select change, previous->>'block_hash' bh from onchain_event_revisions where event_key = 'base:0xabc1111111111111111111111111111111111111111111111111111111111111:7' order by id")).rows;
  assert.deepEqual(revs.map((x) => x.change), ["reorg_replaced"]);
  assert.equal(revs[0].bh, "0xb100");
  assert.deepEqual(await hour(), { n: 1, v: "2000.00000000" });
  ok("I-3 reorg replacement keeps the old version and corrects the rollup");

  // I-4
  assert.equal((await q("select onchain_mark_reorged('base:0xabc1111111111111111111111111111111111111111111111111111111111111:7', 'not returned by provider') as m")).rows[0].m, true);
  assert.equal((await row("base:0xabc1111111111111111111111111111111111111111111111111111111111111:7")).confirmation_state, "reorged");
  assert.deepEqual(await hour(), { n: 0, v: "0" });
  assert.equal((await q("select count(*)::int n from onchain_events where event_key like 'base:0xabc1%:7'")).rows[0].n, 1);
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
  assert.equal(h.events_total, 3);
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

  // I-12 two sources for one event (the node and Allium share event_key).
  {
    const tx = "0x" + "c".repeat(64);
    const key = `ethereum:${tx}:5`;
    const base = { event_key: key, chain: "ethereum", tx_hash: tx, log_index: 5, block_number: 500, block_hash: "0xcanon", amount_raw: "1000000", amount: "1", amount_usd: null };
    // Node: observed at the tip, then finalized in the same block -> promoted.
    let r12 = await ingest([ev({ ...base, source: "node_rpc", confirmation_state: "observed" })]);
    assert.equal(r12.inserted, 1);
    r12 = await ingest([ev({ ...base, source: "node_rpc", confirmation_state: "finalized" })]);
    assert.equal(r12.promoted, 1);
    // Allium redelivers the same event in the same block: a plain duplicate.
    r12 = await ingest([ev({ ...base, source: "allium_beam", confirmation_state: "confirmed" })]);
    assert.equal(r12.duplicates, 1);
    // A lagging source serves an orphaned fork for the FINALIZED event:
    // flagged once, never overwritten.
    r12 = await ingest([ev({ ...base, source: "allium_realtime_api", block_hash: "0xfork", confirmation_state: "observed" })]);
    assert.equal(r12.conflicts, 1);
    assert.equal(r12.reorg_replaced, 0);
    let cur = await row(key);
    assert.equal(cur.block_hash, "0xcanon");
    assert.equal(cur.confirmation_state, "finalized");
    assert.equal(cur.reconciliation_required, true);
    assert.match(cur.reconciliation_note, /finalized event/);
    const revs = async () => (await q("select count(*)::int n from onchain_event_revisions where event_key = $1 and change = 'source_conflict'", [key])).rows[0].n;
    assert.equal(await revs(), 1);
    r12 = await ingest([ev({ ...base, source: "allium_realtime_api", block_hash: "0xfork", confirmation_state: "observed" })]);
    assert.equal(r12.conflicts, 1);
    assert.equal(await revs(), 1, "a repeated conflict is counted, not re-flagged");

    // Same block, different exact amount -> conflict, amount untouched.
    const tx2 = "0x" + "d".repeat(64);
    const key2 = `ethereum:${tx2}:1`;
    const b2 = { event_key: key2, chain: "ethereum", tx_hash: tx2, log_index: 1, block_number: 501, block_hash: "0xb501", amount_usd: null };
    await ingest([ev({ ...b2, source: "node_rpc", amount_raw: "250000", amount: "0.25", confirmation_state: "finalized" })]);
    r12 = await ingest([ev({ ...b2, source: "allium_beam", amount_raw: "250001", amount: "0.250001", confirmation_state: "confirmed" })]);
    assert.equal(r12.conflicts, 1);
    assert.equal((await row(key2)).amount_raw, "250000");

    // Proven orphan (p_final): the orphaned block can never reinstate it...
    const tx3 = "0x" + "e".repeat(64);
    const key3 = `ethereum:${tx3}:2`;
    const b3 = { event_key: key3, chain: "ethereum", tx_hash: tx3, log_index: 2, block_number: 502, block_hash: "0xorphan", amount_usd: null };
    await ingest([ev({ ...b3, source: "allium_beam", confirmation_state: "confirmed" })]);
    assert.equal((await q("select onchain_mark_reorged($1, 'absent at finalized height', true) m", [key3])).rows[0].m, true);
    cur = await row(key3);
    assert.equal(cur.confirmation_state, "reorged");
    assert.equal(cur.reorg_final, true);
    r12 = await ingest([ev({ ...b3, source: "allium_beam", confirmation_state: "confirmed" })]);
    assert.equal(r12.conflicts, 1);
    assert.equal(r12.reinstated, 0);
    assert.equal((await row(key3)).confirmation_state, "reorged");
    r12 = await ingest([ev({ ...b3, block_hash: null, source: "allium_realtime_api", confirmation_state: "observed" })]);
    assert.equal(r12.conflicts, 1, "no block hash cannot be told apart from the orphan");
    // ...but a re-inclusion in a DIFFERENT canonical block is accepted.
    const tx4 = "0x" + "f".repeat(64);
    const key4 = `ethereum:${tx4}:0`;
    const b4 = { event_key: key4, chain: "ethereum", tx_hash: tx4, log_index: 0, block_number: 503, block_hash: "0xold", amount_usd: null };
    await ingest([ev({ ...b4, source: "node_rpc", confirmation_state: "observed" })]);
    await q("select onchain_mark_reorged($1, 'proof', true)", [key4]);
    r12 = await ingest([ev({ ...b4, block_number: 505, block_hash: "0xnew", source: "node_rpc", confirmation_state: "finalized" })]);
    assert.equal(r12.reorg_replaced, 1);
    cur = await row(key4);
    assert.equal(cur.block_hash, "0xnew");
    assert.equal(cur.confirmation_state, "finalized");
    assert.equal(cur.reorg_final, false);
    // A provider judgement upgrades to a proof, never the reverse.
    const tx5 = "0x" + "9".repeat(64);
    const key5 = `ethereum:${tx5}:0`;
    await ingest([ev({ event_key: key5, chain: "ethereum", tx_hash: tx5, log_index: 0, block_hash: "0xb9", amount_usd: null, source: "allium_beam" })]);
    await q("select onchain_mark_reorged($1, 'provider', false)", [key5]);
    assert.equal((await row(key5)).reorg_final, false);
    assert.equal((await q("select onchain_mark_reorged($1, 'proof', true) m", [key5])).rows[0].m, true);
    assert.equal((await q("select onchain_mark_reorged($1, 'provider again', false) m", [key5])).rows[0].m, false);
    assert.equal((await row(key5)).reorg_final, true);
    const mc = (await q("select coalesce(sum(conflicts),0)::int c from onchain_ingest_metrics")).rows[0].c;
    assert.equal(mc, 6);
    assert.equal((await q("select onchain_health() h")).rows[0].h.metrics_1h.allium_realtime_api.conflicts, 3);
  }
  ok("I-12 multi-source: finalized never overwritten by a fork, amount disagreement flagged once, proven orphan not reinstated, re-inclusion accepted, conflicts metered");

  // I-13 node cursor: compare-and-set, monotonic, pinned to a chain id.
  {
    const adv = async (expected, next, chainId = 1, c = pool) => (await c.query("select onchain_node_cursor_advance('ethereum', $1, $2, $3, '0xh') a", [chainId, expected, next])).rows[0].a;
    assert.equal(await adv(null, 100), true);
    assert.equal(await adv(null, 100), false, "second first-anchor refused");
    // 20 concurrent scanners read cursor 100; exactly one advances it.
    const wins = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const c = await pool.connect();
      try {
        return await adv(100, 200 + i, 1, c);
      } finally {
        c.release();
      }
    }));
    assert.equal(wins.filter(Boolean).length, 1);
    const last = Number((await q("select last_block from onchain_node_cursors where chain = 'ethereum'")).rows[0].last_block);
    assert.ok(last >= 200 && last < 220);
    assert.equal(await adv(last, last - 1), false, "never backwards");
    await assert.rejects(adv(last, last + 10, 8453), /pinned to chain id 1/);
    assert.equal((await q("select onchain_health() h")).rows[0].h.node_cursors.ethereum.last_block, last);
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query(`set role ${role}`);
        await assert.rejects(c.query("select * from onchain_node_cursors"), /permission denied/);
        await assert.rejects(c.query("select onchain_node_cursor_advance('x', 1, null, 1, 'h')"), /permission denied/);
        await c.query("reset role");
      } finally {
        c.release();
      }
    }
  }
  ok("I-13 node cursor: one winner of 20 concurrent advances, never backwards, chain id pinned, service-role only");

  // I-14 Solana cursor: no chain id, pinned by genesis hash instead.
  {
    const G = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const adv = (expected, next, genesis = G, chainId = null) =>
      pool.query("select onchain_node_cursor_advance(p_chain => 'solana', p_chain_id => $1, p_expected => $2, p_next => $3, p_hash => 'bh', p_genesis => $4) a", [chainId, expected, next, genesis]).then((r) => r.rows[0].a);
    await assert.rejects(adv(null, 1, null), /chain id or a genesis hash/);
    assert.equal(await adv(null, 454142535), true);
    assert.equal(await adv(454142535, 454142600), true);
    await assert.rejects(adv(454142600, 454142700, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"), /pinned to genesis/);
    await assert.rejects(adv(454142600, 454142700, G, 1), /pinned to chain id/);
    assert.equal(await adv(454142600, 454142599), false, "never backwards");
    await assert.rejects(q("insert into onchain_node_cursors (chain, last_block, last_block_hash) values ('nopin', 1, 'h')"), /check constraint/);
  }
  ok("I-14 solana cursor: pinned by genesis hash, requires a pin, monotonic");

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
