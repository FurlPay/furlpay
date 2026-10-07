#!/usr/bin/env node
// Re-counts a random sample of finished census units (usdc-history-scan.mjs)
// on EACH provider separately and compares event count, unique transactions
// and exact raw sums with the stored unit. A provider that dropped or added
// logs shows up as a mismatch.
//   node scripts/onchain/usdc-history-crosscheck.mjs --out <dir> [--n 12] [--rpc a,b]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg("--out");

// FULL mode: `--compare <verifyDir>` checks a complete independent recount
// (usdc-history-scan.mjs --verify-against <out>) unit by unit: every exact
// field and the HLL sketch bytes must be identical.
if (arg("--compare")) {
  const load = (d) => new Map(readFileSync(join(d, "units.jsonl"), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { const u = JSON.parse(l); return u.v === 2 ? [[u.from, u]] : []; } catch { return []; } }));
  const A = load(OUT), B = load(arg("--compare"));
  const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8"));
  const planB = JSON.parse(readFileSync(join(arg("--compare"), "plan.json"), "utf8"));
  if (plan.toBlock !== planB.toBlock || plan.toBlockHash !== planB.toBlockHash || plan.deploymentBlock !== planB.deploymentBlock) {
    console.log("boundary mismatch", plan, planB);
    process.exit(1);
  }
  const fields = ["to", "logs", "txs", "maxPerTx", "maxTx", "mints", "mintRaw", "burns", "burnRaw", "regular", "regularRaw", "zeroValue", "duplicatesSkipped"];
  const deep = (u) => JSON.stringify([u.largest?.raw, u.smallestNonZero?.raw, u.firstLog, u.lastLog, u.hist]);
  let compared = 0, independent = 0, mismatches = 0, events = 0;
  const missing = [];
  for (const [f, a] of A) {
    const b = B.get(f);
    if (!b) { missing.push(f); continue; }
    compared++;
    events += a.logs;
    if (b.independentOfOriginal) independent++;
    const diff = fields.filter((k) => k !== "duplicatesSkipped" && String(a[k]) !== String(b[k]));
    if (deep(a) !== deep(b)) diff.push("extremes/histogram");
    const sa = join(OUT, "sketches", `${f}.bin`), sb = join(arg("--compare"), "sketches", `${f}.bin`);
    if (existsSync(sa) && existsSync(sb) && !readFileSync(sa).equals(readFileSync(sb))) diff.push("hll-sketch");
    if (diff.length) { mismatches++; console.log(`MISMATCH unit ${f}: ${diff.map((k) => `${k} ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`).join("; ")}`); }
  }
  console.log(JSON.stringify({ unitsInCensus: A.size, unitsCompared: compared, unitsMissingFromVerify: missing.length, unitsVerifiedOnDisjointProviders: independent, eventsCovered: events, mismatchingUnits: mismatches }, null, 2));
  process.exit(mismatches || missing.length ? 1 : 0);
}
const N = Number(arg("--n", "12"));
const RPCS = arg("--rpc", "https://rpc.mevblocker.io,https://mainnet.gateway.tenderly.co").split(",");
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const Z = "0x" + "0".repeat(64);
const hex = (n) => "0x" + n.toString(16);

async function getLogs(u, a, b) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: USDC, topics: [TOPIC], fromBlock: hex(a), toBlock: hex(b) }] }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (/range|limit|exceed|too many|size/i.test(e.message) && b > a) {
        const m = Math.floor((a + b) / 2);
        return [...(await getLogs(u, a, m)), ...(await getLogs(u, m + 1, b))];
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error(`${u} failed ${a}..${b}`);
}
async function count(u, from, to) {
  const c = { logs: 0, txs: new Set(), mints: 0, mintRaw: 0n, burns: 0, burnRaw: 0n, regular: 0, regularRaw: 0n };
  const seen = new Set();
  for (let a = from; a <= to; a += 2000) {
    for (const l of await getLogs(u, a, Math.min(to, a + 1999))) {
      const id = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      c.logs++;
      c.txs.add(l.transactionHash);
      const raw = BigInt(l.data === "0x" ? 0 : l.data);
      if (l.topics[1] === Z) (c.mints++, (c.mintRaw += raw));
      else if (l.topics[2] === Z) (c.burns++, (c.burnRaw += raw));
      else (c.regular++, (c.regularRaw += raw));
    }
  }
  return { logs: c.logs, txs: c.txs.size, mints: c.mints, mintRaw: String(c.mintRaw), burns: c.burns, burnRaw: String(c.burnRaw), regular: c.regular, regularRaw: String(c.regularRaw) };
}
const units = readFileSync(join(OUT, "units.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((u) => u.logs > 0);
// Deterministic sample spread over history (every k-th non-empty unit, by block).
units.sort((a, b) => a.from - b.from);
const step = Math.max(1, Math.floor(units.length / N));
const sample = units.filter((_, i) => i % step === 0).slice(0, N);
let bad = 0;
for (const u of sample) {
  const keys = ["logs", "txs", "mints", "mintRaw", "burns", "burnRaw", "regular", "regularRaw"];
  const line = [`${u.from}..${u.to} stored logs=${u.logs}`];
  for (const p of RPCS) {
    const c = await count(p, u.from, u.to);
    const diff = keys.filter((k) => String(c[k]) !== String(u[k]));
    if (diff.length) bad++;
    line.push(`${new URL(p).host}: ${diff.length ? "MISMATCH " + diff.map((k) => `${k} ${c[k]}≠${u[k]}`).join(", ") : "match"}`);
  }
  console.log(line.join(" | "));
}
console.log(bad ? `${bad} mismatching provider-unit checks` : `all ${sample.length} sampled units match on every provider`);
