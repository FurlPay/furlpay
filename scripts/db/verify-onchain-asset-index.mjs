#!/usr/bin/env node
// Migration 0034 (network-wide asset index) against a REAL PostgreSQL.
//
//   DATABASE_URL=postgres://.../<name>_test node scripts/db/verify-onchain-asset-index.mjs
//
// Applies the REAL 0032 + 0034 files (twice: idempotence) and proves:
//
//   A-1  anchor is set once; a second anchor is refused.
//   A-2  a commit writes minutes, the range, a supply snapshot and moves the
//        cursor atomically; supply reconciles exactly (prev + mint - burn).
//   A-3  20 workers committing the same range concurrently -> exactly one
//        wins; aggregates are not double-counted.
//   A-4  a range that does not continue the cursor is refused (block_gap).
//   A-5  a changed parent hash is refused (reorg_inconsistency).
//   A-6  a supply that does not reconcile is committed but flagged
//        (reconciled = false, supply_mismatch issue).
//   A-7  negative supply and impossible totals are refused and flagged.
//   A-8  stale cursor is benign; a cursor AHEAD of the store is a regression.
//   A-9  an issue repeated is one open row with occurrences counted.
//   A-10 hour/day series equal the sum of the minute rows; supply series is the
//        last snapshot per bucket.
//   A-11 commits and supply snapshots are append-only.
//   A-12 the gap audit over committed ranges is empty.
//   A-13 anon/authenticated: no table access, no function execute.
//   A-14 indexer status never moves its indexed block backwards.
//   A-15 tracked addresses: EVM must be lowercase hex; Solana base58 accepted.
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
const mig = (f) => readFileSync(join(ROOT, "supabase", "migrations", f), "utf8");

const C = "base";
const A = "usdc";
const anchor = (block = 1000, supply = "1000000000", chain = C) =>
  q("select onchain_asset_anchor($1, $2, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 8453, $3, $4, $5, $6, 6::smallint, 'test') a", [chain, A, block, `0xh${block}`, "2026-10-07T10:00:00Z", supply]).then((r) => r.rows[0].a);
const commit = (o, client = pool) =>
  client
    .query(
      `select onchain_asset_commit($1, $2, 8453, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, 6::smallint, 'test', 12) r`,
      [
        o.chain ?? C,
        A,
        o.expected,
        o.from,
        o.to,
        o.parent ?? `0xh${o.from - 1}`,
        `0xh${o.to}`,
        o.time ?? "2026-10-07T10:05:00Z",
        JSON.stringify(o.totals ?? { transfers: 3, transfer_raw: "3000000", mints: 1, mint_raw: "500000", burns: 1, burn_raw: "200000" }),
        JSON.stringify(
          o.buckets ?? [
            { bucket: "2026-10-07T10:01:00Z", transfers: 2, transfer_raw: "2000000", mints: 1, mint_raw: "500000", burns: 0, burn_raw: "0", first_block: o.from, last_block: o.from },
            { bucket: "2026-10-07T10:02:00Z", transfers: 1, transfer_raw: "1000000", mints: 0, mint_raw: "0", burns: 1, burn_raw: "200000", first_block: o.to, last_block: o.to },
          ]
        ),
        o.supply === undefined ? "1000300000" : o.supply,
      ]
    )
    .then((r) => r.rows[0].r);
const issues = async (kind) => (await q("select * from onchain_integrity_issues where kind = $1 and resolved_at is null", [kind])).rows;
const cursor = async (chain = C) => (await q("select * from onchain_asset_cursors where chain = $1 and asset = $2", [chain, A])).rows[0];

try {
  await q(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create table if not exists users (id uuid primary key);`);
  for (let i = 0; i < 2; i++) {
    await q(mig("0032_onchain_ingestion.sql"));
    await q(mig("0034_onchain_asset_index.sql"));
  }
  ok("0032 + 0034 apply twice cleanly");

  // A-1
  assert.equal(await anchor(), true);
  assert.equal(await anchor(), false);
  assert.equal((await cursor()).last_block, "1000");
  ok("A-1 anchor once");

  // A-2
  let r = await commit({ expected: 1000, from: 1001, to: 1010 });
  assert.deepEqual(r, { ok: true, reconciled: true });
  const cur = await cursor();
  assert.equal(cur.last_block, "1010");
  assert.equal(cur.last_supply_raw, "1000300000");
  assert.equal((await q("select count(*)::int n, sum(transfer_raw)::text v from onchain_asset_minutes where chain = $1", [C])).rows[0].v, "3000000");
  assert.equal((await q("select supply_raw::text s from onchain_supply_snapshots where chain = $1 and block = 1010", [C])).rows[0].s, "1000300000");
  ok("A-2 atomic commit; exact supply reconciliation (prev + mint - burn)");

  // A-3
  const results = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const c = await pool.connect();
      try {
        return await commit({ expected: 1010, from: 1011, to: 1020, supply: "1000600000" }, c);
      } finally {
        c.release();
      }
    })
  );
  assert.equal(results.filter((x) => x.ok).length, 1);
  assert.ok(results.filter((x) => !x.ok).every((x) => x.reason === "stale_cursor"));
  assert.equal((await q("select sum(transfer_raw)::text v from onchain_asset_minutes where chain = $1", [C])).rows[0].v, "6000000");
  assert.equal((await q("select count(*)::int n from onchain_asset_commits where chain = $1", [C])).rows[0].n, 2);
  ok("A-3 20 concurrent commits of one range -> one wins, nothing double-counted");

  // A-4
  r = await commit({ expected: 1020, from: 1025, to: 1030 });
  assert.equal(r.reason, "block_gap");
  assert.equal((await issues("block_gap")).length, 1);
  ok("A-4 non-contiguous range refused (block_gap)");

  // A-5
  r = await commit({ expected: 1020, from: 1021, to: 1030, parent: "0xforked" });
  assert.equal(r.reason, "parent_hash_mismatch");
  assert.equal((await issues("reorg_inconsistency")).length, 1);
  assert.equal((await cursor()).last_block, "1020");
  ok("A-5 changed finalized parent refused (reorg_inconsistency)");

  // A-6
  r = await commit({ expected: 1020, from: 1021, to: 1030, supply: "999" });
  assert.deepEqual(r, { ok: true, reconciled: false });
  const mm = await issues("supply_mismatch");
  assert.equal(mm.length, 1);
  assert.match(mm[0].detail, /minted 500000 - burned 200000/);
  ok("A-6 non-reconciling supply committed but flagged");

  // A-7
  r = await commit({ expected: 1030, from: 1031, to: 1040, supply: "-1" });
  assert.equal(r.reason, "negative_supply");
  r = await commit({ expected: 1030, from: 1031, to: 1040, totals: { transfers: 1, transfer_raw: "1", mints: 0, mint_raw: "5", burns: 0, burn_raw: "0" } });
  assert.equal(r.reason, "impossible_value");
  r = await commit({ expected: 1030, from: 1031, to: 1040, totals: { transfers: -1, transfer_raw: "1", mints: 0, mint_raw: "0", burns: 0, burn_raw: "0" } });
  assert.equal(r.reason, "impossible_value");
  assert.equal((await issues("negative_supply")).length, 1);
  assert.equal((await cursor()).last_block, "1030");
  ok("A-7 negative supply and impossible totals refused");

  // A-8
  r = await commit({ expected: 1020, from: 1021, to: 1030 });
  assert.equal(r.reason, "stale_cursor");
  assert.equal((await issues("checkpoint_regression")).length, 0);
  r = await commit({ expected: 5000, from: 5001, to: 5010 });
  assert.equal(r.reason, "stale_cursor");
  assert.equal((await issues("checkpoint_regression")).length, 1);
  ok("A-8 stale cursor benign; cursor ahead of the store flagged as regression");

  // A-9
  await commit({ expected: 1030, from: 1099, to: 1100 });
  await commit({ expected: 1030, from: 1099, to: 1100 });
  const gaps = await issues("block_gap");
  const g = gaps.find((x) => x.block === "1099");
  assert.equal(g.occurrences, 2);
  ok("A-9 repeated issue deduplicated with occurrences");

  // A-10
  const mins = (await q("select sum(transfers)::int t, sum(transfer_raw)::text v, sum(mint_raw)::text m from onchain_asset_minutes where chain = $1", [C])).rows[0];
  for (const b of ["hour", "day", "minute"]) {
    const s = (await q("select sum(transfers)::int t, sum(transfer_raw)::text v, sum(mint_raw)::text m from onchain_asset_series('usdc', '2026-10-01', '2026-10-31', $1)", [b])).rows[0];
    assert.deepEqual(s, mins, b);
  }
  const hours = (await q("select count(*)::int n from onchain_asset_series('usdc', '2026-10-01', '2026-10-31', 'hour')")).rows[0].n;
  assert.equal(hours, 1);
  const sup = (await q("select block::int b, supply_raw::text s from onchain_supply_series('usdc', '2026-10-01', '2026-10-31', 'day')")).rows;
  assert.deepEqual(sup, [{ b: 1030, s: "999" }]);
  ok("A-10 hour/day series equal minute sums; supply series = last snapshot per bucket");

  // A-11
  await assert.rejects(q("update onchain_asset_commits set transfers = 0"), /append-only/);
  await assert.rejects(q("delete from onchain_supply_snapshots"), /append-only/);
  ok("A-11 commits and supply snapshots are append-only");

  // A-12
  assert.equal((await q("select count(*)::int n from onchain_asset_gaps('usdc')")).rows[0].n, 0);
  ok("A-12 gap audit over committed ranges is empty");

  // A-13
  for (const role of ["anon", "authenticated"]) {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}`);
      for (const t of ["onchain_asset_minutes", "onchain_asset_cursors", "onchain_integrity_issues", "onchain_tracked_addresses", "onchain_indexer_status"]) {
        await assert.rejects(c.query(`select * from ${t}`), /permission denied/);
      }
      await assert.rejects(c.query("select * from onchain_asset_series('usdc', now(), now(), 'hour')"), /permission denied/);
      await c.query("reset role");
    } finally {
      c.release();
    }
  }
  ok("A-13 anon/authenticated: no table access, no function execute");

  // A-14
  const touch = (indexed, ok_ = true) =>
    q("select onchain_indexer_touch('asset', 'base', 'usdc', $1, 10, now(), 9, $2, now(), $3, 5, '{}'::jsonb)", [ok_, indexed, ok_ ? null : "boom"]);
  await touch(100);
  await touch(90);
  await touch(null, false);
  const st = (await q("select * from onchain_indexer_status where chain = 'base'")).rows[0];
  assert.equal(st.indexed_block, "100");
  assert.equal(st.last_error, "boom");
  assert.ok(st.last_ok_at && st.last_error_at);
  ok("A-14 indexer status: indexed block never moves backwards; errors recorded");

  // A-15
  const w = (await q("insert into onchain_tracked_wallets (label, scope) values ('treasury', 'treasury') returning id")).rows[0].id;
  await q("insert into onchain_tracked_addresses (wallet_id, chain, address) values ($1, 'base', $2), ($1, 'solana', $3)", [w, "0x" + "ab".repeat(20), "3bickQtS7Xw6eYnXEEkZrVwcWsbJKhTdCLLmLv6pDWaq"]);
  await assert.rejects(q("insert into onchain_tracked_addresses (wallet_id, chain, address) values ($1, 'ethereum', $2)", [w, "0x" + "AB".repeat(20)]), /check constraint/);
  await assert.rejects(q("insert into onchain_tracked_addresses (wallet_id, chain, address) values ($1, 'base', $2)", [w, "0x" + "ab".repeat(20)]), /duplicate key/);
  ok("A-15 tracked addresses: one wallet, many chains; EVM lowercase only; unique per chain");

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("FAILED:", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
