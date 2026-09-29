"use strict";
// ---------------------------------------------------------------------------
// The deterministic policy engine — the function that returns ALLOW/HOLD/DENY.
//
// TWO PROPERTIES UNDER TEST.
//
//   1. IT IS A PURE FUNCTION OF ITS INPUTS. The same mandate, history and clock
//      reading reach the same answer, every time. A decision that cannot be
//      replayed cannot be audited, and an unauditable money decision is a
//      liability whatever its accuracy.
//
//   2. A CHECK THAT COULD NOT RUN IS A DENIAL. Every gate — revocation, recipient
//      verification, drift — is a REQUIRED input, so there is no shape of this
//      call where a check was skipped and the payment was allowed anyway.
//
// Order is also asserted, in its own tests: a revoked mandate must never produce
// "approval required" as its reason, because that reason tells the caller to go
// and obtain an approval for authority that no longer exists.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const { evaluatePolicy, DEFAULT_ESCALATION } = require("../dist/index.js");

const NOW = Date.parse("2026-09-28T12:00:00Z");
const USDC = (m) => String(Math.round(m * 1e6));

const authority = (o = {}) => ({
  principalId: "prin_1",
  organizationId: "org_1",
  delegationId: "del_1",
  operatorId: "op_1",
  agentId: "agent_1",
  sessionId: "sess_1",
  scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500) },
  attestation: "tee",
  chain: ["prin_1", "del_1", "op_1", "agent_1", "sess_1"],
  ...o,
});

const mandate = (scope = {}) => ({
  mandateId: "mand_1",
  organizationId: "org_1",
  principalId: "prin_1",
  delegatedTo: "agent_1",
  authorityScope: {
    currency: "USDC",
    maxAmountPerTxAtomic: USDC(50),
    maxCumulativeAtomic: USDC(500),
    spendingWindowSeconds: 86400,
    ...scope,
  },
  issuedAt: "2026-09-28T00:00:00Z",
  expiresAt: "2026-09-29T00:00:00Z",
  nonce: "n1",
  policyVersion: "cp-2026-09-28",
  status: "ACTIVE",
});

const candidate = (o = {}) => ({
  amountAtomic: USDC(28.5),
  asset: "USDC",
  currency: "USDC",
  networkId: "arbitrum_one",
  railId: "x402_usdc_arbitrum",
  recipientId: "rcpt_1",
  merchantDomain: "api.deepseek.com",
  ...o,
});

const drift = (o = {}) => ({ verdict: "ALLOW", score: 0, signals: [], measured: {}, ...o });

function decide(o = {}) {
  return evaluatePolicy({
    authority: authority(o.authority),
    mandate: o.mandate ?? mandate(o.mandateScope),
    mandateLiveness: o.mandateLiveness ?? { live: true },
    revocation: o.revocation ?? { live: true, checkedSubjects: 8, snapshotAgeMs: 100 },
    recipient: o.recipient ?? { ok: true, canonicalDestination: "0xabc", firstUse: false },
    drift: o.drift ?? drift(),
    policies: o.policies ?? [],
    candidate: candidate(o.candidate),
    exposure: {
      hourlyAtomic: "0",
      dailyAtomic: "0",
      monthlyAtomic: "0",
      mandateWindowAtomic: "0",
      ...(o.exposure ?? {}),
    },
    approvalPresent: o.approvalPresent ?? false,
    railIsNew: o.railIsNew ?? false,
    nowMs: o.nowMs ?? NOW,
  });
}

const policy = (o = {}) => ({
  policyId: "pol_1",
  organizationId: "org_1",
  version: 3,
  name: "Default",
  status: "ACTIVE",
  ...o,
});

function checkFor(d, id) {
  return d.checks.find((c) => c.id === id);
}

// ── Happy path ───────────────────────────────────────────────────────────

test("a compliant payment is ALLOWed and records every check it ran", () => {
  const d = decide();
  assert.strictEqual(d.verdict, "ALLOW", d.primaryReason);
  assert.strictEqual(d.requiresApproval, false);
  assert.strictEqual(checkFor(d, "revocation").outcome, "pass");
  assert.strictEqual(checkFor(d, "mandate_liveness").outcome, "pass");
  assert.strictEqual(checkFor(d, "recipient_verification").outcome, "pass");
  assert.strictEqual(checkFor(d, "mandate_per_tx").outcome, "pass");
  assert.strictEqual(checkFor(d, "drift").outcome, "pass");
});

test("the decision is reproducible on identical inputs", () => {
  assert.deepStrictEqual(decide(), decide());
});

// ── Authorization denials ───────────────────────────────────────────────

test("revocation failure DENIES, and is the FIRST reason reported", () => {
  const d = decide({
    revocation: { live: false, reason: "state_unavailable", detail: "redis down" },
    // Everything else is also wrong, to prove ordering.
    mandateLiveness: { live: false, reason: "revoked", detail: "x" },
    recipient: { ok: false, reason: "recipient_unknown", detail: "y", firstUse: true },
    drift: drift({ verdict: "DENY", score: 100 }),
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "revocation").outcome, "deny");
  assert.match(d.primaryReason, /state_unavailable/);
  assert.strictEqual(checkFor(d, "approval"), undefined, "approval is never even reached");
});

test("an expired mandate DENIES and never reports 'approval required'", () => {
  const d = decide({
    mandateLiveness: { live: false, reason: "expired", detail: "expired at X" },
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(1) },
    candidate: { amountAtomic: USDC(40) },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /expired/);
  assert.strictEqual(d.requiresApproval, false);
  assert.strictEqual(checkFor(d, "approval"), undefined);
});

test("a revoked mandate DENIES with 'revoked', distinct from expired", () => {
  const d = decide({ mandateLiveness: { live: false, reason: "revoked", detail: "project ended" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /revoked/);
  assert.match(d.primaryReason, /project ended/);
});

test("a mandate bound to a DIFFERENT agent DENIES", () => {
  const d = decide({ mandate: { ...mandate(), delegatedTo: "agent_other" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "mandate_agent_binding").outcome, "deny");
});

test("a mandate expressed as a DID matching the agent id binds successfully", () => {
  const d = decide({
    mandate: { ...mandate(), delegatedTo: "did:agent:cloudflare:agent_1.example.cloudflare.pay" },
  });
  assert.strictEqual(d.verdict, "ALLOW", d.primaryReason);
});

// ── Denomination ────────────────────────────────────────────────────────

test("a currency mismatch DENIES — a cap in one unit says nothing about another", () => {
  const d = decide({ candidate: { currency: "EURC" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "mandate_denomination").outcome, "deny");
  assert.match(d.primaryReason, /says nothing about an amount in another/);
});

test("an asset the mandate did not name DENIES", () => {
  const d = decide({ mandateScope: { asset: "USDC" }, candidate: { asset: "USDT" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "mandate_denomination").outcome, "deny");
});

test("a network the mandate did not authorize DENIES", () => {
  const d = decide({ mandateScope: { networks: ["base"] }, candidate: { networkId: "arbitrum_one" } });
  assert.strictEqual(d.verdict, "DENY");
});

// ── Amount limits ───────────────────────────────────────────────────────

test("over the per-transaction cap DENIES", () => {
  const d = decide({ candidate: { amountAtomic: USDC(51) } });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "mandate_per_tx").outcome, "deny");
});

test("exactly AT the cap is permitted — a cap is a ceiling, not an exclusive bound", () => {
  const d = decide({ candidate: { amountAtomic: USDC(50) } });
  assert.strictEqual(d.verdict, "ALLOW", d.primaryReason);
});

test("the CHAIN's tighter cap wins over the mandate's looser one", () => {
  // A mandate cannot grant more than the delegation that produced the agent.
  const d = decide({
    authority: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(10), maxCumulativeAtomic: USDC(500) } },
    candidate: { amountAtomic: USDC(30) },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /effective per-transaction cap 10000000/);
});

test("cumulative exposure DENIES even when every individual payment is legal", () => {
  const d = decide({
    candidate: { amountAtomic: USDC(20) },
    exposure: { mandateWindowAtomic: USDC(490) },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "mandate_cumulative").outcome, "deny");
  assert.match(d.primaryReason, /individually-legal payments is still bounded in total/);
  assert.strictEqual(d.evaluated.mandateWindowAfterAtomic, USDC(510));
});

test("a zero or negative amount DENIES", () => {
  assert.strictEqual(decide({ candidate: { amountAtomic: "0" } }).verdict, "DENY");
  assert.strictEqual(decide({ candidate: { amountAtomic: "-1" } }).verdict, "DENY");
});

test("a non-integer amount DENIES rather than being rounded", () => {
  const d = decide({ candidate: { amountAtomic: "28.50" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /not an integer amount/);
});

test("UNREADABLE recorded exposure DENIES rather than being treated as zero", () => {
  const d = decide({ exposure: { mandateWindowAtomic: "unknown" } });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /refusing rather than assuming zero/);
});

// ── Scope allowlists ────────────────────────────────────────────────────

test("a merchant outside the mandate's allowlist DENIES", () => {
  const d = decide({
    mandateScope: { allowedMerchantDomains: ["data.sec.gov"] },
    candidate: { merchantDomain: "api.deepseek.com" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "scope_merchant").outcome, "deny");
});

test("a wildcard merchant pattern matches a subdomain but not the apex", () => {
  const sub = decide({
    mandateScope: { allowedMerchantDomains: ["*.deepseek.com"] },
    candidate: { merchantDomain: "api.deepseek.com" },
  });
  assert.strictEqual(sub.verdict, "ALLOW", sub.primaryReason);
  const apex = decide({
    mandateScope: { allowedMerchantDomains: ["*.deepseek.com"] },
    candidate: { merchantDomain: "deepseek.com" },
  });
  assert.strictEqual(apex.verdict, "DENY", "*.x.com did not say x.com");
});

test("a constrained merchant list with NO domain on the payment DENIES", () => {
  const d = decide({
    mandateScope: { allowedMerchantDomains: ["a.com"] },
    candidate: { merchantDomain: undefined },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /names none/);
});

test("an EMPTY merchant allowlist denies everything", () => {
  const d = decide({ mandateScope: { allowedMerchantDomains: [] } });
  assert.strictEqual(d.verdict, "DENY");
});

test("a rail outside the mandate's allowed rails DENIES", () => {
  const d = decide({
    mandateScope: { allowedRails: ["stablecoin_cctp"] },
    candidate: { railId: "visa_intelligent_commerce" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "scope_rail").outcome, "deny");
});

test("a category outside the mandate's allowlist DENIES", () => {
  const d = decide({
    mandateScope: { allowedCategories: ["cloud_infrastructure"] },
    candidate: { category: "gambling" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "scope_category").outcome, "deny");
});

test("a blocked jurisdiction on the chain DENIES", () => {
  const d = decide({
    authority: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), blockedJurisdictions: ["IR"] } },
    candidate: { jurisdiction: "IR" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "scope_jurisdiction").outcome, "deny");
});

// ── Recipient ───────────────────────────────────────────────────────────

test("a failed recipient verification DENIES and carries the reason through", () => {
  const d = decide({
    recipient: { ok: false, reason: "destination_attested_on_other_network", detail: "attested for ethereum", firstUse: false },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "recipient_verification").outcome, "deny");
  assert.match(d.primaryReason, /destination_attested_on_other_network/);
});

// ── Organization policies ───────────────────────────────────────────────

test("a policy per-transaction cap DENIES and names the policy", () => {
  const d = decide({
    policies: [policy({ amount: { maxPerTransactionAtomic: USDC(10) } })],
    candidate: { amountAtomic: USDC(20) },
  });
  assert.strictEqual(d.verdict, "DENY");
  const c = checkFor(d, "policy_amount");
  assert.strictEqual(c.policyId, "pol_1");
  assert.strictEqual(c.policyVersion, 3);
});

for (const [label, capField, exposureField] of [
  ["hourly", "maxHourlyAtomic", "hourlyAtomic"],
  ["daily", "maxDailyAtomic", "dailyAtomic"],
  ["monthly", "maxMonthlyAtomic", "monthlyAtomic"],
]) {
  test(`a ${label} window cap DENIES when exposure plus this payment exceeds it`, () => {
    const d = decide({
      policies: [policy({ amount: { [capField]: USDC(100) } })],
      candidate: { amountAtomic: USDC(20) },
      exposure: { [exposureField]: USDC(90) },
    });
    assert.strictEqual(d.verdict, "DENY", `${label} cap must bind`);
    assert.match(d.primaryReason, new RegExp(label));
  });
}

test("an unreadable window exposure DENIES rather than counting as zero", () => {
  const d = decide({
    policies: [policy({ amount: { maxDailyAtomic: USDC(100) } })],
    exposure: { dailyAtomic: "oops" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /refusing rather than treating it as zero/);
});

test("a blocked currency DENIES; an allowed list not containing it also DENIES", () => {
  assert.strictEqual(
    decide({ policies: [policy({ currency: { blocked: ["USDC"] } })] }).verdict,
    "DENY"
  );
  assert.strictEqual(
    decide({ policies: [policy({ currency: { allowed: ["EURC"] } })] }).verdict,
    "DENY"
  );
  assert.strictEqual(
    decide({ policies: [policy({ currency: { allowed: ["USDC"] } })] }).verdict,
    "ALLOW"
  );
});

test("a blocked merchant, MCC, recipient, contract and rail each DENY", () => {
  assert.strictEqual(decide({ policies: [policy({ merchant: { blockedDomains: ["api.deepseek.com"] } })] }).verdict, "DENY");
  assert.strictEqual(decide({ policies: [policy({ merchant: { blockedMccs: ["7995"] } })], candidate: { mcc: "7995" } }).verdict, "DENY");
  assert.strictEqual(decide({ policies: [policy({ merchant: { blockedRecipientIds: ["rcpt_1"] } })] }).verdict, "DENY");
  assert.strictEqual(
    decide({
      policies: [policy({ merchant: { allowedContracts: ["0xaaa"] } })],
      candidate: { contractAddress: "0xbbb" },
    }).verdict,
    "DENY"
  );
  assert.strictEqual(decide({ policies: [policy({ rails: { blocked: ["x402_usdc_arbitrum"] } })] }).verdict, "DENY");
});

test("a contract allowlist match is case-insensitive", () => {
  const d = decide({
    policies: [policy({ merchant: { allowedContracts: ["0xAAA"] } })],
    candidate: { contractAddress: "0xaaa" },
  });
  assert.strictEqual(d.verdict, "ALLOW", d.primaryReason);
});

test("a blocked jurisdiction in a policy DENIES", () => {
  const d = decide({
    policies: [policy({ geography: { blockedJurisdictions: ["KP"] } })],
    candidate: { jurisdiction: "KP" },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "policy_geography").outcome, "deny");
});

test("a policy outside its active window DENIES", () => {
  assert.strictEqual(
    decide({ policies: [policy({ time: { activeFrom: "2026-10-01T00:00:00Z" } })] }).verdict,
    "DENY"
  );
  assert.strictEqual(
    decide({ policies: [policy({ time: { activeUntil: "2026-09-01T00:00:00Z" } })] }).verdict,
    "DENY"
  );
});

test("an out-of-hours payment DENIES", () => {
  // NOW is 12:00 UTC.
  const d = decide({ policies: [policy({ time: { allowedHoursUtc: [9, 10, 11] } })] });
  assert.strictEqual(d.verdict, "DENY");
  assert.match(d.primaryReason, /12:00 UTC/);
  assert.strictEqual(decide({ policies: [policy({ time: { allowedHoursUtc: [12] } })] }).verdict, "ALLOW");
});

test("insufficient attestation DENIES", () => {
  const d = decide({
    authority: { attestation: "key_only" },
    policies: [policy({ risk: { minAttestation: "tee" } })],
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "policy_attestation").outcome, "deny");
});

test("a DISABLED policy is not applied", () => {
  const d = decide({
    policies: [policy({ status: "DISABLED", amount: { maxPerTransactionAtomic: "1" } })],
  });
  assert.strictEqual(d.verdict, "ALLOW", d.primaryReason);
  assert.strictEqual(checkFor(d, "policy_status").outcome, "not_applicable");
});

test("every policy consulted is recorded with its version", () => {
  const d = decide({
    policies: [policy({ policyId: "pol_a", version: 1 }), policy({ policyId: "pol_b", version: 7 })],
  });
  assert.deepStrictEqual(d.evaluatedPolicies, [
    { policyId: "pol_a", version: 1 },
    { policyId: "pol_b", version: 7 },
  ]);
});

// ── Approval ────────────────────────────────────────────────────────────

test("over the approval threshold HOLDs with an escalation, and does not ALLOW", () => {
  const d = decide({
  authority: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(500), maxCumulativeAtomic: USDC(1000) } },
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(20), maxAmountPerTxAtomic: USDC(200), maxCumulativeAtomic: USDC(500) },
    candidate: { amountAtomic: USDC(145) },
  });
  assert.strictEqual(d.verdict, "HOLD");
  assert.strictEqual(d.requiresApproval, true);
  assert.strictEqual(d.escalation.onTimeout, "HOLD");
  assert.strictEqual(d.escalation.approverRole, DEFAULT_ESCALATION.approverRole);
  assert.strictEqual(d.escalation.thresholdAtomic, USDC(20));
});

test("under the threshold ALLOWs with no approval requirement", () => {
  const d = decide({
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(100) },
    candidate: { amountAtomic: USDC(28.5) },
  });
  assert.strictEqual(d.verdict, "ALLOW");
  assert.strictEqual(d.requiresApproval, false);
});

test("exactly AT the threshold does not require approval", () => {
  const d = decide({
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(50) },
    candidate: { amountAtomic: USDC(50) },
  });
  assert.strictEqual(d.verdict, "ALLOW");
});

test("a recorded approval turns a HOLD into an ALLOW", () => {
  const d = decide({
  authority: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(500), maxCumulativeAtomic: USDC(1000) } },
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(20), maxAmountPerTxAtomic: USDC(200), maxCumulativeAtomic: USDC(500) },
    candidate: { amountAtomic: USDC(145) },
    approvalPresent: true,
  });
  assert.strictEqual(d.verdict, "ALLOW");
  assert.strictEqual(d.requiresApproval, true, "the requirement is still recorded");
  assert.strictEqual(checkFor(d, "approval").outcome, "pass");
});

test("the TIGHTEST approval threshold across mandate and policies wins", () => {
  // A lower threshold means MORE payments see a human, so the minimum is the
  // conservative direction.
  const d = decide({
  authority: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(500), maxCumulativeAtomic: USDC(1000) } },
    mandateScope: { requireHumanApprovalAboveAtomic: USDC(400), maxAmountPerTxAtomic: USDC(500), maxCumulativeAtomic: USDC(1000) },
    policies: [policy({ approval: { requiredAboveAtomic: USDC(25) } })],
    candidate: { amountAtomic: USDC(100) },
  });
  assert.strictEqual(d.verdict, "HOLD");
  assert.strictEqual(d.escalation.thresholdAtomic, USDC(25));
});

test("a first payment to a new recipient can require approval regardless of amount", () => {
  const d = decide({
    policies: [policy({ approval: { requiredForNewRecipient: true } })],
    recipient: { ok: true, canonicalDestination: "0xabc", firstUse: true },
    candidate: { amountAtomic: USDC(1) },
  });
  assert.strictEqual(d.verdict, "HOLD");
  assert.strictEqual(d.requiresApproval, true);
  assert.match(d.escalation.reason, /first payment to a recipient/);
});

test("a new rail can require approval", () => {
  const d = decide({
    policies: [policy({ approval: { requiredForNewRail: true } })],
    railIsNew: true,
  });
  assert.strictEqual(d.verdict, "HOLD");
  assert.match(d.escalation.reason, /rail this agent has not used/);
});

test("the escalation timeout action comes from policy and is only HOLD or DENY", () => {
  const d = decide({
    policies: [policy({ approval: { requiredAboveAtomic: USDC(1), onTimeout: "DENY", timeoutSeconds: 60, approverRole: "cfo" } })],
    candidate: { amountAtomic: USDC(10) },
  });
  assert.strictEqual(d.escalation.onTimeout, "DENY");
  assert.strictEqual(d.escalation.timeoutSeconds, 60);
  assert.strictEqual(d.escalation.approverRole, "cfo");
});

// ── Drift integration ───────────────────────────────────────────────────

test("a drift DENY verdict DENIES the payment and lists its signals", () => {
  const d = decide({
    drift: drift({
      verdict: "DENY",
      score: 100,
      signals: [{ id: "exposure_exceeds_cap", weight: 100, detail: "over cap", observed: "1", bound: "0" }],
    }),
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(checkFor(d, "drift").outcome, "deny");
  assert.match(d.primaryReason, /exposure_exceeds_cap/);
});

test("a drift HOLD verdict HOLDs the payment", () => {
  const d = decide({
    drift: drift({
      verdict: "HOLD",
      score: 45,
      signals: [{ id: "repeated_identical_amounts", weight: 30, detail: "loop", observed: "4", bound: "4" }],
    }),
  });
  assert.strictEqual(d.verdict, "HOLD");
  assert.match(d.primaryReason, /repeated_identical_amounts/);
});

test("a policy can set its own drift thresholds, overriding the engine default", () => {
  const d = decide({
    drift: drift({ verdict: "ALLOW", score: 10 }),
    policies: [policy({ risk: { denyScore: 5 } })],
  });
  assert.strictEqual(d.verdict, "DENY", "a stricter policy threshold binds even when drift said ALLOW");
});

test("holdOnFirstUse parks a first payment for review", () => {
  const d = decide({
    policies: [policy({ risk: { holdOnFirstUse: true } })],
    recipient: { ok: true, canonicalDestination: "0xabc", firstUse: true },
  });
  assert.strictEqual(d.verdict, "HOLD");
});

test("multiple independent holds are ALL reported, so clearing one does not release", () => {
  const d = decide({
    policies: [policy({ risk: { holdOnFirstUse: true, holdScore: 1 } })],
    recipient: { ok: true, canonicalDestination: "0xabc", firstUse: true },
    drift: drift({ verdict: "HOLD", score: 45, signals: [{ id: "frequency_exceeded", weight: 25, detail: "d", observed: "1", bound: "1" }] }),
  });
  assert.strictEqual(d.verdict, "HOLD");
  const holdChecks = d.checks.filter((c) => c.outcome === "hold");
  assert.ok(holdChecks.length >= 2, `expected multiple holds, got ${holdChecks.length}`);
  assert.match(d.escalation.reason, /\|/, "all hold reasons are carried");
});

// ── Ordering, asserted explicitly ───────────────────────────────────────

test("ORDER: liveness is checked before limits", () => {
  const d = decide({
    mandateLiveness: { live: false, reason: "expired", detail: "x" },
    candidate: { amountAtomic: USDC(9999) },
  });
  assert.strictEqual(checkFor(d, "mandate_liveness").outcome, "deny");
  assert.strictEqual(checkFor(d, "mandate_per_tx"), undefined);
});

test("ORDER: limits are checked before drift", () => {
  const d = decide({
    candidate: { amountAtomic: USDC(999) },
    drift: drift({ verdict: "DENY", score: 100 }),
  });
  assert.strictEqual(checkFor(d, "mandate_per_tx").outcome, "deny");
  assert.strictEqual(checkFor(d, "drift"), undefined);
});

test("ORDER: recipient verification is checked before approval", () => {
  const d = decide({
    recipient: { ok: false, reason: "recipient_unknown", detail: "x", firstUse: true },
    mandateScope: { requireHumanApprovalAboveAtomic: "1" },
  });
  assert.strictEqual(checkFor(d, "recipient_verification").outcome, "deny");
  assert.strictEqual(checkFor(d, "approval"), undefined);
});

test("a DENY never carries requiresApproval=true, so a caller is not sent to get one", () => {
  const d = decide({
    mandateLiveness: { live: false, reason: "revoked", detail: "x" },
    mandateScope: { requireHumanApprovalAboveAtomic: "1" },
    candidate: { amountAtomic: USDC(40) },
  });
  assert.strictEqual(d.verdict, "DENY");
  assert.strictEqual(d.requiresApproval, false);
  assert.strictEqual(d.escalation, undefined);
});

// ── No AI on the path ───────────────────────────────────────────────────

test("evaluatePolicy is synchronous — it cannot await a model, a store or a network", () => {
  // The structural guarantee. A function that returns a value rather than a
  // promise cannot consult anything it was not handed.
  const d = decide();
  assert.ok(!(d instanceof Promise), "the decision is a value, not a promise");
  assert.strictEqual(typeof d.verdict, "string");
});
