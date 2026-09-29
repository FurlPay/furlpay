"use strict";
// ---------------------------------------------------------------------------
// Live revocation: fail-closed, staleness-bounded, cascading.
//
// The property under test is the one the whole control plane rests on:
//
//     A CRYPTOGRAPHICALLY VALID SIGNATURE IS NOT EVIDENCE THAT THE AUTHORITY
//     BEHIND IT STILL EXISTS.
//
// Each test below removes one thing an implementation might rely on — the store
// being reachable, the snapshot being fresh, the caller remembering to check an
// ancestor — and asserts the answer is still "no settlement".
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  evaluateRevocation,
  subjectsForPayment,
  DEFAULT_MAX_STALENESS_MS,
} = require("../dist/index.js");

const NOW = Date.parse("2026-09-28T12:00:00Z");
const ORG = "org_1";

function snapshot(entries = [], opts = {}) {
  return {
    ok: true,
    snapshot: {
      killSwitch: opts.killSwitch ?? { engaged: false, scope: "global" },
      entries,
      fetchedAtMs: opts.fetchedAtMs ?? NOW - 100,
    },
  };
}

const CHAIN = subjectsForPayment({
  organizationId: ORG,
  principalId: "prin_1",
  delegationId: "del_1",
  operatorId: "op_1",
  agentId: "agent_1",
  sessionId: "sess_1",
  mandateId: "mand_1",
  credentialId: "cred_1",
});

function evaluate(lookup, subjects = CHAIN, maxStalenessMs = DEFAULT_MAX_STALENESS_MS) {
  return evaluateRevocation({ lookup, subjects, organizationId: ORG, nowMs: NOW, maxStalenessMs });
}

// ── The happy path, so the denials below mean something ────────────────────

test("an intact chain with a fresh snapshot is live", () => {
  const v = evaluate(snapshot());
  assert.strictEqual(v.live, true);
  assert.strictEqual(v.checkedSubjects, 8);
  assert.ok(v.snapshotAgeMs >= 0);
});

// ── Fail closed ────────────────────────────────────────────────────────────

test("a FAILED LOOKUP denies — an unreadable store is never an empty revocation list", () => {
  const v = evaluate({ ok: false, error: "ECONNREFUSED redis:6379" });
  assert.strictEqual(v.live, false);
  assert.strictEqual(v.reason, "state_unavailable");
  assert.match(v.detail, /ECONNREFUSED/);
});

test("a STALE snapshot denies, even though it says nothing is revoked", () => {
  // This is the test that separates a revocation ENGINE from a revocation LIST.
  // A cache permitted to serve indefinitely while the source is unreachable has
  // exactly the same failure as not checking at all, only slower.
  const v = evaluate(snapshot([], { fetchedAtMs: NOW - (DEFAULT_MAX_STALENESS_MS + 1) }));
  assert.strictEqual(v.live, false);
  assert.strictEqual(v.reason, "state_stale");
});

test("a snapshot exactly at the staleness bound is still accepted", () => {
  const v = evaluate(snapshot([], { fetchedAtMs: NOW - DEFAULT_MAX_STALENESS_MS }));
  assert.strictEqual(v.live, true);
});

test("a snapshot from the FUTURE beyond the bound denies — clock skew is not freshness", () => {
  // Trusting a future-stamped reading would silently extend the staleness
  // window by however far the clocks disagree.
  const v = evaluate(snapshot([], { fetchedAtMs: NOW + DEFAULT_MAX_STALENESS_MS + 1 }));
  assert.strictEqual(v.live, false);
  assert.strictEqual(v.reason, "state_stale");
});

test("availability and staleness are checked BEFORE the kill switch", () => {
  // A snapshot we cannot trust cannot be trusted to report the switch is OFF.
  const v = evaluate({ ok: false, error: "timeout" });
  assert.strictEqual(v.reason, "state_unavailable");
  assert.notStrictEqual(v.reason, "kill_switch_engaged");
});

// ── Kill switch ────────────────────────────────────────────────────────────

test("the global kill switch denies every organization", () => {
  const v = evaluate(
    snapshot([], { killSwitch: { engaged: true, scope: "global", reason: "incident 2026-09-28" } })
  );
  assert.strictEqual(v.live, false);
  assert.strictEqual(v.reason, "kill_switch_engaged");
  assert.match(v.detail, /incident 2026-09-28/, "the operator's reason reaches the denial");
});

test("an organization kill switch denies only that organization", () => {
  const mine = evaluate(
    snapshot([], {
      killSwitch: { engaged: true, scope: "organization", organizationId: ORG, reason: "compromised key" },
    })
  );
  assert.strictEqual(mine.live, false);
  assert.strictEqual(mine.reason, "kill_switch_engaged");

  const other = evaluate(
    snapshot([], {
      killSwitch: { engaged: true, scope: "organization", organizationId: "org_other", reason: "x" },
    })
  );
  assert.strictEqual(other.live, true, "another org's switch must not stop us");
});

test("the kill switch is evaluated before any subject, so nothing can mask it", () => {
  const v = evaluate(
    snapshot([{ kind: "agent", id: "agent_1", revokedAt: "x", reason: "y", revokedBy: "z" }], {
      killSwitch: { engaged: true, scope: "global", reason: "halt" },
    })
  );
  assert.strictEqual(v.reason, "kill_switch_engaged");
});

// ── Cascade: every ancestor kills the payment ─────────────────────────────

const LINKS = [
  ["organization", ORG],
  ["principal", "prin_1"],
  ["delegation", "del_1"],
  ["operator", "op_1"],
  ["agent", "agent_1"],
  ["session", "sess_1"],
  ["mandate", "mand_1"],
  ["credential", "cred_1"],
];

for (const [kind, id] of LINKS) {
  test(`revoking the ${kind} denies the payment`, () => {
    const v = evaluate(
      snapshot([
        { kind, id, revokedAt: "2026-09-28T11:00:00Z", reason: `${kind} revoked in test`, revokedBy: "admin" },
      ])
    );
    assert.strictEqual(v.live, false, `${kind} revocation must deny`);
    assert.strictEqual(v.reason, "subject_revoked");
    assert.strictEqual(v.subject.kind, kind);
    assert.strictEqual(v.subject.id, id);
    assert.strictEqual(v.revokedAt, "2026-09-28T11:00:00Z");
  });
}

test("subjectsForPayment includes every link, so a caller cannot omit one", () => {
  // The omission this guards against is invisible in review: a shorter list
  // looks like a shorter list, not like a missing control.
  const kinds = CHAIN.map((s) => s.kind);
  for (const [kind] of LINKS) {
    assert.ok(kinds.includes(kind), `subjectsForPayment must include ${kind}`);
  }
});

test("optional links are omitted when absent rather than defaulted", () => {
  const minimal = subjectsForPayment({
    organizationId: ORG,
    principalId: "prin_1",
    delegationId: "del_1",
    operatorId: "op_1",
    agentId: "agent_1",
    mandateId: "mand_1",
  });
  const kinds = minimal.map((s) => s.kind);
  assert.ok(!kinds.includes("session"));
  assert.ok(!kinds.includes("credential"));
  assert.strictEqual(minimal.length, 6);
});

// ── Kind/id namespacing ───────────────────────────────────────────────────

test("a revoked MANDATE does not revoke an AGENT that shares its id", () => {
  // Matching on the bare id would revoke unrelated objects whose ids collide.
  const subjects = [
    { kind: "agent", id: "shared_id" },
    { kind: "mandate", id: "other" },
  ];
  const v = evaluate(
    snapshot([{ kind: "mandate", id: "shared_id", revokedAt: "x", reason: "r", revokedBy: "z" }]),
    subjects
  );
  assert.strictEqual(v.live, true, "a mandate revocation must not match an agent id");
});

// ── The race the architecture document names ──────────────────────────────

test("RACE: revoked between authorization and signing — the signing-time check denies", () => {
  // Authorization succeeds against a snapshot where nothing is revoked.
  const atAuthorize = evaluate(snapshot([], { fetchedAtMs: NOW - 200 }));
  assert.strictEqual(atAuthorize.live, true);

  // The mandate is then revoked. Execution performs its OWN fresh check, which
  // is the only reason this is caught: an authorization decision cached from a
  // moment ago is not a statement about now.
  const laterMs = NOW + 1_000;
  const atSigning = evaluateRevocation({
    lookup: snapshot([{ kind: "mandate", id: "mand_1", revokedAt: "2026-09-28T12:00:00.500Z", reason: "project ended", revokedBy: "admin" }], {
      fetchedAtMs: laterMs - 50,
    }),
    subjects: CHAIN,
    organizationId: ORG,
    nowMs: laterMs,
    maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
  });
  assert.strictEqual(atSigning.live, false);
  assert.strictEqual(atSigning.reason, "subject_revoked");
  assert.strictEqual(atSigning.subject.kind, "mandate");
});

test("RACE: revocation store goes down between authorization and signing — signing denies", () => {
  const atAuthorize = evaluate(snapshot());
  assert.strictEqual(atAuthorize.live, true);
  const atSigning = evaluate({ ok: false, error: "store unavailable" });
  assert.strictEqual(atSigning.live, false);
  assert.strictEqual(atSigning.reason, "state_unavailable");
});

test("a tighter staleness bound can be demanded for a sensitive operation", () => {
  const s = snapshot([], { fetchedAtMs: NOW - 3_000 });
  assert.strictEqual(evaluate(s, CHAIN, 5_000).live, true);
  assert.strictEqual(evaluate(s, CHAIN, 1_000).live, false, "1s bound rejects a 3s-old snapshot");
});

test("an empty subject list is reported as zero checks, not as a pass", () => {
  // Present so that a caller passing nothing is visible in the evidence bundle
  // rather than silently recorded as a successful revocation check.
  const v = evaluate(snapshot(), []);
  assert.strictEqual(v.live, true);
  assert.strictEqual(v.checkedSubjects, 0);
});
