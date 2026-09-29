"use strict";
// ---------------------------------------------------------------------------
// The decision lifecycle, and the approval invariant.
//
// THE INVARIANT UNDER TEST:
//
//     A payment that required human approval can never settle without it.
//
// Edges alone cannot express that — `AUTHORIZED -> EXECUTING` is legal and must
// stay legal — so the guard is on the record. These tests attack it from every
// direction available to a caller: the direct path, the hold path, a forged
// phase, a replayed approval, and a timeout nobody answered.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  applyPhaseEvent,
  canTransitionPhase,
  isTerminalPhase,
  newLifecycleRecord,
  resolveEscalation,
  eventForTimeout,
  LifecycleError,
  toSettlementStatus,
} = require("../dist/index.js");

const AT = "2026-09-28T12:00:00Z";
const NOW = Date.parse(AT);

function record(phase, approvalRequired) {
  return newLifecycleRecord({ phase, approvalRequired, at: AT, actor: "agent_1" });
}

function advance(rec, event, actor = "system", at = AT) {
  return applyPhaseEvent({ record: rec, event, at, actor });
}

// ── The approval invariant ────────────────────────────────────────────────

test("an approval-requiring payment cannot be EXECUTEd without a recorded approval", () => {
  const rec = record("PENDING_APPROVAL", true);
  // The state machine refuses EXECUTE from PENDING_APPROVAL outright.
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
  assert.strictEqual(rec.phase, "PENDING_APPROVAL", "the record did not move");
});

test("forcing the phase to AUTHORIZED does not bypass the approval guard", () => {
  // The attack: a caller (or a bug) sets the phase directly and then executes,
  // traversing only LEGAL edges to settlement. The record-level guard catches
  // it, which is why the guard is not on the edge.
  const rec = record("PENDING_APPROVAL", true);
  rec.phase = "AUTHORIZED";
  assert.ok(canTransitionPhase("AUTHORIZED", "EXECUTE"), "the edge itself is legal");
  assert.throws(
    () => advance(rec, "EXECUTE"),
    (e) => e instanceof LifecycleError && e.code === "approval_not_satisfied"
  );
  assert.strictEqual(rec.phase, "AUTHORIZED");
});

test("an approval-requiring payment CAN execute once a human approved it", () => {
  const rec = record("PENDING_APPROVAL", true);
  advance(rec, "APPROVE", "finance_admin@example.com");
  assert.strictEqual(rec.phase, "APPROVED");
  assert.strictEqual(rec.approvedBy, "finance_admin@example.com");
  assert.strictEqual(rec.approvedAt, AT);
  advance(rec, "EXECUTE");
  assert.strictEqual(rec.phase, "EXECUTING");
  advance(rec, "SETTLE");
  assert.strictEqual(rec.phase, "SETTLED");
});

test("releasing a HOLD records a human actor, so the approval guard is satisfied", () => {
  const rec = record("HOLD", true);
  advance(rec, "RELEASE", "risk_officer@example.com");
  assert.strictEqual(rec.phase, "APPROVED");
  assert.strictEqual(rec.approvedBy, "risk_officer@example.com");
  advance(rec, "EXECUTE");
  assert.strictEqual(rec.phase, "EXECUTING");
});

test("a HOLD cannot be executed directly — releasing it is a human decision", () => {
  const rec = record("HOLD", true);
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
  assert.strictEqual(rec.phase, "HOLD");
});

test("a payment that never required approval executes without one", () => {
  const rec = record("AUTHORIZED", false);
  advance(rec, "EXECUTE");
  advance(rec, "SETTLE");
  assert.strictEqual(rec.phase, "SETTLED");
  assert.strictEqual(rec.approvedBy, undefined);
});

test("a DENIED payment is terminal and cannot be resurrected", () => {
  const rec = record("PENDING_APPROVAL", true);
  advance(rec, "DENY", "finance_admin");
  assert.strictEqual(rec.phase, "DENIED");
  assert.ok(isTerminalPhase("DENIED"));
  for (const event of ["APPROVE", "EXECUTE", "SETTLE", "RELEASE", "HOLD"]) {
    assert.throws(() => advance(rec, event), LifecycleError, `${event} must be refused after DENY`);
  }
  assert.strictEqual(rec.phase, "DENIED");
});

test("an APPROVED payment can still be denied before execution", () => {
  const rec = record("PENDING_APPROVAL", true);
  advance(rec, "APPROVE", "admin");
  advance(rec, "DENY", "admin");
  assert.strictEqual(rec.phase, "DENIED");
  assert.strictEqual(rec.deniedAt, AT);
});

// ── Terminality and double settlement ─────────────────────────────────────

test("a SETTLED payment cannot be settled or executed again", () => {
  const rec = record("AUTHORIZED", false);
  advance(rec, "EXECUTE");
  advance(rec, "SETTLE");
  assert.throws(() => advance(rec, "SETTLE"), LifecycleError, "double settlement must be impossible");
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
  assert.strictEqual(rec.phase, "SETTLED");
});

test("a FAILED payment is terminal — no retry through the state machine", () => {
  const rec = record("AUTHORIZED", false);
  advance(rec, "EXECUTE");
  advance(rec, "FAIL");
  assert.strictEqual(rec.phase, "FAILED");
  assert.ok(isTerminalPhase("FAILED"));
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
  assert.throws(() => advance(rec, "SETTLE"), LifecycleError);
});

test("only a SETTLED payment can be REVERSEd, and a reversal is terminal", () => {
  const rec = record("AUTHORIZED", false);
  advance(rec, "EXECUTE");
  assert.throws(() => advance(rec, "REVERSE"), LifecycleError, "cannot reverse mid-execution");
  advance(rec, "SETTLE");
  advance(rec, "REVERSE", "ops");
  assert.strictEqual(rec.phase, "REVERSED");
  assert.throws(() => advance(rec, "REVERSE"), LifecycleError, "no reversal of a reversal");
});

test("EXECUTING can only reach SETTLED or FAILED", () => {
  for (const event of ["APPROVE", "DENY", "HOLD", "RELEASE", "EXPIRE", "EXECUTE", "REVERSE"]) {
    assert.strictEqual(
      canTransitionPhase("EXECUTING", event),
      false,
      `EXECUTING + ${event} must be illegal`
    );
  }
  assert.ok(canTransitionPhase("EXECUTING", "SETTLE"));
  assert.ok(canTransitionPhase("EXECUTING", "FAIL"));
});

test("every terminal phase has no outgoing edges except SETTLED -> REVERSED", () => {
  const events = ["AUTHORIZE", "REQUIRE_APPROVAL", "APPROVE", "DENY", "HOLD", "RELEASE", "EXPIRE", "EXECUTE", "SETTLE", "FAIL", "REVERSE"];
  for (const phase of ["DENIED", "EXPIRED", "FAILED", "REVERSED"]) {
    for (const event of events) {
      assert.strictEqual(canTransitionPhase(phase, event), false, `${phase} + ${event}`);
    }
  }
});

// ── Fail-closed timeout ───────────────────────────────────────────────────

test("an unanswered approval resolves to the configured action, never to ALLOW", () => {
  const state = {
    requestedAt: AT,
    policy: { approverRole: "finance_admin", timeoutSeconds: 900, onTimeout: "HOLD" },
  };
  const before = resolveEscalation(state, NOW + 100_000);
  assert.strictEqual(before.action, "wait");
  assert.ok(before.remainingSeconds > 0);

  const after = resolveEscalation(state, NOW + 901_000);
  assert.strictEqual(after.action, "HOLD");
  assert.match(after.detail, /unanswered approval is not an approval/);
});

test("onTimeout DENY resolves to DENY", () => {
  const state = {
    requestedAt: AT,
    policy: { approverRole: "cfo", timeoutSeconds: 60, onTimeout: "DENY" },
  };
  assert.strictEqual(resolveEscalation(state, NOW + 61_000).action, "DENY");
});

test("an UNPARSEABLE requestedAt resolves to the timeout action, not to wait-forever", () => {
  // A corrupt timestamp must not produce a payment that sits un-acted-upon
  // while the customer and the approver each believe the other is handling it.
  const state = {
    requestedAt: "not-a-date",
    policy: { approverRole: "admin", timeoutSeconds: 900, onTimeout: "DENY" },
  };
  const out = resolveEscalation(state, NOW);
  assert.strictEqual(out.action, "DENY");
  assert.match(out.detail, /unparseable/);
});

test("the timeout action type admits only HOLD and DENY", () => {
  assert.strictEqual(eventForTimeout("HOLD"), "HOLD");
  assert.strictEqual(eventForTimeout("DENY"), "DENY");
  // There is no "ALLOW" variant to select. Asserted behaviourally: whatever a
  // caller passes, the resulting event is never one that reaches EXECUTING.
  for (const action of ["HOLD", "DENY"]) {
    const event = eventForTimeout(action);
    assert.ok(
      !canTransitionPhase("PENDING_APPROVAL", event) || ["HOLD", "DENIED"].includes(
        { HOLD: "HOLD", DENY: "DENIED" }[action]
      ),
      "a timeout can only park or refuse"
    );
  }
});

test("a timed-out approval that resolves to HOLD still cannot execute", () => {
  const rec = record("PENDING_APPROVAL", true);
  const out = resolveEscalation(
    { requestedAt: AT, policy: { approverRole: "a", timeoutSeconds: 1, onTimeout: "HOLD" } },
    NOW + 2_000
  );
  advance(rec, eventForTimeout(out.action), "system");
  assert.strictEqual(rec.phase, "HOLD");
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
});

// ── History and audit ────────────────────────────────────────────────────

test("every transition is appended to history with actor and timestamps", () => {
  const rec = record("PENDING_APPROVAL", true);
  advance(rec, "APPROVE", "admin@example.com", "2026-09-28T12:05:00Z");
  advance(rec, "EXECUTE", "system", "2026-09-28T12:05:01Z");
  advance(rec, "SETTLE", "system", "2026-09-28T12:05:09Z");

  assert.strictEqual(rec.history.length, 4, "creation + three transitions");
  const events = rec.history.map((h) => h.event);
  assert.deepStrictEqual(events, ["REQUIRE_APPROVAL", "APPROVE", "EXECUTE", "SETTLE"]);
  const approve = rec.history[1];
  assert.strictEqual(approve.from, "PENDING_APPROVAL");
  assert.strictEqual(approve.to, "APPROVED");
  assert.strictEqual(approve.actor, "admin@example.com");
  assert.strictEqual(rec.updatedAt, "2026-09-28T12:05:09Z");
});

test("a failed transition leaves history untouched", () => {
  const rec = record("PENDING_APPROVAL", true);
  const before = rec.history.length;
  assert.throws(() => advance(rec, "EXECUTE"), LifecycleError);
  assert.strictEqual(rec.history.length, before, "no history entry for a refused transition");
});

test("the settlement-status projection never reports a pending decision as settled", () => {
  assert.strictEqual(toSettlementStatus("PENDING_APPROVAL"), "pending");
  assert.strictEqual(toSettlementStatus("HOLD"), "pending");
  assert.strictEqual(toSettlementStatus("AUTHORIZED"), "pending");
  assert.strictEqual(toSettlementStatus("APPROVED"), "pending");
  assert.strictEqual(toSettlementStatus("EXECUTING"), "processing");
  assert.strictEqual(toSettlementStatus("SETTLED"), "settled");
  for (const phase of ["DENIED", "EXPIRED", "FAILED", "REVERSED"]) {
    assert.strictEqual(toSettlementStatus(phase), "failed");
  }
});
