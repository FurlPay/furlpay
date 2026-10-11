#!/usr/bin/env node
// Migration 0035 (CCTP V2 transfers) against a REAL PostgreSQL.
//
//   DATABASE_URL=postgres://.../<name>_test node scripts/db/verify-cctp.mjs
//
// Applies the REAL 0032 + 0034 + 0035 (twice) and proves the state machine on
// the real Base->Polygon transfer verified 2026-10-07 (1,499.85 USDC, nonce
// 0xa8a6…93b9) plus constructed edge cases:
//   C-1  a finalized burn creates one transfer (burn_confirmed, source_verified)
//   C-2  the same event delivered again (another range / provider) is a duplicate
//   C-3  no matching attestation -> pending with exponential backoff
//   C-4  exact attestation -> nonce, message_verified, attestation_complete
//   C-5  usedNonces=0 keeps it awaiting; =1 at finalized -> finalized (used_nonce)
//   C-6  a later indexed mint attaches the exact tx/amount/fee (minted+fee=burned)
//   C-7  mint indexed BEFORE the burn's attestation: inbound row merged, not lost
//   C-8  amount that does not reconcile -> mismatch + integrity issue
//   C-9  a nonce already owned by another burn -> mismatch, never merged
//   C-10 events and evidence are append-only
//   C-11 anon/authenticated: no access
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
const pool = new pg.Pool({ connectionString: url, max: 6 });
const q = (sql, params) => pool.query(sql, params);
let passed = 0;
const ok = (n) => {
  passed++;
  console.log(`  ok  ${n}`);
};
const mig = (f) => readFileSync(join(ROOT, "supabase", "migrations", f), "utf8");

const NONCE = "0xa8a6654206bcdda603d3d3259f40afe22a9d9628c4180654378ae09ff68393b9";
const REAL = { amount: "1499850000", mint_recipient: "0xe936b2c854cc37bb62f9c6a225d07612028f3694", destination_domain: 7, destination_chain: "polygon", max_fee: "194981", burn_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", depositor: "0x7e07a9148e9149e430c6412b79a675028595ff1f", min_finality_threshold: 1000 };
const hash = (n) => "0x" + n.toString(16).padStart(64, "0");
let block = 1000;
const burnEv = (tx, idx, d = REAL) => ({ event_id: `base:${hash(block)}:${tx}:${idx}`, kind: "deposit_for_burn", block_number: block, block_hash: hash(block), block_time: "2026-10-07T10:00:00Z", tx_hash: tx, log_index: idx, decoded: d });
const mintEv = (chain, tx, idx, d) => ({ event_id: `${chain}:${hash(block)}:${tx}:${idx}`, kind: "mint_received", block_number: block, block_hash: hash(block), block_time: "2026-10-07T10:01:00Z", tx_hash: tx, log_index: idx, decoded: d });
async function commit(chain, chainId, domain, events) {
  const cur = (await q("select last_block::bigint b, last_block_hash h from onchain_asset_cursors where chain = $1 and asset = 'cctp-v2'", [chain])).rows[0];
  const from = Number(cur.b) + 1;
  const to = from + 9;
  block = from + 5;
  const evs = typeof events === "function" ? events() : events;
  const r = (await q("select cctp_commit_range($1, $2, $3, $4, $5, $6, $7, $8, now(), $9::jsonb) r", [chain, chainId, domain, cur.b, from, to, cur.h, hash(to), JSON.stringify(evs)])).rows[0].r;
  return r;
}
const transfer = async (where, params) => (await q(`select * from cctp_transfers where ${where}`, params)).rows;
const attest = (id, matched, status, nonce, fee = "194980") => q("select cctp_apply_attestation($1, $2, $3, $4, $5, 1000, null) r", [id, matched, status, nonce, fee]).then((r) => r.rows[0].r);

try {
  await q(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$; create table if not exists users (id uuid primary key);`);
  for (let i = 0; i < 2; i++) for (const f of ["0032_onchain_ingestion.sql", "0034_onchain_asset_index.sql", "0035_cctp_v2.sql"]) await q(mig(f));
  ok("0032 + 0034 + 0035 apply twice cleanly");
  for (const [c, id] of [["base", 8453], ["polygon", 137]]) await q("select onchain_asset_anchor($1, 'cctp-v2', '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d', $2, 999, $3, now(), null, 6::smallint, 'test')", [c, id, hash(999)]);

  // C-1
  const TX = "0x1fdb08e829a05ddda23c01a5731c1b6d473befce64415bfa7ccc36d417b4601e";
  let ev;
  let r = await commit("base", 8453, 6, () => [(ev = burnEv(TX, 1162))]);
  assert.equal(r.burns, 1);
  let [t] = await transfer("source_tx_hash = $1", [TX]);
  assert.equal(t.status, "burn_confirmed");
  assert.equal(t.source_verified, true);
  assert.equal(t.amount_raw, "1499850000");
  assert.equal(t.destination_chain, "polygon");
  ok("C-1 finalized burn -> one transfer (burn_confirmed, source verified)");

  // C-2
  r = await commit("base", 8453, 6, [ev]);
  assert.equal(r.duplicates, 1);
  assert.equal((await transfer("source_tx_hash = $1", [TX])).length, 1);
  ok("C-2 the same event delivered again is a duplicate, not a second transfer");

  // C-3
  assert.equal(await attest(t.id, false, null, null), "pending");
  [t] = await transfer("id = $1", [t.id]);
  assert.equal(t.attestation_attempts, 1);
  assert.ok(new Date(t.attestation_next_at) > new Date());
  assert.equal(t.status, "burn_confirmed");
  ok("C-3 no matching attestation -> pending with backoff, not advanced");

  // C-4
  assert.equal(await attest(t.id, true, "complete", NONCE), "complete");
  [t] = await transfer("id = $1", [t.id]);
  assert.deepEqual([t.status, t.nonce, t.message_verified, t.executed_fee_raw], ["attestation_complete", NONCE, true, "194980"]);
  assert.equal(t.destination_verified, false); // Iris alone never verifies the destination
  ok("C-4 exact attestation -> nonce + attestation_complete; destination NOT assumed");

  // C-5
  assert.equal((await q("select cctp_apply_used_nonce($1, false, 'polygon') r", [t.id])).rows[0].r, "pending");
  assert.equal((await q("select cctp_apply_used_nonce($1, true, 'polygon') r", [t.id])).rows[0].r, "finalized");
  [t] = await transfer("id = $1", [t.id]);
  assert.deepEqual([t.status, t.destination_method, t.destination_verified, t.finality_verified], ["finalized", "used_nonce", true, true]);
  ok("C-5 usedNonces at finalized -> finalized (method used_nonce)");

  // C-6: later the destination chain is indexed: the mint attaches exactly
  r = await commit("polygon", 137, 7, () => [mintEv("polygon", "0x" + "ab".repeat(32), 50, { nonce: NONCE, source_domain: 6, finality_threshold_executed: 1000, minted: "1499655020", fee: "194980", mint_recipient: REAL.mint_recipient, mint_token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" })]);
  assert.equal(r.matched, 1);
  [t] = await transfer("id = $1", [t.id]);
  assert.deepEqual([t.status, t.destination_method, t.minted_raw, t.mint_fee_raw, t.destination_tx_hash], ["finalized", "mint_event", "1499655020", "194980", "0x" + "ab".repeat(32)]);
  ok("C-6 indexed mint attaches tx/amount/fee; minted + fee = burned");

  // C-7: mint observed first, burn attested later -> merged
  const N2 = "0x" + "12".repeat(32);
  const D2 = { ...REAL, amount: "5000000", max_fee: "10" };
  r = await commit("polygon", 137, 7, () => [mintEv("polygon", "0x" + "cd".repeat(32), 7, { nonce: N2, source_domain: 6, finality_threshold_executed: 2000, minted: "4999990", fee: "10", mint_recipient: REAL.mint_recipient, mint_token: "0x3c49" })]);
  const [inbound] = await transfer("nonce = $1", [N2]);
  assert.equal(inbound.source_verified, false);
  r = await commit("base", 8453, 6, () => [burnEv("0x" + "ef".repeat(32), 3, D2)]);
  const [b2] = await transfer("source_tx_hash = $1", ["0x" + "ef".repeat(32)]);
  assert.equal(await attest(b2.id, true, "complete", N2, "10"), "complete");
  const [merged] = await transfer("id = $1", [inbound.id]);
  const [survivor] = await transfer("id = $1", [b2.id]);
  assert.deepEqual([merged.status, merged.merged_into], ["merged", String(b2.id)]);
  assert.deepEqual([survivor.status, survivor.destination_tx_hash, survivor.source_verified, survivor.destination_verified], ["finalized", "0x" + "cd".repeat(32), true, true]);
  ok("C-7 destination indexed first: inbound row merged into the burn, both legs verified");

  // C-8: amount does not reconcile
  const N3 = "0x" + "34".repeat(32);
  await commit("base", 8453, 6, () => [burnEv("0x" + "a1".repeat(32), 1, { ...REAL, amount: "1000000", max_fee: "5" })]);
  const [b3] = await transfer("source_tx_hash = $1", ["0x" + "a1".repeat(32)]);
  await attest(b3.id, true, "complete", N3, "5");
  r = await commit("polygon", 137, 7, () => [mintEv("polygon", "0x" + "a2".repeat(32), 1, { nonce: N3, source_domain: 6, finality_threshold_executed: 2000, minted: "999000", fee: "5", mint_recipient: REAL.mint_recipient, mint_token: "0x3c49" })]);
  const [m3] = await transfer("id = $1", [b3.id]);
  assert.equal(m3.status, "mismatch");
  assert.match(m3.status_reason, /burned 1000000 but minted 999000 \+ fee 5/);
  assert.ok((await q("select count(*)::int n from onchain_integrity_issues where asset = 'cctp-v2'")).rows[0].n >= 1);
  ok("C-8 non-reconciling amounts -> mismatch + integrity issue (not completed)");

  // C-9: nonce already owned by another burn
  await commit("base", 8453, 6, () => [burnEv("0x" + "b1".repeat(32), 1, { ...REAL, amount: "777" })]);
  const [b4] = await transfer("source_tx_hash = $1", ["0x" + "b1".repeat(32)]);
  assert.equal(await attest(b4.id, true, "complete", NONCE), "duplicate_nonce");
  assert.equal((await transfer("id = $1", [b4.id]))[0].status, "mismatch");
  ok("C-9 duplicate nonce across burns -> mismatch, never merged");

  // C-10
  await assert.rejects(q("update cctp_events set kind = 'mint_received'"), /append-only/);
  await assert.rejects(q("delete from cctp_transfer_evidence"), /append-only/);
  assert.ok((await q("select count(*)::int n from cctp_transfer_evidence")).rows[0].n >= 8);
  ok("C-10 events and evidence are append-only");

  // C-11
  for (const role of ["anon", "authenticated"]) {
    const c = await pool.connect();
    try {
      await c.query(`set role ${role}`);
      await assert.rejects(c.query("select * from cctp_transfers"), /permission denied/);
      await assert.rejects(c.query("select cctp_apply_used_nonce(1, true, 'x')"), /permission denied/);
      await c.query("reset role");
    } finally {
      c.release();
    }
  }
  ok("C-11 anon/authenticated: no table access, no function execute");

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("FAILED:", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
