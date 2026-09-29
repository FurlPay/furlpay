"use strict";
// ---------------------------------------------------------------------------
// Sequence-level controls: the $49 × 10 case and the rest of the drift surface.
//
// These tests exist to make one claim falsifiable. "Intent drift detection" is
// the easiest thing in this architecture to assert and not have, so each test
// below states the sequence, the mandate it was legal under, and the specific
// signal that must fire. A test that only checked "score > 0" would pass on an
// implementation that scored everything, which is not a control.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  assessDrift,
  driftConfigFor,
  DEFAULT_DRIFT_CONFIG,
  bps,
} = require("../dist/index.js");

const USDC = (major) => String(Math.round(major * 1e6));
const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-09-28T12:00:00Z");

/** The mandate from the architecture document: $50/tx, $500/day, approve >$100. */
function cloudInfraConfig(overrides) {
  return driftConfigFor({
    cumulativeCapAtomic: USDC(500),
    windowSeconds: 86_400,
    approvalThresholdAtomic: USDC(100),
    overrides,
  });
}

function entry(i, amountMajor, opts = {}) {
  return {
    paymentId: `pay_${i}`,
    atMs: opts.atMs ?? NOW - (i + 1) * 60_000,
    amountAtomic: USDC(amountMajor),
    recipientKey: opts.recipient ?? "0xvendor",
    merchantDomain: opts.domain ?? "api.cloudvendor.com",
    category: opts.category ?? "cloud_infrastructure",
    railId: opts.rail ?? "x402_usdc_arbitrum",
    settled: opts.settled !== false,
  };
}

function signalIds(assessment) {
  return assessment.signals.map((s) => s.id);
}

// ── The headline case ──────────────────────────────────────────────────────

test("a single $49 payment under a $50/$500 mandate is ALLOWed", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(49), recipientKey: "0xvendor", category: "cloud_infrastructure", railId: "x402_usdc_arbitrum" },
    history: [],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.verdict, "ALLOW", `signals: ${signalIds(a)}`);
  assert.strictEqual(a.score, 0);
});

test("the tenth $49 payment in one window is caught, though every per-tx check passes", () => {
  // Nine settled $49 payments, all to the approved vendor, all in category.
  const history = Array.from({ length: 9 }, (_, i) => entry(i, 49));
  const a = assessDrift({
    candidate: { amountAtomic: USDC(49), recipientKey: "0xvendor", category: "cloud_infrastructure", railId: "x402_usdc_arbitrum" },
    history,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });

  // Every individual rule the mandate expresses is satisfied:
  //   $49 <= $50 per-tx                          PASS
  //   $490 <= $500 cumulative                    PASS  (9 x $49 = $441, +$49 = $490)
  //   approved vendor                            PASS
  //   never crosses the $100 approval threshold   PASS
  // and the sequence is still refused.
  assert.strictEqual(a.measured.exposureBeforeAtomic, USDC(441));
  assert.strictEqual(a.measured.exposureAfterAtomic, USDC(490));
  assert.notStrictEqual(a.verdict, "ALLOW", "the $49 x 10 sequence must not be ALLOWed");
  assert.ok(
    signalIds(a).includes("repeated_identical_amounts"),
    `expected repeated_identical_amounts, got ${signalIds(a)}`
  );
  assert.ok(
    signalIds(a).includes("exposure_near_cap"),
    `expected exposure_near_cap at $490/$500, got ${signalIds(a)}`
  );
  // It stays INSIDE the cumulative cap, so this is not a limit breach. The
  // correct outcome is HOLD: a human is asked about a sequence that no single
  // rule objected to, which is the whole point of the engine.
  assert.ok(!signalIds(a).includes("exposure_exceeds_cap"), "$490 is within the $500 cap");
  assert.strictEqual(a.verdict, "HOLD");
});

test("exposure_exceeds_cap alone is enough to DENY, regardless of other signals", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(400), recipientKey: "0xvendor" },
    history: [entry(0, 300)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(signalIds(a).includes("exposure_exceeds_cap"));
  assert.strictEqual(a.verdict, "DENY");
  assert.ok(a.score >= DEFAULT_DRIFT_CONFIG.denyScore);
});

test("measured exposure is reported in integers and matches the sequence exactly", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(10) },
    history: [entry(0, 10), entry(1, 20)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.measured.exposureBeforeAtomic, USDC(30));
  assert.strictEqual(a.measured.exposureAfterAtomic, USDC(40));
  // 40/500 = 8% = 800bps
  assert.strictEqual(a.measured.exposureAfterBps, 800);
});

// ── Approval-threshold avoidance (structuring) ─────────────────────────────

test("three payments hugging the approval threshold fire threshold avoidance", () => {
  // $95, $96, $97 against a $100 approval threshold: each is legal, none is
  // ever shown to a human, and together they are $288 of unreviewed spend.
  const history = [entry(0, 95), entry(1, 96)];
  const a = assessDrift({
    candidate: { amountAtomic: USDC(97), recipientKey: "0xvendor" },
    history,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(
    signalIds(a).includes("approval_threshold_avoidance"),
    `expected approval_threshold_avoidance, got ${signalIds(a)}`
  );
  assert.strictEqual(a.measured.nearThresholdCount, 3);
});

test("two sub-threshold payments summing past the threshold fire the cumulative signal", () => {
  // Only two payments, so the COUNT signal (>= 3) does not fire — but $85 + $90
  // is $175, more than the $100 a human would have been asked about.
  const a = assessDrift({
    candidate: { amountAtomic: USDC(90), recipientKey: "0xvendor" },
    history: [entry(0, 85)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  const ids = signalIds(a);
  assert.ok(!ids.includes("approval_threshold_avoidance"), "count signal should not fire at 2");
  assert.ok(
    ids.includes("threshold_avoidance_cumulative"),
    `expected threshold_avoidance_cumulative, got ${ids}`
  );
});

test("payments well below the threshold band do not fire avoidance signals", () => {
  // $10 each is 10% of the threshold — nowhere near the 80% band.
  const history = [entry(0, 10), entry(1, 10), entry(2, 10)];
  const a = assessDrift({
    candidate: { amountAtomic: USDC(10), recipientKey: "0xvendor" },
    history,
    config: cloudInfraConfig({ repeatedAmountCount: 99 }),
    nowMs: NOW,
  });
  const ids = signalIds(a);
  assert.ok(!ids.includes("approval_threshold_avoidance"));
  assert.ok(!ids.includes("threshold_avoidance_cumulative"));
  assert.strictEqual(a.measured.nearThresholdCount, 0);
});

test("no approval threshold configured means no avoidance signal is possible", () => {
  const config = driftConfigFor({
    cumulativeCapAtomic: USDC(500),
    windowSeconds: 86_400,
    // approvalThresholdAtomic deliberately absent
  });
  const a = assessDrift({
    candidate: { amountAtomic: USDC(97) },
    history: [entry(0, 95), entry(1, 96)],
    config,
    nowMs: NOW,
  });
  assert.ok(!signalIds(a).includes("approval_threshold_avoidance"));
});

// ── Recipient shape ────────────────────────────────────────────────────────

test("fan-out across many recipients is caught", () => {
  const history = Array.from({ length: 8 }, (_, i) =>
    entry(i, 5, { recipient: `0xrecipient${i}` })
  );
  const a = assessDrift({
    candidate: { amountAtomic: USDC(5), recipientKey: "0xrecipient_new" },
    history,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(signalIds(a).includes("recipient_fanout"), `got ${signalIds(a)}`);
  assert.strictEqual(a.measured.distinctRecipients, 9);
});

test("a new recipient taking the majority of the window's value is flagged", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(200), recipientKey: "0xbrand_new" },
    history: [entry(0, 20)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(
    signalIds(a).includes("recipient_concentration_new"),
    `got ${signalIds(a)}`
  );
});

test("concentration on a KNOWN recipient is not flagged — that is a normal vendor", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(200), recipientKey: "0xvendor" },
    history: [entry(0, 20, { recipient: "0xvendor" })],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(!signalIds(a).includes("recipient_concentration_new"));
});

// ── Frequency, rail and category ───────────────────────────────────────────

test("frequency above the window maximum is caught", () => {
  const history = Array.from({ length: 20 }, (_, i) => entry(i, 1));
  const a = assessDrift({
    candidate: { amountAtomic: USDC(1), recipientKey: "0xvendor" },
    history,
    config: cloudInfraConfig({ repeatedAmountCount: 999 }),
    nowMs: NOW,
  });
  assert.ok(signalIds(a).includes("frequency_exceeded"), `got ${signalIds(a)}`);
});

test("switching to a rail the sequence has not used is flagged", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(10), recipientKey: "0xvendor", railId: "stablecoin_cctp" },
    history: [entry(0, 10, { rail: "x402_usdc_arbitrum" })],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(signalIds(a).includes("rail_switching"), `got ${signalIds(a)}`);
});

test("a category outside the current sequence is flagged", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(10), recipientKey: "0xvendor", category: "travel" },
    history: [entry(0, 10, { category: "cloud_infrastructure" })],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(signalIds(a).includes("category_outside_sequence"), `got ${signalIds(a)}`);
});

// ── Properties that make the engine trustworthy ────────────────────────────

test("DECLINED payments do not inflate the sequence", () => {
  // An attacker who could raise a victim's drift score with failed attempts
  // could lock the victim's agent out. Unsettled entries are excluded.
  const history = Array.from({ length: 9 }, (_, i) => entry(i, 49, { settled: false }));
  const a = assessDrift({
    candidate: { amountAtomic: USDC(49), recipientKey: "0xvendor" },
    history,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.verdict, "ALLOW", `signals: ${signalIds(a)}`);
  assert.strictEqual(a.measured.settledCount, 0);
});

test("payments outside the window are excluded", () => {
  const old = Array.from({ length: 9 }, (_, i) => ({
    ...entry(i, 49),
    atMs: NOW - 48 * HOUR,
  }));
  const a = assessDrift({
    candidate: { amountAtomic: USDC(49), recipientKey: "0xvendor" },
    history: old,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.measured.settledCount, 0);
  assert.strictEqual(a.verdict, "ALLOW");
});

test("the assessment is ORDER-INDEPENDENT: a shuffled history scores identically", () => {
  // This is the property that lets a payer-side gate and the control plane run
  // the same function and be unable to disagree.
  const history = [entry(0, 49), entry(1, 95), entry(2, 12), entry(3, 49, { recipient: "0xother" })];
  const shuffled = [history[2], history[0], history[3], history[1]];
  const candidate = { amountAtomic: USDC(49), recipientKey: "0xvendor" };
  const a = assessDrift({ candidate, history, config: cloudInfraConfig(), nowMs: NOW });
  const b = assessDrift({ candidate, history: shuffled, config: cloudInfraConfig(), nowMs: NOW });
  assert.strictEqual(a.score, b.score);
  assert.deepStrictEqual(signalIds(a).sort(), signalIds(b).sort());
  assert.deepStrictEqual(a.measured, b.measured);
});

test("the assessment is REPRODUCIBLE: the same inputs give the same score twice", () => {
  const args = {
    candidate: { amountAtomic: USDC(95), recipientKey: "0xvendor" },
    history: [entry(0, 96), entry(1, 97)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  };
  const first = assessDrift(args);
  const second = assessDrift(args);
  assert.deepStrictEqual(first, second);
});

test("bps is exact integer division and never a float", () => {
  assert.strictEqual(bps(1n, 3n), 3333);
  assert.strictEqual(bps(1n, 0n), 0, "division by zero yields 0, not NaN or Infinity");
  assert.strictEqual(bps(0n, 100n), 0);
  // The float trap this avoids: 0.1 + 0.2 > 0.3 is true in IEEE-754.
  assert.strictEqual(bps(100000n, 300000n), 3333);
});

test("every signal carries an observed value and the bound it was compared to", () => {
  // A denial an operator cannot reconstruct is a denial that cannot be
  // explained to the customer it affected.
  const a = assessDrift({
    candidate: { amountAtomic: USDC(97), recipientKey: "0xvendor" },
    history: [entry(0, 95), entry(1, 96)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.ok(a.signals.length > 0);
  for (const s of a.signals) {
    assert.ok(s.id, "signal has an id");
    assert.ok(Number.isInteger(s.weight), "weight is an integer");
    assert.ok(s.detail && s.detail.length > 10, `signal ${s.id} explains itself`);
    assert.ok(s.observed, `signal ${s.id} reports what it measured`);
    assert.ok(s.bound, `signal ${s.id} reports the bound it compared against`);
  }
});

test("the score is the integer sum of its signal weights — no float accumulation", () => {
  const a = assessDrift({
    candidate: { amountAtomic: USDC(97), recipientKey: "0xnew" },
    history: [entry(0, 95), entry(1, 96)],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  const sum = a.signals.reduce((t, s) => t + s.weight, 0);
  assert.strictEqual(a.score, sum);
  assert.ok(Number.isInteger(a.score));
});

test("SEMANTIC intent understanding is NOT part of this engine", () => {
  // Stated as a test so the boundary cannot quietly move. Two payments that a
  // language model would judge differently — one plainly on-task, one plainly
  // off-task — score IDENTICALLY here, because the engine reads amounts,
  // timing, recipients and rails, and reads no meaning at all.
  const onTask = assessDrift({
    candidate: { amountAtomic: USDC(20), recipientKey: "0xvendor", category: "cloud_infrastructure" },
    history: [entry(0, 20, { category: "cloud_infrastructure" })],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  const offTaskButIdenticalShape = assessDrift({
    candidate: { amountAtomic: USDC(20), recipientKey: "0xvendor", category: "cloud_infrastructure" },
    history: [entry(0, 20, { category: "cloud_infrastructure" })],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(onTask.score, offTaskButIdenticalShape.score);
  assert.strictEqual(onTask.verdict, "ALLOW");
});

// ── Regression: post-dated spend must not escape the exposure window ────────

test("REGRESSION: a future-dated history entry is still counted toward exposure", () => {
  // Found by test: the original window filter was `atMs >= since && atMs <= now`,
  // which dropped any entry stamped in the future. That is an evasion — clock
  // skew or any influence over a timestamp would hide spend from the cumulative
  // cap. Including it is the conservative direction.
  const postDated = entry(0, 300, { atMs: NOW + 60 * 60 * 1000 });
  const a = assessDrift({
    candidate: { amountAtomic: USDC(300), recipientKey: "0xvendor" },
    history: [postDated],
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.measured.settledCount, 1, "the post-dated entry is in the window");
  assert.strictEqual(a.measured.exposureBeforeAtomic, USDC(300));
  assert.ok(signalIds(a).includes("exposure_exceeds_cap"), "$600 must breach the $500 cap");
  assert.strictEqual(a.verdict, "DENY");
});

test("REGRESSION: spend cannot be hidden by post-dating the whole sequence", () => {
  const hidden = Array.from({ length: 9 }, (_, i) =>
    entry(i, 49, { atMs: NOW + (i + 1) * 60_000 })
  );
  const a = assessDrift({
    candidate: { amountAtomic: USDC(49), recipientKey: "0xvendor" },
    history: hidden,
    config: cloudInfraConfig(),
    nowMs: NOW,
  });
  assert.strictEqual(a.measured.settledCount, 9);
  assert.strictEqual(a.measured.exposureAfterAtomic, USDC(490));
  assert.notStrictEqual(a.verdict, "ALLOW");
});
