// Tests for fund-flow tracking, against a real two-hop chain and against the
// double-counting mistake the whole module exists to prevent.
//
// Runs on a temporary database so it never touches data/chaintracker.db.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tmp = mkdtempSync(join(tmpdir(), "ct-flows-"));
process.env.DATABASE_URL = join(tmp, "test.db");

const { getDb, closeDb } = await import("../../db/index.js");
const { indexAddresses, attach, findPredecessors, recompute, flowRisk, flowTxs, sweep } =
  await import("./flows.js");
const { extractFeatures } = await import("./features.js");
type RawTx = import("./features.js").RawTx;

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(HERE, "fixtures", "liquid-2026-09-06.json"), "utf8"),
) as { liquidDrain: RawTx; liquidReturn: RawTx };

const HOP = "bc1qgslsydz56d0ed6827hdemfmk5w2f6ldyc6wt7p";

before(() => { getDb(); });
after(() => {
  closeDb();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file locks */ }
});

/** A transaction spending an output of `parent` paid to `addr`. */
function child(txid: string, addr: string, valueSats: number, outs: string[]): RawTx {
  return {
    txid,
    vin: [{ txid: "p".repeat(64), sequence: 0xffffffff, prevout: { value: valueSats, scriptpubkey_address: addr } }],
    vout: outs.map((a) => ({ value: Math.floor(valueSats / outs.length), scriptpubkey_address: a })),
    fee: 5000,
    weight: 2000,
  };
}

test("a transaction with no predecessor starts a new flow at hop 1", () => {
  const t0 = Date.UTC(2026, 8, 6, 14, 28, 56);
  indexAddresses(fixture.liquidDrain, t0);
  const r = attach(fixture.liquidDrain, 4019_44000000, t0);
  assert.equal(r.isNew, true);
  assert.equal(r.hop, 1);
  assert.equal(r.flow.hops, 1);
});

test("spending that transaction's output extends the SAME flow to hop 2", () => {
  // The real shape: the drain paid 3,996.02 BTC to a hop address, which
  // forwarded all of it. Verified on chain — that address received 3,996.02,
  // sent 3,996.02, and holds nothing.
  const t1 = Date.UTC(2026, 8, 6, 14, 40, 0);
  const forward = child("a1".repeat(32), HOP, 3996_02000000, ["bc1qdest1"]);
  indexAddresses(forward, t1);
  const r = attach(forward, 3996_02000000, t1);
  assert.equal(r.isNew, false, "it must join the existing flow, not start a second one");
  assert.equal(r.hop, 2);
  assert.equal(r.flow.hops, 2);
  assert.equal(r.flow.txCount, 2);
});

test("the flow's total is the ROOT hop, not the sum of every hop", () => {
  // This is the bug the module exists to prevent: summing hops would report
  // 4,019 + 3,996 = 8,015 BTC for money that moved once.
  const f = recompute(flowTxs(attachedFlowId())[0] ? attachedFlowId() : attachedFlowId())!;
  assert.equal(Math.round(f.totalSats / 1e8), 4019);
  assert.notEqual(Math.round(f.totalSats / 1e8), 8015);
});

/** The single flow created by the tests above. */
function attachedFlowId(): string {
  const row = getDb().prepare("SELECT id FROM btc_flows ORDER BY started_at LIMIT 1").get() as { id: string };
  return row.id;
}

test("velocity is null for a flow with no elapsed time", () => {
  const ts = Date.UTC(2026, 8, 7, 0, 0, 0);
  const solo = child("b2".repeat(32), "bc1qlonely", 100e8, ["bc1qelsewhere"]);
  indexAddresses(solo, ts);
  const r = attach(solo, 100e8, ts);
  assert.equal(r.flow.velocity, null, "one transaction has no duration to divide by");
});

test("predecessors are matched by direction, not merely by shared address", () => {
  // A transaction that PAYS an address must not be treated as descending from
  // a later transaction that also pays it. Only output-then-input counts.
  const ts = Date.UTC(2026, 8, 7, 1, 0, 0);
  const payer: RawTx = {
    txid: "c3".repeat(32),
    vin: [{ txid: "z".repeat(64), sequence: 0xffffffff, prevout: { value: 50e8, scriptpubkey_address: "bc1qsomeone" } }],
    vout: [{ value: 49e8, scriptpubkey_address: "bc1qshared" }],
    fee: 1000, weight: 800,
  };
  indexAddresses(payer, ts);
  const alsoPays: RawTx = {
    txid: "d4".repeat(32),
    vin: [{ txid: "y".repeat(64), sequence: 0xffffffff, prevout: { value: 20e8, scriptpubkey_address: "bc1qother" } }],
    vout: [{ value: 19e8, scriptpubkey_address: "bc1qshared" }],
    fee: 1000, weight: 800,
  };
  const preds = findPredecessors(alsoPays, ts + 60_000);
  assert.equal(preds.length, 0, "two transactions paying the same address are not a chain");
});

test("a spend of that address IS a predecessor", () => {
  const ts = Date.UTC(2026, 8, 7, 2, 0, 0);
  const spender = child("e5".repeat(32), "bc1qshared", 49e8, ["bc1qonward"]);
  const preds = findPredecessors(spender, ts);
  assert.ok(preds.some((p) => p.txid === "c3".repeat(32)), "spending an output must link back to it");
});

test("outside the window nothing is linked", () => {
  const ts = Date.UTC(2026, 8, 7, 2, 0, 0);
  const spender = child("f6".repeat(32), "bc1qshared", 49e8, ["bc1qonward"]);
  const preds = findPredecessors(spender, ts, 1000);
  assert.equal(preds.length, 0, "a window of one second must link nothing hours later");
});

test("risk rises with hops, fan-out and speed, not with size alone", () => {
  const base = { hops: 1, txCount: 1, totalSats: 500e8, destinations: 1, velocity: null };
  const slow = flowRisk(base);
  const deep = flowRisk({ ...base, hops: 4, txCount: 4 });
  const wide = flowRisk({ ...base, destinations: 30 });
  const fast = flowRisk({ ...base, velocity: 20e8 });
  assert.ok(deep > slow, "more hops must raise risk");
  assert.ok(wide > slow, "more destinations must raise risk");
  assert.ok(fast > slow, "higher velocity must raise risk");
  assert.ok(flowRisk({ hops: 5, txCount: 9, totalSats: 4000e8, destinations: 40, velocity: 50e8 }) > 85);
});

test("risk is bounded to 0..100", () => {
  const extreme = flowRisk({ hops: 999, txCount: 999, totalSats: 1e15, destinations: 1e6, velocity: 1e12 });
  assert.ok(extreme <= 100, `risk was ${extreme}`);
  const nothing = flowRisk({ hops: 1, txCount: 1, totalSats: 0, destinations: 0, velocity: null });
  assert.ok(nothing >= 0);
});

test("sweep closes idle flows without deleting them", () => {
  const before = getDb().prepare("SELECT COUNT(*) n FROM btc_flows").get() as { n: number };
  sweep(Date.UTC(2026, 8, 20));
  const after = getDb().prepare("SELECT COUNT(*) n FROM btc_flows").get() as { n: number };
  assert.equal(after.n, before.n, "closing a flow must not discard its history");
  const open = getDb().prepare("SELECT COUNT(*) n FROM btc_flows WHERE status='open'").get() as { n: number };
  assert.equal(open.n, 0);
});

test("features and flows agree on the drain's value", () => {
  const f = extractFeatures(fixture.liquidDrain);
  assert.equal(Math.round(f.valueSats / 1e8), 4019);
});
