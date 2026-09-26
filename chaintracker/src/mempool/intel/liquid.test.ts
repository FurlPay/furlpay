// Replay of the Liquid Network peg-out, 2026-09-06.
//
// This is the reference case for the whole intelligence layer, and it is real:
// the fixture was fetched from chain, not written by hand. What happened, per
// public reporting and confirmed against the transaction itself:
//
//   A bug in Elements' peg-out logic let an unbacked L-BTC mint be pegged out
//   against the federation's real Bitcoin reserve. 3,996 BTC — about 95% of
//   every bitcoin ever pegged into Liquid — left in 23 minutes. About $317M.
//
// The transaction as it appears on chain:
//
//   txid    8db751a650ae2f12006b7e8c69a75e4df360e8afd6b9e05ae0b9fa6458a7b140
//   value   4,019.44 BTC
//   shape   83 inputs -> 13 outputs, ALL 83 spending one address
//   fee     34,097 sats over 33,576 vbytes = 1.02 sat/vB
//   block   965783, 2026-09-06 14:28:56 UTC
//
// What this test asserts is NOT that the engine could have predicted a hack.
// It could not: a mempool observer sees transactions that have already been
// broadcast. What it asserts is that when this transaction appeared, the
// engine would have ranked it above ordinary whale traffic and marked it
// CRITICAL — which is roughly 24 hours before it was catalogued publicly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractFeatures, type RawTx } from "./features.js";
import { classify } from "./classify.js";
import { scoreTx, type ScoreContext } from "./score.js";
import { buildBaseline } from "./stats.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(HERE, "fixtures", "liquid-2026-09-06.json"), "utf8"),
) as { liquidDrain: RawTx; liquidReturn: RawTx };

const FEDERATION = "bc1qdlld6antmv4xug242ed83q7k4rqw50cwfns38szx4qu2f4jwaxxsuhwxxr";

/** An ordinary large transfer, for comparison — 2 in, 2 out, market fee rate. */
const ordinaryWhale: RawTx = {
  txid: "f".repeat(64),
  vin: [
    { txid: "a".repeat(64), sequence: 0xffffffff, prevout: { value: 60e8, scriptpubkey_address: "bc1qa" } },
    { txid: "b".repeat(64), sequence: 0xffffffff, prevout: { value: 40e8, scriptpubkey_address: "bc1qb" } },
  ],
  vout: [
    { value: 99e8, scriptpubkey_address: "bc1qc" },
    { value: 0.98e8, scriptpubkey_address: "bc1qa" },
  ],
  fee: 12_000,
  weight: 1000,
  status: { confirmed: true, block_height: 966016, block_time: 1788839547 },
};

// A population that looks like a real block: mostly small, a few large.
const population = [
  ...Array.from({ length: 400 }, (_, i) => 20_000 + i * 900),
  ...Array.from({ length: 60 }, (_, i) => 5e6 + i * 1e6),
  ...Array.from({ length: 12 }, (_, i) => 50e8 + i * 10e8),
];
const valueBaseline = buildBaseline("value", population);
const recentValuesSats = population.slice().sort((a, b) => a - b);

const feeRates = Array.from({ length: 300 }, (_, i) => 1 + (i % 40) * 0.5);
const feeRateBaseline = buildBaseline("feeRate", feeRates);

function analyse(tx: RawTx, ctx: ScoreContext = {}) {
  const f = extractFeatures(tx, undefined, Date.UTC(2026, 8, 6, 15, 0, 0));
  const c = classify(f);
  return { f, c, s: scoreTx(f, c, { valueBaseline, feeRateBaseline, recentValuesSats, ...ctx }) };
}

/* ------------------------------------------------------------------ */

test("the fixture is the real transaction, unmodified", () => {
  const tx = fixture.liquidDrain;
  assert.equal(tx.txid, "8db751a650ae2f12006b7e8c69a75e4df360e8afd6b9e05ae0b9fa6458a7b140");
  assert.equal(tx.vin.length, 83);
  assert.equal(tx.vout.length, 13);
  assert.equal(tx.fee, 34_097);
  assert.equal(tx.status?.block_height, 965783);
});

test("features reproduce the on-chain figures", () => {
  const { f } = analyse(fixture.liquidDrain);
  assert.equal(Math.round(f.valueSats / 1e8), 4019);
  assert.equal(f.nIn, 83);
  assert.equal(f.nOut, 13);
  // 34,097 sats over 33,576 vbytes.
  assert.ok(f.feeRate !== null && f.feeRate > 1.0 && f.feeRate < 1.05, `fee rate was ${f.feeRate}`);
  // Every input came from the federation address.
  assert.equal(f.inputAddresses, 1);
  assert.equal(f.topInputAddr, FEDERATION);
  assert.ok(f.topInputAddrFrac !== null && f.topInputAddrFrac > 0.99);
});

test("the value-to-fee ratio is the standout signal", () => {
  const { f } = analyse(fixture.liquidDrain);
  // 4.019e11 sats of value for 34,097 sats of fee.
  assert.ok(f.valuePerFeeSat !== null && f.valuePerFeeSat > 1e7, `ratio was ${f.valuePerFeeSat}`);
  const ordinary = analyse(ordinaryWhale).f;
  assert.ok(
    f.valuePerFeeSat! > ordinary.valuePerFeeSat! * 10,
    "moving 40x the value for 3x the fee must register as far more anomalous",
  );
});

test("it is classified as a consolidation, not a transfer", () => {
  const { c } = analyse(fixture.liquidDrain);
  assert.equal(c.shape, "consolidation");
  assert.ok(c.confidence > 0.7, `confidence was ${c.confidence}`);
  assert.ok(
    c.evidence.some((e) => /one address/.test(e)),
    "the single funding address is the key structural fact and must be cited",
  );
});

test("it outranks an ordinary 99 BTC whale by a wide margin", () => {
  const liquid = analyse(fixture.liquidDrain).s;
  const ordinary = analyse(ordinaryWhale).s;
  assert.ok(
    liquid.score > ordinary.score * 1.5,
    `liquid ${liquid.score} vs ordinary ${ordinary.score} — not a wide enough separation`,
  );
});

test("with the federation on the reserve watchlist it is CRITICAL", () => {
  // 3,996 of ~4,200 BTC, which is the number that matters: not the size of the
  // transaction but the share of the reserve it removed.
  const { s } = analyse(fixture.liquidDrain, {
    reserve: { label: "Liquid Federation", fractionOfBalance: 3996 / 4200, balanceBefore: 4200e8 },
  });
  assert.equal(s.severity, "CRITICAL");
  assert.ok(s.score >= 70, `score was ${s.score}`);
  assert.ok(
    s.reasons.some((r) => /drains \d+% of Liquid Federation/.test(r)),
    `reasons did not name the drain: ${JSON.stringify(s.reasons)}`,
  );
});

test("the score decomposes — every point is attributable", () => {
  const { s } = analyse(fixture.liquidDrain, {
    reserve: { label: "Liquid Federation", fractionOfBalance: 0.95, balanceBefore: 4200e8 },
  });
  const sum = s.contributions.reduce((a, x) => a + x.points, 0);
  // The raw points are exactly the contributions; the published score is that
  // total normalised over the weight that could actually be evaluated.
  assert.ok(Math.abs(sum - s.rawPoints) < 0.05, `contributions sum to ${sum} but rawPoints is ${s.rawPoints}`);
  assert.ok(
    Math.abs(s.score - (s.rawPoints / (s.coverage * 100)) * 100) < 0.2,
    `score ${s.score} is not rawPoints ${s.rawPoints} over coverage ${s.coverage}`,
  );
  for (const x of s.contributions) {
    assert.ok(x.detail.length > 0, `${x.key} contributed points with no explanation`);
    assert.ok(x.points >= 0, `${x.key} contributed negative points`);
  }
});

test("an unmeasurable component is excluded from the denominator, not scored zero", () => {
  // Coin age is unresolved for the fixture, so its 16 points of weight leave
  // the denominator. Otherwise a whale whose age lookup failed would rank
  // below an identical one whose lookup happened to succeed.
  const { s } = analyse(fixture.liquidDrain);
  assert.ok(s.coverage < 1, `coverage was ${s.coverage} — unmeasured weight was not removed`);
  assert.ok(s.score > s.rawPoints, "normalising must raise the score above the raw points here");
});

test("a reserve drain sets severity regardless of the rest of the score", () => {
  // A small, boring transaction that happens to empty a watched reserve must
  // still be CRITICAL — the categorical finding outranks the arithmetic.
  const small: RawTx = {
    txid: "c".repeat(64),
    vin: [{ txid: "d".repeat(64), sequence: 0xffffffff, prevout: { value: 2e8, scriptpubkey_address: FEDERATION } }],
    vout: [{ value: 1.99e8, scriptpubkey_address: "bc1qattacker" }],
    fee: 1000,
    weight: 800,
  };
  const { s } = analyse(small, {
    reserve: { label: "Some Custodian", fractionOfBalance: 0.99, balanceBefore: 2e8 },
  });
  assert.equal(s.severity, "CRITICAL");
});

test("a flagged address is CRITICAL on its own", () => {
  const { s } = analyse(ordinaryWhale, {
    flagged: { list: "the OFAC sanctioned address list", address: "bc1qa" },
  });
  assert.equal(s.severity, "CRITICAL");
});

test("coin age contributes nothing when it could not be measured", () => {
  // The fixture has no age lookup wired, so dormancy must score zero and SAY
  // it was not measured — never quietly assume the coins were fresh.
  const { s } = analyse(fixture.liquidDrain);
  const dormancy = s.contributions.find((x) => x.key === "dormancy");
  assert.ok(dormancy, "dormancy must appear even at zero, so its absence is visible");
  assert.equal(dormancy.points, 0);
  assert.match(dormancy.detail, /not measured|not scored/);
});

test("coin age scores when it IS measured", () => {
  const nowMs = Date.UTC(2026, 8, 6, 15, 0, 0);
  const sevenYearsAgo = nowMs / 1000 - 7 * 365 * 86_400;
  const aged = extractFeatures(
    fixture.liquidDrain,
    () => ({ blockTime: sevenYearsAgo }),
    nowMs,
  );
  assert.ok(aged.meanAgeDays !== null && aged.meanAgeDays > 2500, `mean age ${aged.meanAgeDays}`);
  assert.equal(aged.dormantFrac, 1);
  const s = scoreTx(aged, classify(aged), { valueBaseline, feeRateBaseline, recentValuesSats });
  const dormancy = s.contributions.find((x) => x.key === "dormancy")!;
  assert.ok(dormancy.points > 10, `dormancy scored only ${dormancy.points}`);
  assert.ok(s.reasons.some((r) => /years old/.test(r)));
});

test("the return transaction is also large but reads differently", () => {
  // 3,998.5 BTC going back: 15 inputs -> 2 outputs. Still a big consolidation,
  // but it does not drain a watched reserve, so it must not be CRITICAL by
  // default. Returning funds is not the same event as taking them.
  const { f, s } = analyse(fixture.liquidReturn);
  assert.equal(Math.round(f.valueSats / 1e8), 3998); // 3,998.4996 BTC on chain
  assert.notEqual(s.severity, "CRITICAL");
});
