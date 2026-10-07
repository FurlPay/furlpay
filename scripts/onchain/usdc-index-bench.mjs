#!/usr/bin/env node
// Benchmarks for the USDC index design, on REAL finalized mainnet events.
//
//   npm run usdc:bench -- --db  [--blocks 1000]   storage per schema variant + batch-insert throughput
//   npm run usdc:bench -- --rpc [--blocks 2000]   eth_getLogs throughput at 1/2/4/8 workers
//
// The sample is fetched once and cached in <scratch>/usdc-bench-sample.json.

import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RPCS = String(arg("--rpc-urls", "https://rpc.mevblocker.io,https://mainnet.gateway.tenderly.co")).split(",");
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const hex = (n) => `0x${n.toString(16)}`;
let rr = 0;
async function rpcOn(u, method, params) {
  const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b.result;
}
async function rpc(method, params) {
  for (let i = 0; i < 12; i++) {
    try {
      return await rpcOn(RPCS[rr++ % RPCS.length], method, params);
    } catch {
      await new Promise((r) => setTimeout(r, 400 * 2 ** Math.min(i, 5)));
    }
  }
  throw new Error(`${method} failed`);
}

async function sample(blocks) {
  const f = join(tmpdir(), `usdc-bench-sample-${blocks}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const fin = await rpc("eth_getBlockByNumber", ["finalized", false]);
  const to = Number(BigInt(fin.number));
  const from = to - blocks + 1;
  const logs = [];
  for (let a = from; a <= to; a += 100) logs.push(...(await rpc("eth_getLogs", [{ address: USDC, topics: [TOPIC], fromBlock: hex(a), toBlock: hex(Math.min(to, a + 99)) }])));
  const times = new Map();
  for (const n of [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))]) times.set(n, (await rpc("eth_getBlockByNumber", [n, false])).timestamp);
  const rows = logs.map((l) => ({
    block: Number(BigInt(l.blockNumber)),
    blockHash: l.blockHash.toLowerCase(),
    time: Number(BigInt(l.blockTimestamp ?? times.get(l.blockNumber))),
    tx: l.transactionHash.toLowerCase(),
    txIndex: Number(BigInt(l.transactionIndex)),
    logIndex: Number(BigInt(l.logIndex)),
    from: `0x${l.topics[1].slice(26)}`,
    to: `0x${l.topics[2].slice(26)}`,
    raw: BigInt(l.data === "0x" ? 0 : l.data).toString(),
  }));
  const s = { from, to, finalizedHash: fin.hash, rows };
  writeFileSync(f, JSON.stringify(s));
  return s;
}

async function dbBench() {
  const s = await sample(Number(arg("--blocks", "1000")));
  const rows = s.rows;
  const dir = mkdtempSync(join(tmpdir(), "usdc-bench-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 15445, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  const c = pg.getPgClient();
  await c.connect();
  const q = (t, p) => c.query(t, p);
  const kind = (r) => (r.from === ZERO ? 1 : r.to === ZERO ? 2 : 0);
  const cols = (p) => ({
    block: p.map((r) => r.block),
    tx: p.map((r) => r.tx),
    txIndex: p.map((r) => r.txIndex),
    logIndex: p.map((r) => r.logIndex),
    from: p.map((r) => r.from),
    to: p.map((r) => r.to),
    raw: p.map((r) => r.raw),
    kind: p.map(kind),
  });
  const variants = {
    // B: compact bytea, tx hash kept and keyed.
    compact: {
      ddl: [
        `create table v (block_number bigint not null, tx_hash bytea not null, tx_index integer not null, log_index integer not null, sender bytea not null, recipient bytea not null, amount_raw bigint not null, kind smallint not null, primary key (tx_hash, log_index))`,
        `create index v_sender on v (sender, block_number)`,
        `create index v_recipient on v (recipient, block_number)`,
        `create index v_block on v using brin (block_number)`,
      ],
      insert: (p) => {
        const k = cols(p);
        return q(
          `insert into v select b, decode(substr(tx,3),'hex'), ti, li, decode(substr(f,3),'hex'), decode(substr(t,3),'hex'), a::bigint, kd
             from unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::smallint[]) x(b, tx, ti, li, f, t, a, kd) on conflict do nothing`,
          [k.block, k.tx, k.txIndex, k.logIndex, k.from, k.to, k.raw, k.kind]
        );
      },
    },
    // C: lean — identity (block, log_index); tx hash in the heap, NOT indexed
    // (a tx lookup asks the node for the receipt's block, then reads that block).
    lean: {
      ddl: [
        `create table v (block_number bigint not null, log_index integer not null, tx_index integer not null, tx_hash bytea not null, sender bytea not null, recipient bytea not null, amount_raw bigint not null, kind smallint not null, primary key (block_number, log_index))`,
        `create index v_sender on v (sender, block_number)`,
        `create index v_recipient on v (recipient, block_number)`,
      ],
      insert: (p) => {
        const k = cols(p);
        return q(
          `insert into v select b, li, ti, decode(substr(tx,3),'hex'), decode(substr(f,3),'hex'), decode(substr(t,3),'hex'), a::bigint, kd
             from unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::smallint[]) x(b, tx, ti, li, f, t, a, kd) on conflict do nothing`,
          [k.block, k.tx, k.txIndex, k.logIndex, k.from, k.to, k.raw, k.kind]
        );
      },
    },
    // D: lean + address dictionary (int4 ids in the event rows).
    dict: {
      ddl: [
        `create table addr (id integer generated always as identity primary key, a bytea not null unique)`,
        `create table v (block_number bigint not null, log_index integer not null, tx_index integer not null, tx_hash bytea not null, sender integer not null, recipient integer not null, amount_raw bigint not null, kind smallint not null, primary key (block_number, log_index))`,
        `create index v_sender on v (sender, block_number)`,
        `create index v_recipient on v (recipient, block_number)`,
      ],
      insert: async (p) => {
        const k = cols(p);
        await q(`insert into addr (a) select distinct decode(substr(x,3),'hex') from unnest($1::text[] || $2::text[]) x order by 1 on conflict do nothing`, [k.from, k.to]);
        return q(
          `insert into v select b, li, ti, decode(substr(tx,3),'hex'), fa.id, ta.id, amt::bigint, kd
             from unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::smallint[]) x(b, tx, ti, li, f, t, amt, kd)
             join addr fa on fa.a = decode(substr(f,3),'hex') join addr ta on ta.a = decode(substr(t,3),'hex') on conflict do nothing`,
          [k.block, k.tx, k.txIndex, k.logIndex, k.from, k.to, k.raw, k.kind]
        );
      },
    },
  };
  const out = { sample: { events: rows.length, blocks: `${s.from}..${s.to}`, finalizedHash: s.finalizedHash }, variants: {}, inserts: {} };
  for (const [name, v] of Object.entries(variants)) {
    await q("drop table if exists v; drop table if exists addr");
    for (const d of v.ddl) await q(d);
    const w0 = (await q("select pg_current_wal_lsn() l")).rows[0].l;
    const t0 = performance.now();
    for (let i = 0; i < rows.length; i += 2000) {
      await q("begin");
      await v.insert(rows.slice(i, i + 2000));
      await q("commit");
    }
    const ms = performance.now() - t0;
    const wal = Number((await q("select pg_wal_lsn_diff(pg_current_wal_lsn(), $1) d", [w0])).rows[0].d);
    await q("vacuum analyze");
    const sz = (await q(`select pg_relation_size('v') heap, pg_indexes_size('v') idx, pg_total_relation_size('v') total`)).rows[0];
    const idx = (await q(`select indexrelid::regclass::text n, pg_relation_size(indexrelid) b from pg_index where indrelid = 'v'::regclass`)).rows;
    const dict = name === "dict" ? (await q(`select pg_total_relation_size('addr') t, count(*) n from addr`)).rows[0] : null;
    const per = (x) => +(Number(x) / rows.length).toFixed(1);
    out.variants[name] = {
      heapPerEvent: per(sz.heap),
      indexesPerEvent: per(sz.idx),
      totalPerEvent: per(sz.total),
      perIndex: Object.fromEntries(idx.map((r) => [r.n, per(r.b)])),
      walPerEvent: per(wal),
      insertEventsPerSec: Math.round(rows.length / (ms / 1000)),
      ...(dict ? { dictionaryAddresses: Number(dict.n), dictionaryBytesPerAddress: +(Number(dict.t) / Number(dict.n)).toFixed(1) } : {}),
    };
    // Re-inserting the same events must add nothing (idempotent retry).
    for (let i = 0; i < rows.length; i += 2000) await v.insert(rows.slice(i, i + 2000));
    out.variants[name].afterReplayRows = Number((await q("select count(*) n from v")).rows[0].n);
  }
  // Batch-size throughput on the lean variant.
  for (const bs of [500, 2000, 5000]) {
    await q("drop table if exists v; drop table if exists addr");
    for (const d of variants.lean.ddl) await q(d);
    const t0 = performance.now();
    for (let i = 0; i < rows.length; i += bs) {
      await q("begin");
      await variants.lean.insert(rows.slice(i, i + bs));
      await q("commit");
    }
    out.inserts[`lean_batch_${bs}`] = Math.round(rows.length / ((performance.now() - t0) / 1000));
  }
  // Hourly aggregate footprint: one row per (stream, hour).
  await q(`create table h (stream smallint, hour timestamptz, transfers bigint, transfer_raw numeric(78,0), mints bigint, mint_raw numeric(78,0), burns bigint, burn_raw numeric(78,0), senders_hll bytea, receivers_hll bytea, primary key (stream, hour))`);
  await q(`insert into h select 1, to_timestamp(3600 * g), 1000, 123456789012345, 3, 1000000, 2, 900000, null, null from generate_series(1, 8760) g`);
  out.hourlyAggregateBytesPerRow_excludingSketches = +(Number((await q(`select pg_total_relation_size('h') t`)).rows[0].t) / 8760).toFixed(1);
  out.postgres = (await q("show server_version")).rows[0].server_version;
  out.availableExtensions = (await q(`select name from pg_available_extensions where name in ('hll', 'postgresql-hll', 'hyperloglog', 'pg_partman', 'timescaledb', 'citus') order by 1`)).rows.map((r) => r.name);
  console.log(JSON.stringify(out, null, 2));
  await c.end();
  await pg.stop();
  rmSync(dir, { recursive: true, force: true });
}

async function rpcBench() {
  const fin = await rpc("eth_getBlockByNumber", ["finalized", false]);
  const to = Number(BigInt(fin.number));
  const blocks = Number(arg("--blocks", "2000"));
  const out = { range: `${to - blocks + 1}..${to}`, results: {} };
  for (const workers of [1, 2, 4, 8]) {
    const span = 50; // ~5k logs per request at current density
    const ranges = [];
    for (let a = to - blocks + 1; a <= to; a += span) ranges.push([a, Math.min(to, a + span - 1)]);
    let events = 0, errors = 0, lat = 0, calls = 0;
    const t0 = performance.now();
    const mem0 = process.memoryUsage().rss;
    let peak = mem0;
    const cpu0 = process.cpuUsage();
    const worker = async (w) => {
      while (ranges.length) {
        const [a, b] = ranges.shift();
        const u = RPCS[(w + calls) % RPCS.length];
        const s = performance.now();
        try {
          const r = await rpcOn(u, "eth_getLogs", [{ address: USDC, topics: [TOPIC], fromBlock: hex(a), toBlock: hex(b) }]);
          events += r.length;
          lat += performance.now() - s;
          calls++;
        } catch {
          errors++;
          ranges.push([a, b]);
          await new Promise((r) => setTimeout(r, 1000));
        }
        peak = Math.max(peak, process.memoryUsage().rss);
      }
    };
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
    const secs = (performance.now() - t0) / 1000;
    const cpu = process.cpuUsage(cpu0);
    out.results[`${workers}_workers`] = { blocksPerSec: Math.round(blocks / secs), eventsPerSec: Math.round(events / secs), avgLatencyMs: Math.round(lat / Math.max(1, calls)), errors, cpuSecPerSec: +((cpu.user + cpu.system) / 1e6 / secs).toFixed(2), peakRssMB: Math.round(peak / 1e6), events };
    console.error(`${workers} workers:`, out.results[`${workers}_workers`]);
  }
  console.log(JSON.stringify(out, null, 2));
}

(args.includes("--rpc") ? rpcBench() : dbBench()).catch((e) => {
  console.error(e);
  process.exit(1);
});
