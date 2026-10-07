import { createHash } from "node:crypto";
import { hllAdd, hllMerge, newSketch, toHex, type Sketch } from "./hll";
import type { RpcPool } from "./rpcPool";

// One finalized block range of USDC Transfer logs -> the exact payload of
// usdc_index_commit (migration 0036). Pure except for the RPC reads in
// fetchRange; build() is deterministic for a given set of logs.

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_T = `0x${"0".repeat(64)}`;
const MAX_I64 = (1n << 63n) - 1n;
export const HOUR_P = 12;
export const DAY_P = 14;

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp?: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed?: boolean;
}

export interface Ev {
  block: number;
  logIndex: number;
  txIndex: number;
  tx: string; // 0x + 64 hex
  from: string; // 0x + 40 hex
  to: string;
  amount: bigint;
  kind: 0 | 1 | 2;
  time: number; // unix seconds
}

interface Header {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
}

/** Validated, ordered, de-duplicated logs of [from, to] with exact block times. */
export async function fetchRange(pool: RpcPool, contract: string, from: number, to: number, deadline: () => boolean) {
  const logs: RawLog[] = [];
  const providers: Record<string, number> = {};
  let a = from;
  while (a <= to) {
    const r = await pool.getLogsChunk<RawLog>({ address: contract, topics: [TRANSFER_TOPIC] }, a, to, deadline);
    providers[r.host] = (providers[r.host] ?? 0) + 1;
    for (const l of r.logs) {
      const n = Number(BigInt(l.blockNumber));
      if (n < a || n > r.end) throw new Error(`provider ${r.host} returned block ${n} outside ${a}..${r.end}`);
    }
    logs.push(...r.logs);
    a = r.end + 1;
  }
  const [first, last] = await Promise.all([
    pool.rpc<Header | null>("eth_getBlockByNumber", [`0x${from.toString(16)}`, false], deadline),
    pool.rpc<Header | null>("eth_getBlockByNumber", [`0x${to.toString(16)}`, false], deadline),
  ]);
  if (!first || !last) throw new Error(`header ${!first ? from : to} unavailable`);
  // Block time: the log's own blockTimestamp when the provider sets it (some send 0x0),
  // otherwise the header; a header must agree with the block hash the logs carry.
  const times = new Map<number, number>([[from, Number(BigInt(first.timestamp))], [to, Number(BigInt(last.timestamp))]]);
  const hashes = new Map<number, string>([[from, first.hash.toLowerCase()], [to, last.hash.toLowerCase()]]);
  for (const l of logs) {
    const n = Number(BigInt(l.blockNumber));
    const h = String(l.blockHash).toLowerCase();
    if (hashes.has(n) && hashes.get(n) !== h) throw new Error(`block ${n}: log hash ${h.slice(0, 12)} differs from ${hashes.get(n)!.slice(0, 12)}`);
    hashes.set(n, h);
    const ts = l.blockTimestamp && BigInt(l.blockTimestamp) > 0n ? Number(BigInt(l.blockTimestamp)) : null;
    if (ts !== null && !times.has(n)) times.set(n, ts);
  }
  const missing = [...hashes.keys()].filter((n) => !times.has(n));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (n) => {
        const h = await pool.rpc<Header | null>("eth_getBlockByNumber", [`0x${n.toString(16)}`, false], deadline);
        if (!h || h.hash.toLowerCase() !== hashes.get(n)) throw new Error(`header ${n} does not match its logs`);
        times.set(n, Number(BigInt(h.timestamp)));
      })
    );
  }
  return { logs, times, providers, first, last };
}

/** Decode + validate + order + de-duplicate. Throws on anything malformed. */
export function decode(logs: RawLog[], contract: string, times: Map<number, number>): { events: Ev[]; duplicates: number } {
  const c = contract.toLowerCase();
  const rows = logs.map((l) => {
    const t = (l.topics ?? []).map((x) => String(x).toLowerCase());
    if (l.removed) throw new Error(`removed log at ${l.blockNumber}`);
    if (String(l.address).toLowerCase() !== c || t[0] !== TRANSFER_TOPIC || t.length !== 3 || !/^0x[0-9a-f]{64}$/i.test(l.data)) throw new Error(`malformed Transfer log at ${l.blockNumber}:${l.logIndex}`);
    const block = Number(BigInt(l.blockNumber));
    const amount = BigInt(l.data);
    if (amount > MAX_I64) throw new Error(`amount ${amount} at ${block} exceeds the bigint column; refusing to truncate`);
    const time = times.get(block);
    if (time === undefined) throw new Error(`no block time for ${block}`);
    const ev: Ev = {
      block,
      logIndex: Number(BigInt(l.logIndex)),
      txIndex: Number(BigInt(l.transactionIndex)),
      tx: String(l.transactionHash).toLowerCase(),
      from: `0x${t[1].slice(26)}`,
      to: `0x${t[2].slice(26)}`,
      amount,
      kind: t[1] === ZERO_T ? 1 : t[2] === ZERO_T ? 2 : 0,
      time,
    };
    return ev;
  });
  rows.sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
  const events: Ev[] = [];
  let duplicates = 0;
  for (const e of rows) {
    const p = events[events.length - 1];
    if (p && p.block === e.block && p.logIndex === e.logIndex) {
      if (p.tx !== e.tx || p.amount !== e.amount) throw new Error(`conflicting logs at ${e.block}:${e.logIndex}`);
      duplicates++;
      continue;
    }
    events.push(e);
  }
  return { events, duplicates };
}

interface Bucket {
  bucket: string;
  transfers: number;
  transfer_raw: bigint;
  mints: number;
  mint_raw: bigint;
  burns: number;
  burn_raw: bigint;
  zero_value: number;
  first_block: number;
  last_block: number;
  top: Ev[];
  s: Sketch | null;
  r: Sketch | null;
}

const topRow = (e: Ev) => [e.amount.toString(), e.block, e.logIndex, e.tx, e.from, e.to, e.kind];
const byTop = (a: Ev, b: Ev) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : a.block - b.block || a.logIndex - b.logIndex);

/**
 * Exact aggregates for the range. `hourSketches`: build p=12 hourly sketches
 * (only hours inside the retention window keep them).
 */
export function build(events: Ev[], opts: { hourSketchesSince: number }) {
  const hours = new Map<number, Bucket>();
  const days = new Map<string, Bucket>();
  const totals = { events: 0, transfers: 0, transfer_raw: 0n, mints: 0, mint_raw: 0n, burns: 0, burn_raw: 0n, zero_value: 0, tx_count: 0 };
  const allS = newSketch(DAY_P);
  const allR = newSketch(DAY_P);
  const digest = createHash("sha256");
  let prevTx: string | null = null;
  let prevBlock = -1;
  const bucketOf = (map: Map<string | number, Bucket>, key: string | number, label: string, p: number | null): Bucket => {
    let b = map.get(key);
    if (!b) {
      b = { bucket: label, transfers: 0, transfer_raw: 0n, mints: 0, mint_raw: 0n, burns: 0, burn_raw: 0n, zero_value: 0, first_block: Infinity, last_block: -1, top: [], s: p ? newSketch(p) : null, r: p ? newSketch(p) : null };
      map.set(key, b);
    }
    return b;
  };
  for (const e of events) {
    // Logs of one transaction are contiguous in (block, logIndex) order.
    if (e.tx !== prevTx || e.block !== prevBlock) totals.tx_count++;
    prevTx = e.tx;
    prevBlock = e.block;
    digest.update(`${e.block}:${e.logIndex}:${e.tx}:${e.from}:${e.to}:${e.amount}\n`);
    const hourStart = Math.floor(e.time / 3600) * 3600;
    const day = new Date(e.time * 1000).toISOString().slice(0, 10);
    const h = bucketOf(hours as Map<string | number, Bucket>, hourStart, new Date(hourStart * 1000).toISOString(), hourStart >= opts.hourSketchesSince ? HOUR_P : null);
    const d = bucketOf(days as Map<string | number, Bucket>, day, day, DAY_P);
    totals.events++;
    for (const b of [h, d]) {
      if (e.kind === 1) (b.mints++, (b.mint_raw += e.amount));
      else if (e.kind === 2) (b.burns++, (b.burn_raw += e.amount));
      else (b.transfers++, (b.transfer_raw += e.amount));
      if (e.amount === 0n) b.zero_value++;
      b.first_block = Math.min(b.first_block, e.block);
      b.last_block = Math.max(b.last_block, e.block);
      b.top.push(e);
      if (b.top.length > 20) b.top = b.top.sort(byTop).slice(0, 10);
      // Senders exclude mints (0x0 is not a sender); receivers exclude burns.
      if (e.kind !== 1 && b.s) hllAdd(b.s, e.from);
      if (e.kind !== 2 && b.r) hllAdd(b.r, e.to);
    }
    if (e.kind === 1) (totals.mints++, (totals.mint_raw += e.amount));
    else if (e.kind === 2) (totals.burns++, (totals.burn_raw += e.amount));
    else (totals.transfers++, (totals.transfer_raw += e.amount));
    if (e.amount === 0n) totals.zero_value++;
  }
  for (const d of days.values()) {
    hllMerge(allS, d.s!);
    hllMerge(allR, d.r!);
  }
  const out = (b: Bucket) => ({
    bucket: b.bucket,
    transfers: b.transfers,
    transfer_raw: b.transfer_raw.toString(),
    mints: b.mints,
    mint_raw: b.mint_raw.toString(),
    burns: b.burns,
    burn_raw: b.burn_raw.toString(),
    zero_value: b.zero_value,
    first_block: b.first_block,
    last_block: b.last_block,
    top: b.top.sort(byTop).slice(0, 10).map(topRow),
    senders_hll: b.s ? toHex(b.s) : "",
    receivers_hll: b.r ? toHex(b.r) : "",
  });
  return {
    rows: events.map((e) => [e.block, e.logIndex, e.txIndex, e.tx.slice(2), e.from.slice(2), e.to.slice(2), e.amount.toString(), e.kind, e.time]),
    hours: [...hours.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1)).map(out),
    days: [...days.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1)).map(out),
    totals: {
      ...totals,
      transfer_raw: totals.transfer_raw.toString(),
      mint_raw: totals.mint_raw.toString(),
      burn_raw: totals.burn_raw.toString(),
      senders_hll: events.length ? toHex(allS) : "",
      receivers_hll: events.length ? toHex(allR) : "",
    },
    digest: digest.digest("hex"),
  };
}
