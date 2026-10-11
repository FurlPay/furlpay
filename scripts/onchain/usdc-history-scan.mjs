#!/usr/bin/env node
// Lifetime census of native USDC Transfer events on Ethereum mainnet
// (MEASUREMENT mode: counts, does not store events), read from archive RPC
// nodes with eth_getLogs. No Alchemy, no explorer.
//
//   npm run usdc:probe -- --out <dir> [--to <block>] [--workers 8] [--rpc a,b]
//   npm run usdc:probe:report -- --out <dir>
//
// EXACT: transfer events, unique transactions, max events per transaction,
// mint / burn / regular counts and raw sums (BigInt), largest and smallest
// non-zero transfer, zero-value transfers, first and last transfer, events per
// unit of 10,000 blocks with the unit's last-block timestamp.
// ESTIMATED (labelled): unique addresses / senders / receivers / sender->
// receiver pairs via HyperLogLog (p=14, standard error ~0.81%). Exact sets of
// that size cannot be held crash-safely on this machine (3 GB free disk); HLL
// sketches are saved per unit and merge exactly, so resuming loses nothing.
// MEDIAN: an exact histogram by bit length; the median is reported as the
// exact power-of-two interval it falls in, not a point value.
//
// Boundary: the deployment block (the first block with contract code, found by
// binary search on archive state) through the finalized block at the first
// run, recorded with its hash in <out>/plan.json; resumed runs keep it.
// Checkpoint: one line per finished unit in <out>/units.jsonl (its sketch is
// written first). A unit is all-or-nothing; a restart redoes unfinished units.
// Checks: every log's contract, topic, topic count, block range and `removed`
// flag; de-duplication on (tx hash, log index). A transaction's logs share one
// block, so per-unit unique-transaction counts add up exactly across units.
// The contiguous prefix must satisfy minted - burned = totalSupply() there.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHAIN_ID = 1;
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_T = "0x0000000000000000000000000000000000000000000000000000000000000000";
const UNIT = 10_000;
const MAX_SPAN = 10_000;
const HLL_P = 14;
const HLL_M = 1 << HLL_P;
const SKETCHES = ["addresses", "senders", "receivers", "pairs"];

// Keyless archive providers verified 2026-10-07 to return identical USDC log
// counts at blocks 7M/12M/18M/22M/26M (several cap the block range; the cap
// they state is adopted per provider).
const DEFAULT_RPCS = [
  "https://rpc.mevblocker.io",
  "https://mainnet.gateway.tenderly.co",
  "https://rpc.sentio.xyz/mainnet",
  "https://eth-pokt.nodies.app",
  "https://ethereum-mainnet.gateway.tatum.io",
  "https://eth-mainnet.public.blastapi.io",
  "https://ethereum.public.blockpi.network/v1/rpc/public",
].join(",");
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg("--out");
if (!OUT) {
  console.error("--out <dir> is required");
  process.exit(2);
}
mkdirSync(join(OUT, "sketches"), { recursive: true });
const RPCS = String(arg("--rpc", process.env.USDC_SCAN_RPCS ?? DEFAULT_RPCS)).split(",").map((s) => s.trim()).filter(Boolean);
if (RPCS.some((u) => /alchemy/i.test(u))) {
  console.error("this probe does not use Alchemy");
  process.exit(2);
}
const WORKERS = Number(arg("--workers", "8"));
const hex = (n) => `0x${n.toString(16)}`;

// ---------------------------------------------------------------- providers
const statsFile = join(OUT, "providers.json");
const saved = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, "utf8")) : {};
const prov = new Map(
  RPCS.map((u) => [
    u,
    {
      url: u,
      span: 2000,
      maxOkSpan: 0,
      requests: 0,
      ok: 0,
      rangeErrors: 0,
      rateLimited: 0,
      otherErrors: 0,
      latencyMsTotal: 0,
      lastSuccess: null,
      lastError: null,
      archive: null,
      cap: null,
      ...(saved[u] ?? {}),
      until: 0,
      streak: 0,
      inflight: 0,
    },
  ])
);
for (const p of prov.values()) p.span = Math.min(p.cap ?? MAX_SPAN, Math.max(p.span, 100));
const saveStats = () => writeFileSync(statsFile, JSON.stringify(Object.fromEntries([...prov].map(([u, p]) => [u, { ...p, until: undefined, streak: undefined, inflight: undefined }])), null, 2));
const PER_PROVIDER = Number(arg("--per-provider", "3"));
/** Least-loaded healthy provider, weighted by its own observed latency; null if all are busy or paused. */
function pick(allowed = null) {
  const now = Date.now();
  let best = null;
  let bestScore = Infinity;
  for (const p of prov.values()) {
    if (allowed && !allowed.has(new URL(p.url).host)) continue;
    if (p.until > now || p.inflight >= PER_PROVIDER) continue;
    const lat = p.ok ? p.latencyMsTotal / p.ok : 1000;
    const score = (p.inflight + 1) * lat;
    if (score < bestScore) (best = p), (bestScore = score);
  }
  return best;
}
async function pickWait(allowed = null) {
  for (;;) {
    const p = pick(allowed);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const isRange = (m) => /range|too many|exceed|10000|results|response size|query returned more|block range|timeout|abort/i.test(m) && !/rate|429|too many requests/i.test(m);
const isRate = (m) => /rate|429|too many requests|capacity|throttl/i.test(m);

async function call(p, method, params, timeoutMs = 60_000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  const t0 = Date.now();
  p.requests++;
  p.inflight++;
  try {
    const r = await fetch(p.url, { method: "POST", signal: c.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const text = await r.text();
    if (r.status === 429) throw new Error("HTTP 429 too many requests");
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${r.status} non-JSON`);
    }
    if (b.error) throw new Error(String(b.error.message ?? b.error.code));
    p.ok++;
    p.latencyMsTotal += Date.now() - t0;
    p.lastSuccess = new Date().toISOString();
    p.streak = 0;
    return { result: b.result, bytes: text.length };
  } catch (e) {
    const m = e.name === "AbortError" ? "timeout" : String(e.message);
    p.lastError = `${new Date().toISOString()} ${m.slice(0, 140)}`;
    p.streak++;
    if (isRate(m)) {
      p.rateLimited++;
      p.until = Date.now() + Math.min(120_000, 1000 * 2 ** Math.min(p.streak, 7));
    } else if (isRange(m)) p.rangeErrors++;
    else {
      p.otherErrors++;
      p.until = Date.now() + Math.min(60_000, 500 * 2 ** Math.min(p.streak, 7));
    }
    // A provider that states its own range limit: adopt it as that provider's cap.
    const cap = /(?:maximum allowed is|limit of|up to an?|max(?:imum)? (?:block )?range(?: is| of)?)\s*(\d{1,6})/i.exec(m);
    if (cap && isRange(m)) {
      p.cap = Math.max(1, Number(cap[1]));
      p.span = Math.min(p.span, p.cap);
    }
    throw Object.assign(new Error(m), { range: isRange(m), rate: isRate(m) });
  } finally {
    p.inflight--;
    clearTimeout(t);
  }
}
/** Non-log calls: any healthy provider, retried. */
async function rpc(method, params) {
  let last;
  for (let i = 0; i < 10; i++) {
    const p = await pickWait();
    try {
      return (await call(p, method, params)).result;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** Math.min(i, 6)));
    }
  }
  throw last;
}

// ---------------------------------------------------------------- HyperLogLog
function h64(s) {
  // Two independent 32-bit murmur3-style hashes of the string.
  let a = 0x9747b28c ^ s.length, b = 0x85ebca6b ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0xcc9e2d51);
    a = (a << 15) | (a >>> 17);
    a = Math.imul(a, 0x1b873593);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b = (b << 13) | (b >>> 19);
    b = Math.imul(b, 0xc2b2ae35);
  }
  a ^= a >>> 16; a = Math.imul(a, 0x85ebca6b); a ^= a >>> 13; a = Math.imul(a, 0xc2b2ae35); a ^= a >>> 16;
  b ^= b >>> 15; b = Math.imul(b, 0x2c1b3c6d); b ^= b >>> 12; b = Math.imul(b, 0x297a2d39); b ^= b >>> 15;
  return [a >>> 0, b >>> 0];
}
function hllAdd(reg, s) {
  const [a, b] = h64(s);
  const idx = a >>> (32 - HLL_P);
  // rank over the remaining 18 bits of a, then the 32 bits of b
  const rest = ((a << HLL_P) >>> 0);
  let rank;
  if (rest !== 0) rank = Math.clz32(rest) + 1;
  else rank = 32 - HLL_P + (b !== 0 ? Math.clz32(b) + 1 : 33);
  if (rank > reg[idx]) reg[idx] = rank;
}
export function hllCount(reg) {
  let sum = 0, zeros = 0;
  for (let i = 0; i < HLL_M; i++) {
    sum += 2 ** -reg[i];
    if (reg[i] === 0) zeros++;
  }
  const alpha = 0.7213 / (1 + 1.079 / HLL_M);
  const e = (alpha * HLL_M * HLL_M) / sum;
  if (e <= 2.5 * HLL_M && zeros > 0) return Math.round(HLL_M * Math.log(HLL_M / zeros));
  return Math.round(e);
}

// ---------------------------------------------------------------- scanning
async function getLogsChunk(a, b, allowed = null) {
  // Returns logs for [a, b'] with b' <= b, using one provider's current span.
  for (let attempt = 0; ; attempt++) {
    const p = await pickWait(allowed);
    const end = Math.min(b, a + p.span - 1);
    try {
      const r = await call(p, "eth_getLogs", [{ address: USDC, topics: [TOPIC], fromBlock: hex(a), toBlock: hex(end) }]);
      const span = end - a + 1;
      if (span > p.maxOkSpan) p.maxOkSpan = span;
      if (r.result.length < 2500 && p.span < (p.cap ?? MAX_SPAN)) p.span = Math.min(p.cap ?? MAX_SPAN, p.span * 2);
      return { logs: r.result, bytes: r.bytes, end, provider: p, retries: attempt };
    } catch (e) {
      // Range/size/timeout, or an unexplained error repeated: shrink this provider's range.
      if ((e.range || (!e.rate && p.streak >= 2)) && p.span > 1) p.span = Math.max(1, Math.floor(p.span / 2));
      if (attempt >= 40) throw e;
      if (e.rate) await new Promise((r) => setTimeout(r, 250));
    }
  }
}

const progress = { events: 0, txs: 0, blocks: 0, retries: 0, failures: 0 };

async function scanUnit(from, to, allowed = null) {
  const acc = { from, to, logs: 0, txs: 0, maxPerTx: 0, maxTx: null, mints: 0, mintRaw: 0n, burns: 0, burnRaw: 0n, regular: 0, regularRaw: 0n, zeroValue: 0, largest: null, smallestNonZero: null, firstLog: null, lastLog: null, rpcBytes: 0, calls: 0, retries: 0, hist: {}, providers: {} };
  // O(1) memory: logs are processed in (block, logIndex) order, so a duplicate
  // is an equal key and a transaction's logs are one contiguous run (log
  // indexes are assigned in transaction order within a block).
  let lastKey = null; // [block, logIndex]
  let runTx = null;
  let runLen = 0;
  const endRun = () => {
    if (runTx !== null && runLen > acc.maxPerTx) [acc.maxPerTx, acc.maxTx] = [runLen, runTx];
  };
  acc.duplicatesSkipped = 0;
  const reg = Object.fromEntries(SKETCHES.map((k) => [k, new Uint8Array(HLL_M)]));
  let largest = -1n, smallest = -1n;
  let a = from;
  while (a <= to) {
    const r = await getLogsChunk(a, to, allowed);
    acc.calls++;
    acc.retries += r.retries;
    acc.rpcBytes += r.bytes;
    const host = new URL(r.provider.url).host;
    acc.providers[host] = (acc.providers[host] ?? 0) + 1;
    const sorted = r.logs
      .map((l) => [Number(BigInt(l.blockNumber)), Number(BigInt(l.logIndex)), l])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const [n, li, l] of sorted) {
      const t = (l.topics ?? []).map((x) => String(x).toLowerCase());
      if (l.removed) throw new Error(`removed log at ${n}`);
      if (String(l.address).toLowerCase() !== USDC || t[0] !== TOPIC || t.length !== 3 || n < a || n > r.end) throw new Error(`unexpected log at ${n} in ${a}..${r.end}`);
      const tx = String(l.transactionHash).toLowerCase();
      // Identity (chain, contract, block, logIndex) == (chain, contract, tx, logIndex) for canonical logs.
      if (lastKey && (n < lastKey[0] || (n === lastKey[0] && li < lastKey[1]))) throw new Error(`log ${n}:${li} precedes ${lastKey[0]}:${lastKey[1]}`);
      if (lastKey && n === lastKey[0] && li === lastKey[1]) {
        acc.duplicatesSkipped++;
        continue;
      }
      lastKey = [n, li];
      if (tx !== runTx) {
        endRun();
        runTx = tx;
        runLen = 0;
        acc.txs++;
      }
      runLen++;
      const raw = BigInt(l.data === "0x" ? 0 : l.data);
      const from_ = `0x${t[1].slice(26)}`;
      const to_ = `0x${t[2].slice(26)}`;
      acc.logs++;
      if (t[1] === ZERO_T) (acc.mints++, (acc.mintRaw += raw));
      else if (t[2] === ZERO_T) (acc.burns++, (acc.burnRaw += raw));
      else (acc.regular++, (acc.regularRaw += raw));
      if (raw === 0n) acc.zeroValue++;
      else {
        const k = raw.toString(2).length; // raw in [2^(k-1), 2^k)
        acc.hist[k] = (acc.hist[k] ?? 0) + 1;
        if (smallest < 0n || raw < smallest) (smallest = raw), (acc.smallestNonZero = { raw: raw.toString(), tx, block: n });
      }
      if (raw > largest) (largest = raw), (acc.largest = { raw: raw.toString(), tx, block: n });
      if (!acc.firstLog || n < acc.firstLog.block || (n === acc.firstLog.block && li < acc.firstLog.logIndex)) acc.firstLog = { block: n, tx, logIndex: li };
      if (!acc.lastLog || n > acc.lastLog.block || (n === acc.lastLog.block && li > acc.lastLog.logIndex)) acc.lastLog = { block: n, tx, logIndex: li };
      if (t[1] !== ZERO_T) (hllAdd(reg.addresses, from_), hllAdd(reg.senders, from_));
      if (t[2] !== ZERO_T) (hllAdd(reg.addresses, to_), hllAdd(reg.receivers, to_));
      if (t[1] !== ZERO_T && t[2] !== ZERO_T) hllAdd(reg.pairs, from_ + to_);
    }
    a = r.end + 1;
  }
  endRun();
  const hdr = await rpc("eth_getBlockByNumber", [hex(to), false]);
  acc.lastBlockTime = new Date(Number(BigInt(hdr.timestamp)) * 1000).toISOString();
  return { acc: { ...acc, mintRaw: String(acc.mintRaw), burnRaw: String(acc.burnRaw), regularRaw: String(acc.regularRaw) }, reg };
}

function loadUnits(dir = OUT) {
  const f = join(dir, "units.jsonl");
  const m = new Map();
  if (!existsSync(f)) return m;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const u = JSON.parse(line);
      if (u.v === 2) m.set(u.from, u);
    } catch {
      /* torn last line from a crash: that unit is redone */
    }
  }
  return m;
}

async function run() {
  const planFile = join(OUT, "plan.json");
  let plan;
  // VERIFY mode: recount every unit of another census on the SAME boundary,
  // using only providers that did not serve that unit there.
  const VERIFY = arg("--verify-against");
  const original = VERIFY ? loadUnits(VERIFY) : null;
  if (VERIFY && !existsSync(planFile)) writeFileSync(planFile, readFileSync(join(VERIFY, "plan.json")));
  if (existsSync(planFile)) plan = JSON.parse(readFileSync(planFile, "utf8"));
  else {
    const fin = arg("--to") ? await rpc("eth_getBlockByNumber", [hex(Number(arg("--to"))), false]) : await rpc("eth_getBlockByNumber", ["finalized", false]);
    const toBlock = Number(BigInt(fin.number));
    // First block with code: binary search on archive state.
    let lo = 0, hi = toBlock;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const code = await rpc("eth_getCode", [USDC, hex(mid)]);
      if (code && code.length > 2) hi = mid;
      else lo = mid + 1;
    }
    const before = await rpc("eth_getCode", [USDC, hex(lo - 1)]);
    if (before && before.length > 2) throw new Error("deployment search inconsistent");
    plan = { chainId: CHAIN_ID, contract: USDC, topic: TOPIC, deploymentBlock: lo, toBlock, toBlockHash: fin.hash, toBlockTime: new Date(Number(BigInt(fin.timestamp)) * 1000).toISOString(), boundary: arg("--to") ? "explicit" : "finalized", unit: UNIT, createdAt: new Date().toISOString() };
    writeFileSync(planFile, JSON.stringify(plan, null, 2));
    for (const p of prov.values()) p.archive = true;
  }
  const done = loadUnits();
  const queue = [];
  for (let f = plan.deploymentBlock; f <= plan.toBlock; f += plan.unit) if (!done.has(f) && (!original || original.has(f))) queue.push([f, Math.min(plan.toBlock, f + plan.unit - 1)]);
  // Units from the first census run predate per-unit provider records; that run used only these two.
  const FIRST_RUN_HOSTS = ["rpc.mevblocker.io", "mainnet.gateway.tenderly.co"];
  const allowedFor = (f) => {
    if (!original) return null;
    const used = new Set(Object.keys(original.get(f)?.providers ?? {}).length ? Object.keys(original.get(f).providers) : FIRST_RUN_HOSTS);
    const free = new Set(RPCS.map((u) => new URL(u).host).filter((h) => !used.has(h)));
    return free.size ? free : null;
  };
  const totalBlocks = plan.toBlock - plan.deploymentBlock + 1;
  for (const u of done.values()) (progress.events += u.logs), (progress.txs += u.txs), (progress.blocks += u.to - u.from + 1);
  console.log(`plan ${plan.deploymentBlock}..${plan.toBlock} (${plan.boundary} ${plan.toBlockHash}); ${done.size} units done, ${queue.length} to go; providers: ${RPCS.join(", ")}; workers ${WORKERS}`);
  const t0 = Date.now();
  const base = { ...progress };
  const tick = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    const bps = (progress.blocks - base.blocks) / s;
    const left = totalBlocks - progress.blocks;
    const ps = [...prov.values()].map((p) => `${new URL(p.url).host} span=${p.span} ok=${p.ok} rangeErr=${p.rangeErrors} rate=${p.rateLimited} err=${p.otherErrors} avg=${p.ok ? Math.round(p.latencyMsTotal / p.ok) : "-"}ms`).join(" ; ");
    console.log(`${new Date().toISOString()} ${((progress.blocks / totalBlocks) * 100).toFixed(2)}% blocks ${progress.blocks}/${totalBlocks} · events ${progress.events} · txs ${progress.txs} · ${Math.round((progress.events - base.events) / s)} ev/s · ${Math.round(bps)} blk/s · ETA ~${bps > 0 ? Math.round(left / bps / 60) : "?"} min (at the current rate; later blocks are denser) · unit retries ${progress.retries} failures ${progress.failures} · ${ps}`);
    saveStats();
  }, 30_000);
  const worker = async () => {
    while (queue.length) {
      const [f, t] = queue.shift();
      for (let attempt = 0; ; attempt++) {
        try {
          const allowed = allowedFor(f);
          const { acc, reg } = await scanUnit(f, t, allowed);
          if (original) acc.independentOfOriginal = allowed !== null;
          writeFileSync(join(OUT, "sketches", `${f}.bin`), Buffer.concat(SKETCHES.map((k) => Buffer.from(reg[k]))));
          appendFileSync(join(OUT, "units.jsonl"), JSON.stringify({ v: 2, ...acc, at: new Date().toISOString() }) + "\n");
          progress.events += acc.logs;
          progress.txs += acc.txs;
          progress.blocks += t - f + 1;
          progress.retries += acc.retries;
          break;
        } catch (e) {
          progress.failures++;
          const wait = Math.min(300_000, 5000 * 2 ** attempt);
          console.log(`unit ${f}..${t} attempt ${attempt + 1} failed: ${String(e.message).slice(0, 140)}; retry in ${wait / 1000}s`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  clearInterval(tick);
  saveStats();
  console.log("scan complete; run the report");
}

// ---------------------------------------------------------------- report
const fmtInt = (n) => BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmt6 = (r) => {
  const s = BigInt(r).toString().padStart(7, "0");
  return `${s.slice(0, -6).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${s.slice(-6)}`;
};

async function report() {
  const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8"));
  const units = [...loadUnits().values()].sort((a, b) => a.from - b.from);
  const totalUnits = Math.ceil((plan.toBlock - plan.deploymentBlock + 1) / plan.unit);
  let prefixEnd = plan.deploymentBlock - 1;
  for (const u of units) {
    if (u.from !== prefixEnd + 1) break;
    prefixEnd = u.to;
  }
  const sum = (k) => units.reduce((a, u) => a + u[k], 0);
  const big = (k, only = units) => only.reduce((a, u) => a + BigInt(u[k]), 0n);
  const blocks = units.reduce((a, u) => a + (u.to - u.from + 1), 0);
  const events = sum("logs");
  const txs = sum("txs");
  const maxU = units.reduce((m, u) => (u.maxPerTx > (m?.maxPerTx ?? -1) ? u : m), null);
  const largest = units.reduce((m, u) => (u.largest && (!m || BigInt(u.largest.raw) > BigInt(m.raw)) ? u.largest : m), null);
  const smallest = units.reduce((m, u) => (u.smallestNonZero && (!m || BigInt(u.smallestNonZero.raw) < BigInt(m.raw)) ? u.smallestNonZero : m), null);
  const first = units.find((u) => u.firstLog)?.firstLog ?? null;
  const last = [...units].reverse().find((u) => u.lastLog)?.lastLog ?? null;
  const ts = async (b) => (b === null ? null : new Date(Number(BigInt((await rpc("eth_getBlockByNumber", [hex(b), false])).timestamp)) * 1000).toISOString());
  // Median: exact histogram over non-zero values by bit length (+ zero-value transfers).
  const hist = new Map();
  for (const u of units) for (const [k, c] of Object.entries(u.hist)) hist.set(Number(k), (hist.get(Number(k)) ?? 0) + c);
  const zero = sum("zeroValue");
  let median = null;
  {
    const target = Math.floor((events - 1) / 2) + 1; // lower median, 1-based rank
    let cum = zero;
    if (target <= zero) median = { interval: "0 (zero-value transfer)" };
    else
      for (const k of [...hist.keys()].sort((a, b) => a - b)) {
        cum += hist.get(k);
        if (cum >= target) {
          median = { interval: `[${fmt6(1n << BigInt(k - 1))}, ${fmt6(1n << BigInt(k))}) USDC` };
          break;
        }
      }
  }
  // Merge HLL sketches.
  const merged = Object.fromEntries(SKETCHES.map((k) => [k, new Uint8Array(HLL_M)]));
  for (const u of units) {
    const f = join(OUT, "sketches", `${u.from}.bin`);
    if (!existsSync(f)) continue;
    const b = readFileSync(f);
    SKETCHES.forEach((k, i) => {
      for (let j = 0; j < HLL_M; j++) if (b[i * HLL_M + j] > merged[k][j]) merged[k][j] = b[i * HLL_M + j];
    });
  }
  // Rates from unit timestamps.
  const byYear = {};

  for (const u of units) {
    const y = (u.lastBlockTime ?? "").slice(0, 4);
    byYear[y] = (byYear[y] ?? 0) + u.logs;
  }
  const tail = units.slice(-10);
  const tailSecs = tail.length > 1 ? (Date.parse(tail.at(-1).lastBlockTime) - Date.parse(units[units.length - 11]?.lastBlockTime ?? tail[0].lastBlockTime)) / 1000 : null;
  const tailEvents = tail.reduce((a, u) => a + u.logs, 0);
  const firstTime = first ? await ts(first.block) : null;
  const lastTime = last ? await ts(last.block) : null;
  const spanDays = firstTime && lastTime ? (Date.parse(lastTime) - Date.parse(firstTime)) / 86_400_000 : null;
  const out = {
    network: "Ethereum mainnet (chain id 1)",
    contract: plan.contract,
    deploymentBlock: plan.deploymentBlock,
    boundary: { block: plan.toBlock, hash: plan.toBlockHash, time: plan.toBlockTime, kind: plan.boundary },
    complete: units.length === totalUnits && prefixEnd === plan.toBlock,
    unitsDone: `${units.length}/${totalUnits}`,
    blocksScanned: blocks,
    contiguousThrough: prefixEnd,
    remainingBlocks: plan.toBlock - plan.deploymentBlock + 1 - blocks,
    firstTransfer: first && { ...first, time: firstTime },
    latestTransfer: last && { ...last, time: lastTime },
    EXACT: {
      transferEvents: fmtInt(events),
      uniqueTransactions: fmtInt(txs),
      avgEventsPerTransaction: txs ? (events / txs).toFixed(4) : null,
      maxEventsInOneTransaction: maxU ? { count: maxU.maxPerTx, tx: maxU.maxTx } : null,
      mintEvents: fmtInt(sum("mints")),
      mintVolumeUsdc: fmt6(big("mintRaw")),
      burnEvents: fmtInt(sum("burns")),
      burnVolumeUsdc: fmt6(big("burnRaw")),
      regularTransferEvents: fmtInt(sum("regular")),
      regularTransferVolumeUsdc: fmt6(big("regularRaw")),
      allEventsVolumeUsdc: fmt6(big("mintRaw") + big("burnRaw") + big("regularRaw")),
      averageEventUsdc: events ? fmt6((big("mintRaw") + big("burnRaw") + big("regularRaw")) / BigInt(events)) : null,
      zeroValueEvents: fmtInt(zero),
      largestTransfer: largest && { usdc: fmt6(largest.raw), tx: largest.tx, block: largest.block },
      smallestNonZeroTransfer: smallest && { usdc: fmt6(smallest.raw), tx: smallest.tx, block: smallest.block },
      medianTransfer: median,
      eventsByYear: byYear,
    },
    ESTIMATED_HLL_p14_stderr_0_81pct: Object.fromEntries(SKETCHES.map((k) => [`unique_${k}`, fmtInt(hllCount(merged[k]))])),
    rates: {
      historicalEventsPerDay: spanDays ? Math.round(events / spanDays) : null,
      historicalEventsPerBlock: blocks ? (events / blocks).toFixed(2) : null,
      recentEventsPerDay_last10units: tailSecs ? Math.round(tailEvents / (tailSecs / 86400)) : null,
      recentEventsPerBlock_last10units: (tailEvents / tail.reduce((a, u) => a + (u.to - u.from + 1), 0)).toFixed(2),
    },
    rpcJsonBytes: { total: sum("rpcBytes"), perEvent: events ? (sum("rpcBytes") / events).toFixed(1) : null },
    providers: existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, "utf8")) : null,
  };
  if (prefixEnd >= plan.deploymentBlock) {
    const supply = BigInt(await rpc("eth_call", [{ to: USDC, data: "0x18160ddd" }, hex(prefixEnd)]));
    const prefix = units.filter((u) => u.to <= prefixEnd);
    const implied = big("mintRaw", prefix) - big("burnRaw", prefix);
    out.supplyCheck = { atBlock: prefixEnd, totalSupplyOnChainUsdc: fmt6(supply), mintedMinusBurnedUsdc: fmt6(implied), exact: supply === implied };
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

(args.includes("--report") ? report() : run()).catch((e) => {
  console.error(e);
  process.exit(1);
});
