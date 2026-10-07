#!/usr/bin/env node
// Measures the REAL PostgreSQL footprint of canonical USDC Transfer rows:
// loads real finalized mainnet events into a throwaway embedded PostgreSQL
// under two candidate schemas and reports table, index, TOAST and WAL bytes
// per event (pg_relation_size / pg_indexes_size / pg_total_relation_size /
// pg_current_wal_lsn). The numbers feed the sizing in the census report.
//
//   npm run usdc:storage -- [--blocks 1000] [--rpc https://a,https://b]
//
//   spec    — the requested canonical table, text hex columns, every
//             requested index (unique key, sender, recipient, block, time,
//             amount, tx hash, chain+token+block).
//   compact — bytea addresses/hashes, a smallint stream id instead of
//             (chain_id, token_address), block hash/time in a per-block
//             table, and the indexes the read paths need.

import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const BLOCKS = Number(arg("--blocks", "1000"));
const RPCS = String(arg("--rpc", "https://rpc.mevblocker.io,https://mainnet.gateway.tenderly.co")).split(",");
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hex = (n) => `0x${n.toString(16)}`;
let k = 0;
async function rpc(method, params) {
  for (let i = 0; i < 12; i++) {
    const u = RPCS[k++ % RPCS.length];
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const b = await r.json();
      if (b.error) throw new Error(b.error.message);
      return b.result;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** Math.min(i, 5)));
    }
  }
  throw new Error(`${method} failed on every provider`);
}

const fin = await rpc("eth_getBlockByNumber", ["finalized", false]);
const to = Number(BigInt(fin.number));
const from = to - BLOCKS + 1;
const logs = [];
for (let a = from; a <= to; a += 100) logs.push(...(await rpc("eth_getLogs", [{ address: USDC, topics: [TOPIC], fromBlock: hex(a), toBlock: hex(Math.min(to, a + 99)) }])));
const times = new Map();
const need = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))];
for (const n of need) times.set(n, (await rpc("eth_getBlockByNumber", [n, false])).timestamp);
const rows = logs.map((l) => ({
  block: Number(BigInt(l.blockNumber)),
  blockHash: l.blockHash.toLowerCase(),
  time: new Date(Number(BigInt(l.blockTimestamp ?? times.get(l.blockNumber))) * 1000).toISOString(),
  tx: l.transactionHash.toLowerCase(),
  txIndex: Number(BigInt(l.transactionIndex)),
  logIndex: Number(BigInt(l.logIndex)),
  from: `0x${l.topics[1].slice(26)}`,
  to: `0x${l.topics[2].slice(26)}`,
  raw: BigInt(l.data === "0x" ? 0 : l.data).toString(),
}));
console.error(`loaded ${rows.length} real events from finalized blocks ${from}..${to}`);

const dir = mkdtempSync(join(tmpdir(), "usdc-pg-"));
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 15444, persistent: false });
await pg.initialise();
await pg.start();
const c = pg.getPgClient();
await c.connect();
const q = (s, p) => c.query(s, p);

await q(`create table spec_usdc_transfers (
  id bigserial primary key, chain_id bigint not null, token_address text not null, block_number bigint not null,
  block_hash text not null, transaction_hash text not null, transaction_index integer not null, log_index integer not null,
  sender text not null, recipient text not null, amount_raw numeric(78,0) not null, amount_usdc numeric(78,6) not null,
  block_timestamp timestamptz not null, removed boolean not null default false, finalized boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (chain_id, token_address, transaction_hash, log_index))`);
for (const i of [
  "create index on spec_usdc_transfers (sender, block_number)",
  "create index on spec_usdc_transfers (recipient, block_number)",
  "create index on spec_usdc_transfers (block_number)",
  "create index on spec_usdc_transfers (block_timestamp)",
  "create index on spec_usdc_transfers (amount_usdc desc)",
  "create index on spec_usdc_transfers (transaction_hash)",
  "create index on spec_usdc_transfers (chain_id, token_address, block_number)",
])
  await q(i);

await q(`create table compact_blocks (stream smallint not null, block_number bigint not null, block_hash bytea not null, block_time timestamptz not null, primary key (stream, block_number))`);
await q(`create table compact_transfers (stream smallint not null, block_number bigint not null, tx_hash bytea not null, tx_index integer not null,
  log_index integer not null, sender bytea not null, recipient bytea not null, amount_raw numeric(78,0) not null,
  primary key (stream, tx_hash, log_index))`);
for (const i of [
  "create index on compact_transfers (stream, sender, block_number)",
  "create index on compact_transfers (stream, recipient, block_number)",
  "create index on compact_transfers using brin (stream, block_number)",
])
  await q(i);

const lsn = async () => (await q("select pg_current_wal_lsn() l")).rows[0].l;
const walSince = async (a) => Number((await q("select pg_wal_lsn_diff(pg_current_wal_lsn(), $1) d", [a])).rows[0].d);
const B = 2000;
const w0 = await lsn();
for (let i = 0; i < rows.length; i += B) {
  const part = rows.slice(i, i + B);
  const v = [];
  const ph = part.map((r, j) => {
    v.push(r.block, r.blockHash, r.tx, r.txIndex, r.logIndex, r.from, r.to, r.raw, r.time);
    const o = j * 9;
    return `(1, '${USDC}', $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}::numeric, $${o + 8}::numeric / 1000000, $${o + 9})`;
  });
  await q(`insert into spec_usdc_transfers (chain_id, token_address, block_number, block_hash, transaction_hash, transaction_index, log_index, sender, recipient, amount_raw, amount_usdc, block_timestamp) values ${ph.join(",")}`, v);
}
const specWal = await walSince(w0);
const w1 = await lsn();
const blocks = [...new Map(rows.map((r) => [r.block, r])).values()];
await q(`insert into compact_blocks select 1, b, decode(substr(h, 3), 'hex'), t::timestamptz from unnest($1::bigint[], $2::text[], $3::text[]) as x(b, h, t)`, [blocks.map((r) => r.block), blocks.map((r) => r.blockHash), blocks.map((r) => r.time)]);
for (let i = 0; i < rows.length; i += B) {
  const p = rows.slice(i, i + B);
  await q(
    `insert into compact_transfers select 1, b, decode(substr(tx, 3), 'hex'), ti, li, decode(substr(f, 3), 'hex'), decode(substr(t, 3), 'hex'), a::numeric
       from unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[]) as x(b, tx, ti, li, f, t, a)`,
    [p.map((r) => r.block), p.map((r) => r.tx), p.map((r) => r.txIndex), p.map((r) => r.logIndex), p.map((r) => r.from), p.map((r) => r.to), p.map((r) => r.raw)]
  );
}
const compactWal = await walSince(w1);
await q("vacuum analyze");
const size = async (t) => (await q(`select pg_relation_size($1) heap, pg_indexes_size($1) idx, pg_total_relation_size($1) total`, [t])).rows[0];
const s = await size("spec_usdc_transfers");
const ct = await size("compact_transfers");
const cb = await size("compact_blocks");
const per = (x) => +(Number(x) / rows.length).toFixed(1);
const out = {
  sample: { events: rows.length, blocks: `${from}..${to}`, finalizedHash: fin.hash, rpcJsonBytesPerEvent: +(JSON.stringify(logs).length / logs.length).toFixed(1) },
  spec: { heapPerEvent: per(s.heap), indexesPerEvent: per(s.idx), totalPerEvent: per(s.total), walPerEvent: per(specWal) },
  compact: {
    heapPerEvent: per(Number(ct.heap) + Number(cb.heap)),
    indexesPerEvent: per(Number(ct.idx) + Number(cb.idx)),
    totalPerEvent: per(Number(ct.total) + Number(cb.total)),
    walPerEvent: per(compactWal),
  },
  postgres: (await q("show server_version")).rows[0].server_version,
};
console.log(JSON.stringify(out, null, 2));
await c.end();
await pg.stop();
rmSync(dir, { recursive: true, force: true });
