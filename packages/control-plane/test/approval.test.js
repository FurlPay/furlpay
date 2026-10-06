"use strict";
// ---------------------------------------------------------------------------
// Human approval decisions.
//
// THE INVARIANT UNDER TEST:
//
//     An unanswered approval never becomes ALLOW, and an answered one is
//     answered exactly once.
//
// Attacked from the directions a caller has: a second answer, an answer to a
// payment that is no longer waiting, a late approval, a corrupt timestamp, and
// an evidence record that tries to drift from the bundle the human saw.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  resolveApprovalDecision,
  approvalEvidenceBundle,
  evidenceLeafHash,
  verifyLeaf,
} = require("../dist/index.js");

const REQUESTED = "2026-10-05T12:00:00Z";
const T0 = Date.parse(REQUESTED);

function approval(overrides = {}) {
  return {
    approvalId: "cpap_1",
    authorizationId: "cpa_1",
    approverRole: "finance_admin",
    requestedAt: REQUESTED,
    timeoutSeconds: 900,
    onTimeout: "HOLD",
    approvedAt: null,
    deniedAt: null,
    ...overrides,
  };
}

function decide(overrides = {}) {
  return resolveApprovalDecision({
    approval: approval(overrides.approval),
    phase: overrides.phase ?? "PENDING_APPROVAL",
    decision: overrides.decision ?? "APPROVE",
    nowMs: overrides.nowMs ?? T0 + 60_000,
  });
}

test("approve inside the window moves PENDING_APPROVAL to APPROVED", () => {
  const r = decide();
  assert.deepStrictEqual(r, { ok: true, event: "APPROVE", from: "PENDING_APPROVAL", to: "APPROVED" });
});

test("deny moves PENDING_APPROVAL to DENIED", () => {
  const r = decide({ decision: "DENY" });
  assert.deepStrictEqual(r, { ok: true, event: "DENY", from: "PENDING_APPROVAL", to: "DENIED" });
});

test("approving a HOLD is a RELEASE, which the execute guard accepts", () => {
  const r = decide({ phase: "HOLD" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.event, "RELEASE");
  assert.strictEqual(r.to, "APPROVED");
});

test("an approval already approved cannot be answered again", () => {
  const r = decide({ approval: { approvedAt: "2026-10-05T12:01:00Z" }, decision: "DENY" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "already_decided");
});

test("an approval already denied cannot be flipped to approved", () => {
  const r = decide({ approval: { deniedAt: "2026-10-05T12:01:00Z" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "already_decided");
});

for (const phase of ["AUTHORIZED", "APPROVED", "EXECUTING", "SETTLED", "DENIED", "EXPIRED", "FAILED", "REVERSED"]) {
  test(`a payment in ${phase} is not waiting on a human`, () => {
    for (const decision of ["APPROVE", "DENY"]) {
      const r = decide({ phase, decision });
      assert.strictEqual(r.ok, false, `${phase}/${decision}`);
      assert.strictEqual(r.code, "not_awaiting_approval");
    }
  });
}

test("a late APPROVE under onTimeout DENY is refused and asks for DENIED", () => {
  const r = decide({ approval: { onTimeout: "DENY" }, nowMs: T0 + 901_000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "approval_timed_out");
  assert.deepStrictEqual(r.timeoutTransition, { event: "DENY", to: "DENIED" });
});

test("the deadline itself counts as late", () => {
  const r = decide({ approval: { onTimeout: "DENY" }, nowMs: T0 + 900_000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "approval_timed_out");
});

test("a late APPROVE under onTimeout HOLD is accepted: HOLD means keep waiting for a human", () => {
  const r = decide({ approval: { onTimeout: "HOLD" }, nowMs: T0 + 3_600_000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.to, "APPROVED");
});

test("a late DENY is always accepted", () => {
  const r = decide({ approval: { onTimeout: "DENY" }, decision: "DENY", nowMs: T0 + 3_600_000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.to, "DENIED");
});

test("an unparseable requestedAt under onTimeout DENY refuses approval rather than waiting forever", () => {
  const r = decide({ approval: { onTimeout: "DENY", requestedAt: "not-a-date" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "approval_timed_out");
});

// ── Evidence ────────────────────────────────────────────────────────────────

function original() {
  return {
    paymentId: "cpa_1",
    organizationId: "org_1",
    sequence: 4,
    previousLeafHash: "c".repeat(64),
    decidedAt: REQUESTED,
    amountAtomic: "50000000000",
    asset: "USDC",
    intent: { mandateId: "mand_1", mandatePayloadHash: "a".repeat(64), expiresAt: "2026-10-06T00:00:00Z", authorityScopeHash: "b".repeat(64) },
    delegation: { principalId: "p", delegationId: "d", operatorId: "o", agentId: "a", chain: ["p", "d", "o", "a"] },
    revocation: { live: true, checkedSubjects: 5, snapshotAgeMs: 10, maxStalenessMs: 5000 },
    policy: { verdict: "HOLD", checks: [], evaluatedPolicies: [], driftScore: 0, driftSignals: [], requiresApproval: true },
    recipient: { recipientId: "r", networkId: "base", asset: "USDC", canonicalDestination: "0xabc", attestationMethod: "none", attestedAt: "", firstUse: false },
    approval: { required: true, approverRole: "finance_admin", timeoutSeconds: 900, onTimeout: "HOLD" },
    trace: { requestId: "req_auth", idempotencyKey: "idem_1" },
  };
}

test("the approval record keeps the payment the human saw and takes a new chain position", () => {
  const prev = evidenceLeafHash(original());
  const b = approvalEvidenceBundle({
    original: original(),
    decision: "APPROVE",
    actor: "user_42",
    at: "2026-10-05T12:03:00Z",
    sequence: 5,
    previousLeafHash: prev,
    requestId: "req_approve",
    stepUpEvidenceHash: "e".repeat(64),
  });
  assert.strictEqual(b.event, "approval_decision");
  assert.strictEqual(b.sequence, 5);
  assert.strictEqual(b.previousLeafHash, prev);
  assert.strictEqual(b.amountAtomic, "50000000000");
  assert.strictEqual(b.recipient.canonicalDestination, "0xabc");
  assert.strictEqual(b.approval.approvedBy, "user_42");
  assert.strictEqual(b.approval.approvedAt, "2026-10-05T12:03:00Z");
  assert.strictEqual(b.approval.deniedBy, undefined);
  assert.strictEqual(b.approval.approverRole, "finance_admin");
  assert.deepStrictEqual(b.trace, { requestId: "req_approve" });
  assert.ok(verifyLeaf(b, evidenceLeafHash(b)));
});

test("a denial records deniedBy and never approvedBy", () => {
  const b = approvalEvidenceBundle({
    original: original(),
    decision: "DENY",
    actor: "user_42",
    at: "2026-10-05T12:03:00Z",
    sequence: 5,
    previousLeafHash: null,
    requestId: "req_deny",
  });
  assert.strictEqual(b.approval.deniedBy, "user_42");
  assert.strictEqual(b.approval.approvedBy, undefined);
  assert.strictEqual(b.approval.approvedAt, undefined);
});

test("editing the approver after the fact breaks the leaf", () => {
  const b = approvalEvidenceBundle({
    original: original(),
    decision: "APPROVE",
    actor: "user_42",
    at: "2026-10-05T12:03:00Z",
    sequence: 5,
    previousLeafHash: null,
    requestId: "req_approve",
  });
  const leaf = evidenceLeafHash(b);
  const forged = { ...b, approval: { ...b.approval, approvedBy: "user_attacker" } };
  assert.strictEqual(verifyLeaf(forged, leaf), false);
});

test("adding the optional event field does not change hashes of records written without it", () => {
  const o = original();
  const before = evidenceLeafHash(o);
  assert.strictEqual(evidenceLeafHash({ ...o, event: undefined }), before);
});
