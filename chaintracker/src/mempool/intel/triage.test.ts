// Tests for staged triage.
//
// The suite's centrepiece is the scale-invariance block at the bottom: the same
// suspicious behaviour at 0.01, 0.1, 1, 10, 100 and 1,000 BTC must reach the
// engine at every size. That property was FALSE before this module existed —
// ingestion discarded anything under 50 BTC — and it is the single claim most
// worth defending with a test, because losing it silently turns the whole
// behavioural engine back into a whale bot.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cheapFeatures, stage1, triage, addressesOf, newTriageStats, recordTriage,
  DEFAULT_TRIAGE, type TriageTx, type TriageBaselines,
} from "./triage.js";
import { buildBaseline } from "./stats.js";

/* Baselines shaped like the real block walked on 2026-09-08: 3,983
 * transactions, median value 0.00662 BTC, median fee rate 3.00 sat/vB,
 * median 1 input and 2 outputs. */
const values = [
  ...Array.from({ length: 3200 }, (_, i) => 50_000 + (i % 900) * 1_400),
  ...Array.from({ length: 600 }, (_, i) => 3e6 + i * 60_000),
  ...Array.from({ length: 150 }, (_, i) => 2e8 + i * 4e7),
  ...Array.from({ length: 33 }, (_, i) => 50e8 + i * 3e8),
];
const base: TriageBaselines = {
  value: buildBaseline("value", values),
  feeRate: buildBaseline("feeRate", Array.from({ length: 3983 }, (_, i) => 1 + (i % 30) * 0.35)),
  nIn: buildBaseline("nIn", Array.from({ length: 3983 }, (_, i) => (i % 100 < 92 ? 1 + (i % 3) : 4 + (i % 14)))),
  nOut: buildBaseline("nOut", Array.from({ length: 3983 }, (_, i) => (i % 100 < 90 ? 2 : 3 + (i % 25)))),
  sortedValues: values.slice().sort((a, b) => a - b),
};

/** An ordinary payment: one input, a payee and change, market fee. */
function ordinary(txid: string, valueSats: number, from = "bc1qanon"): TriageTx {
  return {
    txid,
    vin: [{ sequence: 0xffffffff, prevout: { value: Math.round(valueSats * 1.01), scriptpubkey_address: from } }],
    vout: [
      { value: Math.round(valueSats * 0.7), scriptpubkey_address: "bc1qpayee" },
      { value: Math.round(valueSats * 0.3), scriptpubkey_address: from },
    ],
    fee: 2_250, weight: 3000, // 750 vB at 3 sat/vB — the chain median
  };
}

/* ------------------------------------------------------------------ */
/* Stage 0                                                             */
/* ------------------------------------------------------------------ */

test("cheap features need no database and no network", () => {
  const c = cheapFeatures(ordinary("t1", 1e8));
  assert.equal(c.nIn, 1);
  assert.equal(c.nOut, 2);
  assert.equal(c.topInputAddr, "bc1qanon");
  assert.ok(c.feeRate !== null && Math.abs(c.feeRate - 3) < 0.01);
  assert.deepEqual(c.outputAddrs.sort(), ["bc1qanon", "bc1qpayee"]);
});

test("the coinbase is never admitted", () => {
  // Present in every block, pays no fee, transfers nothing. Admitting it would
  // spend a Stage-2 slot 144 times a day for no information.
  const cb: TriageTx = {
    txid: "cb", vin: [{ is_coinbase: true, prevout: null }],
    vout: [{ value: 312_500_000, scriptpubkey_address: "bc1qminer" }],
    fee: 0, weight: 1000,
  };
  const r = triage(cb, base);
  assert.equal(r.stage, 0);
  assert.equal(r.cheap.isCoinbase, true);
});

test("ordinary traffic stays at stage 0", () => {
  // Median-sized, median fee, ordinary shape, unknown address. If this were
  // admitted the ladder would be pointless.
  const r = triage(ordinary("t2", 6_600_000), base);
  assert.equal(r.stage, 0, `admitted for: ${r.reasons.join("; ")}`);
});

/* ------------------------------------------------------------------ */
/* Stage 1 gates — none of them absolute                               */
/* ------------------------------------------------------------------ */

test("size admits by PERCENTILE, not by a fixed number of BTC", () => {
  const big = triage(ordinary("t3", 200e8), base);
  assert.equal(big.stage, 1);
  assert.ok(big.reasons.some((r) => /percentile/.test(r)), big.reasons.join("; "));
});

test("the same value is admitted or not depending on the population", () => {
  // 1 BTC against a chain whose median is 0.0066 BTC is remarkable. Against a
  // chain where 1 BTC is typical, it is not. A fixed threshold cannot express
  // that; a percentile does it for free.
  const busyChain: TriageBaselines = {
    ...base,
    sortedValues: Array.from({ length: 2000 }, (_, i) => 200e8 + i * 1e8).sort((a, b) => a - b),
  };
  // 100 BTC sits above the 99th percentile of the measured chain (whose p99 was
  // 96 BTC on block 966017) but is ordinary where the median is 25 BTC.
  //
  // Note what the diagnostic for this test revealed: 1 BTC is only the ~95th
  // percentile of real Bitcoin traffic, so a 1 BTC transaction from an unknown
  // address is NOT admitted on size. It gets in through the known-address gate
  // instead, which is exactly the division of labour intended — size is a weak
  // signal and history is a strong one.
  const tx = ordinary("t4", 100e8);
  assert.equal(triage(tx, base).stage, 1, "100 BTC is tail traffic on the real chain");
  assert.equal(
    triage(tx, busyChain).stage, 0,
    "the same 100 BTC is unremarkable where the median is far higher",
  );
});

test("structure admits regardless of value", () => {
  // 40 inputs into 1 output, moving a tenth of a bitcoin. No value gate would
  // ever have let this through.
  const consolidation: TriageTx = {
    txid: "t5",
    vin: Array.from({ length: 40 }, (_, i) => ({
      sequence: 0xffffffff, prevout: { value: 250_000, scriptpubkey_address: `bc1qutxo${i}` },
    })),
    vout: [{ value: 9_900_000, scriptpubkey_address: "bc1qgather" }],
    fee: 20_000, weight: 24_000,
  };
  const r = triage(consolidation, base);
  assert.equal(r.stage, 1);
  assert.ok(r.cheap.valueSats < 1e8, "under 0.1 BTC and still admitted");
  assert.ok(r.reasons.some((x) => /inputs/.test(x)), r.reasons.join("; "));
});

test("a known address admits at ANY value", () => {
  // The gate that makes small transactions visible. A dust-sized movement from
  // an address with recorded history is analysable; a large one from a total
  // stranger may not be.
  const tiny = ordinary("t6", 500_000, "bc1qhistoric"); // 0.005 BTC
  const without = triage(tiny, base);
  const withKnown = triage(tiny, base, DEFAULT_TRIAGE, (a) => a === "bc1qhistoric");
  assert.equal(without.stage, 0);
  assert.equal(withKnown.stage, 1);
  assert.ok(withKnown.reasons.some((r) => /recorded history/.test(r)));
});

test("a sweep with no change is admitted on shape alone", () => {
  const sweep: TriageTx = {
    txid: "t7",
    vin: Array.from({ length: 4 }, (_, i) => ({
      sequence: 0xffffffff, prevout: { value: 300_000, scriptpubkey_address: `bc1qs${i}` },
    })),
    vout: [{ value: 1_180_000, scriptpubkey_address: "bc1qdest" }],
    fee: 20_000, weight: 4000,
  };
  const r = triage(sweep, base);
  assert.equal(r.stage, 1);
  assert.ok(r.reasons.some((x) => /swept|no change/.test(x)), r.reasons.join("; "));
});

test("a SINGLE dust output does not admit on its own", () => {
  // Measured on real block 966049: 1,997 of 6,402 transactions carried one dust
  // output. That is a base rate, not an anomaly — inscriptions, batching and
  // ordinary change all produce it. Admitting on it took 31% of the block.
  const dusty: TriageTx = {
    txid: "t8",
    vin: [{ sequence: 0xffffffff, prevout: { value: 100_000, scriptpubkey_address: "bc1qa" } }],
    vout: [{ value: 400, scriptpubkey_address: "bc1qb" }, { value: 97_000, scriptpubkey_address: "bc1qa" }],
    fee: 2600, weight: 1000,
  };
  assert.equal(triage(dusty, base).stage, 0);
});

test("SEVERAL dust outputs do admit, at any size", () => {
  // The count is what carries information. One is routine; a handful is a shape.
  const dusty: TriageTx = {
    txid: "t8b",
    vin: [{ sequence: 0xffffffff, prevout: { value: 100_000, scriptpubkey_address: "bc1qa" } }],
    vout: [
      { value: 400, scriptpubkey_address: "bc1qb" },
      { value: 410, scriptpubkey_address: "bc1qc" },
      { value: 420, scriptpubkey_address: "bc1qd" },
      { value: 95_000, scriptpubkey_address: "bc1qa" },
    ],
    fee: 2600, weight: 1000,
  };
  const r = triage(dusty, base);
  assert.equal(r.stage, 1);
  assert.ok(r.cheap.valueSats < 1e6, "under 0.01 BTC and still admitted");
});

test("two weak signals together admit where one alone does not", () => {
  // The evidentiary rule the strong/weak split encodes: one unremarkable
  // observation is not a finding, two co-occurring ones may be.
  const oneWeak: TriageTx = {
    txid: "t8c",
    vin: [{ sequence: 0xffffffff, prevout: { value: 100_000, scriptpubkey_address: "bc1qa" } }],
    vout: [{ value: 400, scriptpubkey_address: "bc1qb" }, { value: 97_000, scriptpubkey_address: "bc1qa" }],
    fee: 2600, weight: 1000,
  };
  assert.equal(triage(oneWeak, base).stage, 0);

  // Same transaction, now also paying a fee in the chain's lower tail. The fee
  // gate needs the sorted sample, since a tight fee distribution cannot be
  // judged from a p95 value alone.
  const withFeeSample: TriageBaselines = {
    ...base,
    sortedFeeRate: Array.from({ length: 3983 }, (_, i) => 1 + (i % 30) * 0.35).sort((a, b) => a - b),
  };
  const twoWeak: TriageTx = { ...oneWeak, txid: "t8d", fee: 150, weight: 3000 };
  const r = triage(twoWeak, withFeeSample);
  assert.equal(r.stage, 1);
  assert.ok(r.reasons.length >= 2, r.reasons.join("; "));
});

test("a fee-rate extreme alone is not enough — it is a distribution tail", () => {
  // Measured: 637 fee-rate extremes in one 6,402-transaction block. Fat tails
  // are a property of the fee market, not evidence about a transaction.
  const overpay: TriageTx = { ...ordinary("t9", 5e6), fee: 200_000, weight: 3000 };
  assert.equal(triage(overpay, base).stage, 0);

  // But paired with a structural signal it admits.
  const overpayAndSweep: TriageTx = {
    txid: "t9b",
    vin: Array.from({ length: 4 }, (_, i) => ({
      sequence: 0xffffffff, prevout: { value: 1_500_000, scriptpubkey_address: `bc1qi${i}` },
    })),
    vout: [{ value: 5_800_000, scriptpubkey_address: "bc1qdest" }],
    fee: 200_000, weight: 3000,
  };
  assert.equal(triage(overpayAndSweep, base).stage, 1);
});

test("RBF alone is far too common to admit", () => {
  // Most of the chain signals replaceability. Admitting on it would put the
  // majority of traffic through Stage 2 and defeat the ladder.
  const rbf: TriageTx = {
    txid: "t11",
    vin: [{ sequence: 0xfffffffd, prevout: { value: 6_700_000, scriptpubkey_address: "bc1qa" } }],
    vout: [
      { value: 4_000_000, scriptpubkey_address: "bc1qb" },
      { value: 2_690_000, scriptpubkey_address: "bc1qa" },
    ],
    fee: 2250, weight: 3000,
  };
  const r = triage(rbf, base);
  assert.equal(r.cheap.rbfSignalled, 1);
  assert.equal(r.stage, 0, `admitted for: ${r.reasons.join("; ")}`);
});

test("triage works with no baselines at all", () => {
  // Cold start. Percentile gates cannot fire, but structural ones still can, so
  // the system is not blind before it has learned anything.
  const consolidation: TriageTx = {
    txid: "t12",
    vin: Array.from({ length: 6 }, () => ({ sequence: 0xffffffff, prevout: { value: 1e6, scriptpubkey_address: "bc1qx" } })),
    vout: [{ value: 5_900_000, scriptpubkey_address: "bc1qy" }],
    fee: 10_000, weight: 4000,
  };
  const r = triage(consolidation, {});
  assert.equal(r.stage, 1, "structural gates must work without a learned baseline");
});

/* ------------------------------------------------------------------ */
/* Bookkeeping                                                         */
/* ------------------------------------------------------------------ */

test("addressesOf collects the batch-lookup key set without duplicates", () => {
  const c = cheapFeatures(ordinary("t13", 1e8, "bc1qsame"));
  const addrs = addressesOf(c);
  assert.equal(new Set(addrs).size, addrs.length);
  assert.ok(addrs.includes("bc1qsame"));
});

test("triage stats bucket reasons without exploding on distinct numbers", () => {
  const stats = newTriageStats();
  for (let i = 0; i < 20; i++) {
    recordTriage(stats, triage(ordinary(`s${i}`, 200e8 + i * 1e8), base));
  }
  assert.equal(stats.seen, 20);
  assert.equal(stats.stage1, 20);
  // Twenty different percentiles must collapse into one reason bucket.
  assert.ok(Object.keys(stats.byReason).length <= 3, JSON.stringify(stats.byReason));
});

/* ================================================================== */
/* THE REGRESSION THAT MATTERS                                        */
/* ================================================================== */

test("the SAME suspicious behaviour is admitted at every scale", () => {
  // 0.01 BTC to 1,000 BTC — five orders of magnitude. The old ingestion path
  // admitted exactly the top two of these six and discarded the rest before any
  // analysis ran.
  const scales = [
    { label: "0.01 BTC", sats: 1_000_000 },
    { label: "0.1 BTC", sats: 10_000_000 },
    { label: "1 BTC", sats: 100_000_000 },
    { label: "10 BTC", sats: 1_000_000_000 },
    { label: "100 BTC", sats: 10_000_000_000 },
    { label: "1000 BTC", sats: 100_000_000_000 },
  ];

  for (const { label, sats } of scales) {
    // A consolidation sweep: 12 inputs, one output, no change. Identical shape
    // at every scale; only the amounts differ.
    const tx: TriageTx = {
      txid: `scale-${label}`,
      vin: Array.from({ length: 12 }, (_, i) => ({
        sequence: 0xffffffff,
        prevout: { value: Math.round(sats / 12), scriptpubkey_address: `bc1qin${i}` },
      })),
      vout: [{ value: Math.round(sats * 0.998), scriptpubkey_address: "bc1qexit" }],
      fee: 5000, weight: 8000,
    };
    const r = triage(tx, base);
    assert.equal(
      r.stage, 1,
      `${label} was NOT admitted — the value gate has returned. Reasons: ${r.reasons.join("; ") || "none"}`,
    );
  }
});

test("scale-invariance holds for a dormancy-shaped movement too", () => {
  // A single input emptying an address into one unseen destination. Nothing
  // structurally extreme; it is admitted because the address is known, which is
  // the only gate that works at 0.01 BTC.
  const known = (a: string) => a === "bc1qsleeper";
  for (const sats of [1_000_000, 100_000_000, 100_000_000_000]) {
    const tx: TriageTx = {
      txid: `dormant-${sats}`,
      vin: [{ sequence: 0xffffffff, prevout: { value: sats, scriptpubkey_address: "bc1qsleeper" } }],
      vout: [{ value: Math.round(sats * 0.999), scriptpubkey_address: "bc1qnewdest" }],
      fee: 1000, weight: 800,
    };
    assert.equal(
      triage(tx, base, DEFAULT_TRIAGE, known).stage, 1,
      `${sats} sats from a known address must be analysed`,
    );
  }
});

test("admitting everything is not the answer either", () => {
  // The ladder is only useful if it rejects. A block of ordinary traffic must
  // leave the great majority at Stage 0, or Stage 2 costs as much as no triage
  // at all.
  const stats = newTriageStats();
  for (let i = 0; i < 1000; i++) {
    // Sampled ACROSS the whole distribution. An earlier draft walked
    // values[0..999], which are all from its small-value head, so nothing was
    // admitted and the test measured its own sampling rather than the ladder.
    const v = values[Math.floor((i / 1000) * values.length)]!;
    recordTriage(stats, triage(ordinary(`bulk-${i}`, v), base));
  }
  const admitted = stats.stage1 / stats.seen;
  assert.ok(admitted < 0.15, `${(admitted * 100).toFixed(1)}% admitted — the ladder is not filtering`);
  assert.ok(admitted > 0, "admitting nothing would be equally useless");
});
