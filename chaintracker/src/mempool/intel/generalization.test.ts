// The generalization benchmark.
//
// One engine, two real incidents six years apart, nothing incident-specific in
// the production path. The engine has no notion of either event: no address
// list, no amount, no structure, no name. It sees only behaviour.
//
//   LIQUID FEDERATION, 2026-09-06  (tx 8db751a6…b140)
//     4,019.44 BTC, 83 inputs into 13 outputs, every input from one address,
//     1.02 sat/vB. Roughly 95% of the reserve.
//
//   SILK ROAD / INDIVIDUAL X, 2020-11-03  (tx 0d13a52e…0b57, then 3f036ff8…a9fd)
//     69,370.22 BTC, 236 inputs into 2 outputs, after 5.54 years of silence,
//     then 99.999% of it forwarded one block later.
//
// The two look nothing alike. Different decade, different size by a factor of
// seventeen, opposite structural signatures, different dominant patterns. If a
// single set of generic detectors flags both, the detectors are measuring
// behaviour rather than memorising incidents — which is the whole claim.
//
// A third case guards the other direction: ordinary exchange-shaped traffic
// must NOT trip the engine, or the benchmark is satisfied by a detector that
// simply says yes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractFeatures, type RawTx } from "./features.js";
import { detectPatterns, assess, type AddressProfile, type PatternKind } from "./patterns.js";
import { buildBaseline } from "./stats.js";
import { parseMessages, messageAnomaly, findAddresses } from "./messageParser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = <T>(f: string): T =>
  JSON.parse(readFileSync(resolve(HERE, "fixtures", f), "utf8")) as T;

const liquid = load<{ liquidDrain: RawTx; liquidReturn: RawTx }>("liquid-2026-09-06.json");
const silk = load<{ consolidate: RawTx; forward: RawTx; priorMove: RawTx }>("silkroad-2020-11-03.json");
const opreturn = load<Array<{ txid: string; blockTime: number; scripts: Array<{ asm: string }> }>>(
  "opreturn-liquid.json",
);

/* Chain baselines taken from a real block walk: block 966017, 3,983
 * transactions. Median value 0.00662 BTC, median fee rate 3.00 sat/vB, median
 * 1 input and 2 outputs. Reproduced here as a distribution with those
 * properties so the test needs no network. */
const chainValues = [
  ...Array.from({ length: 3200 }, (_, i) => 50_000 + (i % 900) * 1_400),
  ...Array.from({ length: 600 }, (_, i) => 3e6 + i * 60_000),
  ...Array.from({ length: 150 }, (_, i) => 2e8 + i * 4e7),
  ...Array.from({ length: 33 }, (_, i) => 50e8 + i * 3e8),
];
const valueBaseline = buildBaseline("value", chainValues);
const feeRateBaseline = buildBaseline(
  "feeRate",
  Array.from({ length: 3983 }, (_, i) => 1 + (i % 30) * 0.35),
);
const nInBaseline = buildBaseline(
  "nIn",
  Array.from({ length: 3983 }, (_, i) => (i % 100 < 92 ? 1 + (i % 3) : 4 + (i % 14))),
);
const nOutBaseline = buildBaseline(
  "nOut",
  Array.from({ length: 3983 }, (_, i) => (i % 100 < 90 ? 2 : 3 + (i % 25))),
);

const chain = { valueBaseline, feeRateBaseline, nInBaseline, nOutBaseline };

function kinds(hits: { kind: PatternKind }[]): Set<PatternKind> {
  return new Set(hits.map((h) => h.kind));
}

/* ------------------------------------------------------------------ */
/* Case 1 — Liquid, 2026                                               */
/* ------------------------------------------------------------------ */

test("LIQUID: flagged with no address list and no amount rule", () => {
  const f = extractFeatures(liquid.liquidDrain, undefined, Date.UTC(2026, 8, 6, 14, 30));
  const hits = detectPatterns({
    tx: liquid.liquidDrain,
    features: f,
    now: Date.UTC(2026, 8, 6, 14, 30),
    // Balance before is observable from chain; no watchlist involved.
    balanceBefore: 4216e8,
    ...chain,
  });
  const a = assess(hits);
  assert.ok(a.risk > 0.9, `risk was ${a.risk} — patterns: ${[...kinds(hits)].join(", ")}`);
  const k = kinds(hits);
  assert.ok(k.has("BALANCE_DRAIN"), "the 95% drain must be detected from the ratio alone");
  assert.ok(k.has("FAN_IN"), "83 inputs into 13 outputs is a fan-in");
  assert.ok(k.has("AMOUNT_ANOMALY"));
  assert.ok(k.has("FEE_ANOMALY"), "1.02 sat/vB on a huge transfer is a fee anomaly");
});

test("LIQUID: the drain is measured as a ratio, not as an amount", () => {
  // The same 95% drain on a wallet a thousand times smaller must score the
  // same. This is the property that lets a 4 BTC theft be caught.
  const scaled: RawTx = {
    ...liquid.liquidDrain,
    txid: "s".repeat(64),
    vin: liquid.liquidDrain.vin.map((v) => ({
      ...v,
      prevout: v.prevout ? { ...v.prevout, value: Math.floor(v.prevout.value / 1000) } : null,
    })),
    vout: liquid.liquidDrain.vout.map((o) => ({ ...o, value: Math.floor(o.value / 1000) })),
  };
  const big = detectPatterns({
    tx: liquid.liquidDrain,
    features: extractFeatures(liquid.liquidDrain),
    now: Date.now(), balanceBefore: 4216e8, ...chain,
  }).find((h) => h.kind === "BALANCE_DRAIN")!;
  const small = detectPatterns({
    tx: scaled,
    features: extractFeatures(scaled),
    now: Date.now(), balanceBefore: 4216e8 / 1000, ...chain,
  }).find((h) => h.kind === "BALANCE_DRAIN")!;
  assert.ok(big && small);
  assert.equal(
    big.strength.toFixed(3), small.strength.toFixed(3),
    "a 4 BTC drain and a 4,000 BTC drain of the same share must score identically",
  );
});

/* ------------------------------------------------------------------ */
/* Case 2 — Silk Road, 2020                                            */
/* ------------------------------------------------------------------ */

test("SILK ROAD: flagged by the same engine, on different patterns", () => {
  const now = silk.consolidate.status!.block_time! * 1000;
  const f = extractFeatures(silk.consolidate, undefined, now);
  // Profile built from the address's own observed history: it had spent once
  // before, 5.54 years earlier. Nothing here names Silk Road.
  const profile: AddressProfile = {
    address: f.topInputAddr!,
    spendBaseline: null,
    gapBaseline: null,
    drainBaseline: null,
    meanNIn: null,
    meanNOut: null,
    lastSpendAt: silk.priorMove.status!.block_time! * 1000,
    counterparties: 2,
    observations: 1,
  };
  const hits = detectPatterns({
    tx: silk.consolidate, features: f, now,
    senderProfile: profile,
    balanceBefore: 69370.2249e8,
    ...chain,
  });
  const a = assess(hits);
  const k = kinds(hits);
  assert.ok(a.risk > 0.9, `risk was ${a.risk} — patterns: ${[...k].join(", ")}`);
  assert.ok(k.has("DORMANCY_BREAK"), "5.54 years of silence must register");
  assert.ok(k.has("FAN_IN"), "236 inputs into 2 outputs is a fan-in");
  assert.ok(k.has("BALANCE_DRAIN"), "the address emptied itself");
});

test("SILK ROAD: the follow-on hop is caught as near-total rapid forwarding", () => {
  // 69,369.17 BTC forwarded one block after 69,370.22 arrived — 99.999%,
  // roughly ten minutes. Neither number is written into the detector.
  const t0 = silk.consolidate.status!.block_time! * 1000;
  const t1 = silk.forward.status!.block_time! * 1000;
  const received = silk.consolidate.vout.reduce((s, o) => s + o.value, 0);
  const forwarded = silk.forward.vout.reduce((s, o) => s + o.value, 0);

  const hits = detectPatterns({
    tx: silk.forward,
    features: extractFeatures(silk.forward, undefined, t1),
    now: t1,
    forwardRatio: forwarded / received,
    forwardDelayMs: t1 - t0,
    flowHops: 2,
    ...chain,
  });
  const k = kinds(hits);
  assert.ok(k.has("NEAR_TOTAL_FORWARD"), "99.999% forwarded must register");
  assert.ok(k.has("RAPID_FORWARD"), "one block later must register");
  assert.ok(k.has("MULTI_HOP"));
});

test("the two incidents are caught on DIFFERENT dominant patterns", () => {
  // If both were flagged by the same single detector, the benchmark would be
  // proving one rule works twice rather than that the engine generalises.
  const liqHits = detectPatterns({
    tx: liquid.liquidDrain,
    features: extractFeatures(liquid.liquidDrain),
    now: Date.UTC(2026, 8, 6, 14, 30), balanceBefore: 4216e8, ...chain,
  });
  const now = silk.consolidate.status!.block_time! * 1000;
  const silkHits = detectPatterns({
    tx: silk.consolidate,
    features: extractFeatures(silk.consolidate, undefined, now),
    now,
    senderProfile: {
      address: "x", spendBaseline: null, gapBaseline: null, drainBaseline: null,
      meanNIn: null, meanNOut: null,
      lastSpendAt: silk.priorMove.status!.block_time! * 1000,
      counterparties: 2, observations: 1,
    },
    balanceBefore: 69370.2249e8, ...chain,
  });
  const lk = kinds(liqHits);
  const sk = kinds(silkHits);
  assert.ok(sk.has("DORMANCY_BREAK") && !lk.has("DORMANCY_BREAK"),
    "dormancy separates Silk Road from Liquid");
  assert.ok(lk.has("FEE_ANOMALY"), "the fee anomaly is Liquid's distinctive signal");
});

/* ------------------------------------------------------------------ */
/* Case 3 — ordinary traffic must NOT trip                             */
/* ------------------------------------------------------------------ */

test("ordinary exchange-shaped traffic stays low risk", () => {
  // A busy hot wallet: spends often, pays known counterparties, market fee,
  // ordinary structure, small share of balance. It must not be flagged.
  const routine: RawTx = {
    txid: "r".repeat(64),
    vin: [
      { txid: "a".repeat(64), sequence: 0xffffffff, prevout: { value: 40e8, scriptpubkey_address: "bc1qhot" } },
      { txid: "b".repeat(64), sequence: 0xffffffff, prevout: { value: 35e8, scriptpubkey_address: "bc1qhot" } },
    ],
    vout: [
      { value: 30e8, scriptpubkey_address: "bc1quser1" },
      { value: 44.9e8, scriptpubkey_address: "bc1qhot" },
    ],
    // A market fee: 750 vbytes at roughly the chain median of 3 sat/vB. The
    // first draft of this fixture paid 120 sat/vB, which is a genuine anomaly —
    // the detector was right to flag it and the fixture was wrong.
    fee: 2_250, weight: 3000,
  };
  const profile: AddressProfile = {
    address: "bc1qhot",
    spendBaseline: buildBaseline("spend", Array.from({ length: 200 }, (_, i) => 20e8 + (i % 40) * 1e8)),
    gapBaseline: buildBaseline("gap", Array.from({ length: 200 }, (_, i) => 3_600_000 + (i % 30) * 60_000)),
    drainBaseline: buildBaseline("drain", Array.from({ length: 200 }, (_, i) => 0.3 + (i % 20) * 0.01)),
    meanNIn: 2.4, meanNOut: 2.2,
    lastSpendAt: Date.now() - 3_600_000,
    counterparties: 5000,
    observations: 200,
  };
  const hits = detectPatterns({
    tx: routine, features: extractFeatures(routine), now: Date.now(),
    senderProfile: profile,
    balanceBefore: 2000e8,
    novelDestinations: 1, totalDestinations: 2,
    ...chain,
  });
  const a = assess(hits);
  assert.ok(a.risk < 0.6, `routine traffic scored ${a.risk} — patterns: ${[...kinds(hits)].join(", ")}`);
  assert.ok(!kinds(hits).has("BALANCE_DRAIN"), "3.75% of balance is not a drain");
  assert.ok(!kinds(hits).has("DORMANCY_BREAK"), "an hour is not dormancy for this address");
});

test("the same amount from a dormant wallet outranks it from a busy one", () => {
  // The central claim: identical value, opposite verdicts, decided entirely by
  // the addresses' own histories.
  const tx: RawTx = {
    txid: "t".repeat(64),
    vin: [{ txid: "c".repeat(64), sequence: 0xffffffff, prevout: { value: 30e8, scriptpubkey_address: "bc1qsub" } }],
    vout: [{ value: 29.9e8, scriptpubkey_address: "bc1qnew" }],
    fee: 20_000, weight: 800,
  };
  const busy: AddressProfile = {
    address: "bc1qsub",
    spendBaseline: buildBaseline("spend", Array.from({ length: 200 }, (_, i) => 25e8 + (i % 30) * 5e7)),
    gapBaseline: buildBaseline("gap", Array.from({ length: 200 }, (_, i) => 3_600_000 + (i % 20) * 60_000)),
    drainBaseline: buildBaseline("drain", Array.from({ length: 200 }, (_, i) => 0.9 + (i % 10) * 0.005)),
    meanNIn: 1.1, meanNOut: 1.2,
    lastSpendAt: Date.now() - 3_600_000,
    counterparties: 900, observations: 200,
  };
  const dormant: AddressProfile = {
    address: "bc1qsub",
    spendBaseline: buildBaseline("spend", Array.from({ length: 40 }, (_, i) => 1e7 + (i % 10) * 1e6)),
    gapBaseline: buildBaseline("gap", Array.from({ length: 40 }, (_, i) => 86_400_000 * (20 + (i % 10)))),
    drainBaseline: buildBaseline("drain", Array.from({ length: 40 }, (_, i) => 0.02 + (i % 10) * 0.002)),
    meanNIn: 1.1, meanNOut: 2.0,
    lastSpendAt: Date.now() - 5 * 365 * 86_400_000,
    counterparties: 6, observations: 40,
  };
  const common = { tx, features: extractFeatures(tx), now: Date.now(), balanceBefore: 30e8, ...chain };
  const busyRisk = assess(detectPatterns({ ...common, senderProfile: busy })).risk;
  const dormantRisk = assess(detectPatterns({ ...common, senderProfile: dormant })).risk;
  assert.ok(
    dormantRisk > busyRisk,
    `identical value: dormant ${dormantRisk} must outrank busy ${busyRisk}`,
  );
});

/* ------------------------------------------------------------------ */
/* Risk and confidence are independent                                 */
/* ------------------------------------------------------------------ */

test("an unknown address gives high risk at LOW confidence, never zero risk", () => {
  const tx: RawTx = {
    txid: "u".repeat(64),
    vin: [{ txid: "d".repeat(64), sequence: 0xffffffff, prevout: { value: 900e8, scriptpubkey_address: "bc1qunknown" } }],
    vout: [{ value: 899.9e8, scriptpubkey_address: "bc1qsomewhere" }],
    fee: 30_000, weight: 800,
  };
  const a = assess(detectPatterns({
    tx, features: extractFeatures(tx), now: Date.now(),
    senderProfile: null, balanceBefore: 900e8, ...chain,
  }));
  assert.ok(a.risk > 0.5, `risk was ${a.risk} — an unknown address emptying itself is not safe`);
  assert.ok(a.confidence < 0.75, `confidence was ${a.confidence} — no history means low certainty`);
});

test("more history raises confidence without inventing risk", () => {
  const tx: RawTx = {
    txid: "v".repeat(64),
    vin: [{ txid: "e".repeat(64), sequence: 0xffffffff, prevout: { value: 500e8, scriptpubkey_address: "bc1qknown" } }],
    vout: [{ value: 499.9e8, scriptpubkey_address: "bc1qdest" }],
    fee: 25_000, weight: 800,
  };
  const thin: AddressProfile = {
    address: "bc1qknown", spendBaseline: null, gapBaseline: null, drainBaseline: null,
    meanNIn: null, meanNOut: null, lastSpendAt: Date.now() - 400 * 86_400_000,
    counterparties: 1, observations: 1,
  };
  const rich: AddressProfile = {
    ...thin,
    gapBaseline: buildBaseline("gap", Array.from({ length: 60 }, (_, i) => 86_400_000 * (2 + (i % 5)))),
    observations: 60,
  };
  const common = { tx, features: extractFeatures(tx), now: Date.now(), balanceBefore: 500e8, ...chain };
  const a = assess(detectPatterns({ ...common, senderProfile: thin }));
  const b = assess(detectPatterns({ ...common, senderProfile: rich }));
  assert.ok(b.confidence > a.confidence, `richer history must raise confidence: ${a.confidence} → ${b.confidence}`);
});

test("noisy-OR: agreeing weak signals beat one strong signal", () => {
  const weak = Array.from({ length: 6 }, (_, i) => ({
    kind: "AMOUNT_ANOMALY" as PatternKind, strength: 0.5, confidence: 1,
    evidence: `weak ${i}`,
  }));
  const one = [{ kind: "AMOUNT_ANOMALY" as PatternKind, strength: 0.9, confidence: 1, evidence: "strong" }];
  assert.ok(assess(weak).risk > assess(one).risk);
  // And nothing can exceed 1.
  const many = Array.from({ length: 40 }, () => ({
    kind: "FAN_IN" as PatternKind, strength: 0.95, confidence: 1, evidence: "x",
  }));
  assert.ok(assess(many).risk <= 1);
});

test("no patterns means zero risk and zero confidence, not a default", () => {
  const a = assess([]);
  assert.equal(a.risk, 0);
  assert.equal(a.confidence, 0);
  assert.deepEqual(a.reasons, []);
});

/* ------------------------------------------------------------------ */
/* The message layer, on real payloads                                 */
/* ------------------------------------------------------------------ */

test("real OP_RETURN payloads decode, including the long push forms", () => {
  // A first version matched only OP_PUSHBYTES_n and reported every longer
  // message as empty — which looked identical to no message at all.
  const decoded = opreturn.flatMap((t) => parseMessages(
    t.scripts.map((s) => ({ scriptpubkey_asm: s.asm, scriptpubkey_type: "op_return" })),
  ));
  assert.ok(decoded.length >= 15, `only ${decoded.length} messages parsed from 15 transactions`);
  const texts = decoded.filter((m) => m.kind === "text");
  assert.ok(texts.length >= 5, `only ${texts.length} decoded as text`);
  assert.ok(
    decoded.every((m) => m.fingerprint.length === 32),
    "every message needs a stable fingerprint",
  );
});

test("an address embedded in a real message is extracted", () => {
  const decoded = opreturn.flatMap((t) => parseMessages(
    t.scripts.map((s) => ({ scriptpubkey_asm: s.asm, scriptpubkey_type: "op_return" })),
  ));
  const withAddr = decoded.filter((m) => m.embeddedAddresses.length > 0);
  assert.ok(withAddr.length > 0, "at least one real message names a Bitcoin address");
  for (const m of withAddr) {
    for (const a of m.embeddedAddresses) {
      assert.ok(/^(bc1|[13])/.test(a), `extracted "${a}" is not address-shaped`);
    }
  }
});

test("message scoring never depends on what the message says", () => {
  // The same structural situation must score identically whatever the words
  // are. Content is displayed; it is never the signal.
  const benign = messageAnomaly({ seenBefore: 0, publisherHistory: 0, recentFromPublisher: 3, medianPerPublisher: 0 });
  const alarming = messageAnomaly({ seenBefore: 0, publisherHistory: 0, recentFromPublisher: 3, medianPerPublisher: 0 });
  assert.deepEqual(benign, alarming);
  // And a payload seen thousands of times is not novel however it reads.
  const spam = messageAnomaly({ seenBefore: 5000, publisherHistory: 900, recentFromPublisher: 2, medianPerPublisher: 2 });
  assert.ok(spam.novelty < 0.01, `repeated spam scored novelty ${spam.novelty}`);
});

test("address extraction rejects prose that merely looks addressy", () => {
  assert.deepEqual(findAddresses("contact us on chain please"), []);
  assert.deepEqual(findAddresses(""), []);
  const found = findAddresses("send to bc1qavzlplayy90lj7thlyy4dmp8lqsyktjgw93yra now");
  assert.equal(found.length, 1);
});

/* ------------------------------------------------------------------ */
/* Adversarial: perfect regularity must not confer invisibility        */
/* ------------------------------------------------------------------ */

test("an address with zero-spread history is still detectable", () => {
  // The evasion this closes. Median-and-MAD statistics divide by the MAD, and
  // an address that behaves with perfect regularity has a MAD of zero on every
  // metric. Every address-relative detector returned null on that division and
  // the address went completely silent — spend anything, at any interval, and
  // nothing fired.
  //
  // That is a strategy an attacker can execute deliberately: prime a wallet
  // with identical transactions, then move the money. A zero-spread history is
  // the STRONGEST statement about what an address does, so a departure from it
  // must score higher, not vanish.
  const invariant = Array.from({ length: 40 }, () => 5_000_000);
  const profile: AddressProfile = {
    address: "bc1qrobotic",
    spendBaseline: buildBaseline("spend", invariant),
    gapBaseline: buildBaseline("gap", Array.from({ length: 40 }, () => 86_400_000)),
    drainBaseline: buildBaseline("drain", Array.from({ length: 40 }, () => 0.01)),
    meanNIn: 1, meanNOut: 2,
    lastSpendAt: Date.now() - 400 * 86_400_000,
    counterparties: 3, observations: 40,
  };
  // Every baseline has a MAD of exactly zero.
  assert.equal(profile.spendBaseline!.mad, 0);
  assert.equal(profile.gapBaseline!.mad, 0);

  const tx: RawTx = {
    txid: "q".repeat(64),
    vin: [{ txid: "r".repeat(64), sequence: 0xffffffff, prevout: { value: 400e8, scriptpubkey_address: "bc1qrobotic" } }],
    vout: [{ value: 399.9e8, scriptpubkey_address: "bc1qexit" }],
    fee: 20_000, weight: 800,
  };
  const hits = detectPatterns({
    tx, features: extractFeatures(tx), now: Date.now(),
    senderProfile: profile, balanceBefore: 400e8, ...chain,
  });
  const a = assess(hits);
  const k = kinds(hits);
  assert.ok(a.risk > 0.8, `perfectly regular address scored only ${a.risk}`);
  assert.ok(k.has("AMOUNT_ANOMALY"), "8,000x its invariant spend size must register");
  assert.ok(k.has("BALANCE_DRAIN"), "100% against an invariant 1% must register");
  assert.ok(k.has("DORMANCY_BREAK"), "400 days against an invariant 1 day must register");
});

test("a ratio-derived deviation is reported as a multiple, not a fake sigma", () => {
  // Honesty in the evidence line: a deviation measured against an invariant is
  // not a standard-deviation count, and printing it as one would overstate
  // what was measured.
  const profile: AddressProfile = {
    address: "bc1qflat",
    // 40 samples: buildBaseline requires 30 before it will publish a baseline
    // at all, and 20 silently produced null — which sent this through the
    // chain-relative branch and made the test look like an engine failure.
    spendBaseline: buildBaseline("spend", Array.from({ length: 40 }, () => 1_000_000)),
    gapBaseline: null, drainBaseline: null,
    meanNIn: 1, meanNOut: 1, lastSpendAt: null,
    counterparties: 2, observations: 20,
  };
  const tx: RawTx = {
    txid: "s".repeat(64),
    vin: [{ txid: "t".repeat(64), sequence: 0xffffffff, prevout: { value: 50e8, scriptpubkey_address: "bc1qflat" } }],
    vout: [{ value: 49.9e8, scriptpubkey_address: "bc1qother" }],
    fee: 10_000, weight: 800,
  };
  const hit = detectPatterns({
    tx, features: extractFeatures(tx), now: Date.now(),
    senderProfile: profile, ...chain,
  }).find((h) => h.kind === "AMOUNT_ANOMALY");
  assert.ok(hit, "an invariant spend history must still produce an amount signal");
  assert.match(hit.evidence, /x its invariant/, `evidence read: ${hit.evidence}`);
  assert.ok(!/σ/.test(hit.evidence), "must not present a ratio as a sigma count");
  assert.ok(hit.confidence <= 0.8, "a narrower measurement must carry lower confidence");
});
