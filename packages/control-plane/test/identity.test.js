"use strict";
// ---------------------------------------------------------------------------
// The delegation chain (KYA).
//
// THE PROPERTY UNDER TEST:
//
//     AUTHORITY IS THE INTERSECTION OF THE CHAIN, NEVER THE UNION.
//
// No link may widen what an ancestor granted. The alternative — each link
// carrying independent limits — makes a compromised agent record a self-service
// permission grant, which is the whole reason the chain exists.
//
// Second property: A BROKEN LINK IS A DENIAL, NOT A SKIP. Resolution never falls
// back to the nearest intact ancestor, because "the delegation expired so we
// used the principal's limits" is an unbounded agent.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const { resolveAuthority, narrowScope, scopeWellFormed, attestationRank } = require("../dist/index.js");

const NOW = Date.parse("2026-09-28T12:00:00Z");
const USDC = (m) => String(Math.round(m * 1e6));

function chain(overrides = {}) {
  return {
    principal: overrides.principal === null ? null : {
      principalId: "prin_1",
      organizationId: "org_1",
      kind: "entity",
      status: "ACTIVE",
      verification: "verified",
      createdAt: "2026-01-01T00:00:00Z",
      ...(overrides.principal ?? {}),
    },
    delegation: overrides.delegation === null ? null : {
      delegationId: "del_1",
      principalId: "prin_1",
      operatorId: "op_1",
      onBehalfOf: "employee@example.com",
      status: "ACTIVE",
      scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), spendingWindowSeconds: 86400 },
      issuedAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-12-01T00:00:00Z",
      ...(overrides.delegation ?? {}),
    },
    operator: overrides.operator === null ? null : {
      operatorId: "op_1",
      organizationId: "org_1",
      name: "Acme Agents",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00Z",
      ...(overrides.operator ?? {}),
    },
    agent: overrides.agent === null ? null : {
      agentId: "agent_1",
      principalId: "prin_1",
      operatorId: "op_1",
      organizationId: "org_1",
      name: "research-crawler",
      status: "ACTIVE",
      scope: {},
      createdAt: "2026-09-01T00:00:00Z",
      ...(overrides.agent ?? {}),
    },
    session: overrides.session === null ? null : {
      sessionId: "sess_1",
      agentId: "agent_1",
      status: "ACTIVE",
      attestation: { kind: "tee", measurement: "pcr0" },
      startedAt: "2026-09-28T11:00:00Z",
      ...(overrides.session ?? {}),
    },
    nowMs: overrides.nowMs ?? NOW,
    requireVerifiedPrincipal: overrides.requireVerifiedPrincipal ?? true,
  };
}

test("an intact chain resolves and reports every link", () => {
  const out = resolveAuthority(chain());
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.authority.chain, ["prin_1", "del_1", "op_1", "agent_1", "sess_1"]);
  assert.strictEqual(out.authority.attestation, "tee");
  assert.strictEqual(out.authority.organizationId, "org_1");
});

// ── Intersection never widens ─────────────────────────────────────────────

test("an agent CANNOT widen its delegation's per-transaction cap", () => {
  const out = resolveAuthority(
    chain({ agent: { scope: { maxAmountPerTxAtomic: USDC(5000) } } })
  );
  assert.strictEqual(out.ok, true);
  assert.strictEqual(
    out.authority.scope.maxAmountPerTxAtomic,
    USDC(50),
    "the tighter (delegation) ceiling must win"
  );
});

test("an agent CAN narrow its delegation's cap", () => {
  const out = resolveAuthority(chain({ agent: { scope: { maxAmountPerTxAtomic: USDC(10) } } }));
  assert.strictEqual(out.authority.scope.maxAmountPerTxAtomic, USDC(10));
});

test("a session narrows further still, and cannot widen either", () => {
  const out = resolveAuthority(
    chain({
      agent: { scope: { maxAmountPerTxAtomic: USDC(30) } },
      session: { scope: { maxAmountPerTxAtomic: USDC(5) } },
    })
  );
  assert.strictEqual(out.authority.scope.maxAmountPerTxAtomic, USDC(5));

  const widening = resolveAuthority(
    chain({
      agent: { scope: { maxAmountPerTxAtomic: USDC(30) } },
      session: { scope: { maxAmountPerTxAtomic: USDC(9999) } },
    })
  );
  assert.strictEqual(widening.authority.scope.maxAmountPerTxAtomic, USDC(30));
});

test("the approval threshold takes the MINIMUM — a child cannot escape its parent's approval", () => {
  // Easy to get backwards: a LOWER threshold means MORE payments see a human, so
  // the minimum is the conservative direction. Taking the maximum would let an
  // agent raise the bar and avoid approval its principal wanted.
  const out = resolveAuthority(
    chain({
      delegation: {
        scope: {
          currency: "USDC",
          maxAmountPerTxAtomic: USDC(50),
          maxCumulativeAtomic: USDC(500),
          requireHumanApprovalAboveAtomic: USDC(100),
        },
      },
      agent: { scope: { requireHumanApprovalAboveAtomic: USDC(400) } },
    })
  );
  assert.strictEqual(out.authority.scope.requireHumanApprovalAboveAtomic, USDC(100));
});

test("merchant allowlists INTERSECT — an agent cannot add a merchant", () => {
  const out = resolveAuthority(
    chain({
      delegation: {
        scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), allowedMerchantDomains: ["a.com", "b.com"] },
      },
      agent: { scope: { allowedMerchantDomains: ["b.com", "evil.com"] } },
    })
  );
  assert.deepStrictEqual(out.authority.scope.allowedMerchantDomains, ["b.com"]);
});

test("an EMPTY allowlist on a child denies everything, and is not treated as absent", () => {
  const out = resolveAuthority(
    chain({
      delegation: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), allowedMerchantDomains: ["a.com"] } },
      agent: { scope: { allowedMerchantDomains: [] } },
    })
  );
  assert.deepStrictEqual(out.authority.scope.allowedMerchantDomains, [], "[] must survive as []");
});

test("blocked jurisdictions UNION — anything either link blocks stays blocked", () => {
  const out = resolveAuthority(
    chain({
      delegation: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), blockedJurisdictions: ["IR"] } },
      agent: { scope: { blockedJurisdictions: ["KP"] } },
    })
  );
  assert.deepStrictEqual([...out.authority.scope.blockedJurisdictions].sort(), ["IR", "KP"]);
});

test("attestation requirements only ratchet UP", () => {
  const raised = narrowScope({ minAttestation: "key_only" }, { minAttestation: "tee" });
  assert.strictEqual(raised.scope.minAttestation, "tee");
  const lowered = narrowScope({ minAttestation: "tee" }, { minAttestation: "none" });
  assert.strictEqual(lowered.scope.minAttestation, "tee", "a child may not lower the bar");
  assert.ok(attestationRank("tee") > attestationRank("passkey"));
  assert.ok(attestationRank("passkey") > attestationRank("key_only"));
  assert.ok(attestationRank("key_only") > attestationRank("none"));
});

test("a currency mismatch is a CONFLICT, not a narrowing", () => {
  // Two currencies do not intersect to one of them. Returning either would let a
  // child re-denominate its parent's cap.
  const out = narrowScope({ currency: "USDC" }, { currency: "EURC" });
  assert.strictEqual(out.ok, false);
  assert.match(out.conflict, /not permitted by the parent scope/);
});

test("a scope conflict breaks the chain rather than resolving to something", () => {
  const out = resolveAuthority(chain({ agent: { scope: { currency: "EURC" } } }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.break, "scope_conflict");
  assert.match(out.detail, /agent:/);
});

// ── Every break ───────────────────────────────────────────────────────────

const BREAKS = [
  ["principal_missing", { principal: null }],
  ["principal_inactive", { principal: { status: "REVOKED" } }],
  ["principal_unverified", { principal: { verification: "pending" } }],
  ["delegation_missing", { delegation: null }],
  ["delegation_inactive", { delegation: { status: "SUSPENDED" } }],
  ["delegation_expired", { delegation: { expiresAt: "2026-09-01T00:00:00Z" } }],
  ["delegation_principal_mismatch", { delegation: { principalId: "prin_other" } }],
  ["operator_missing", { operator: null }],
  ["operator_inactive", { operator: { status: "REVOKED" } }],
  ["operator_delegation_mismatch", { operator: { operatorId: "op_other" } }],
  ["agent_missing", { agent: null }],
  ["agent_inactive", { agent: { status: "REVOKED" } }],
  ["agent_expired", { agent: { expiresAt: "2026-09-01T00:00:00Z" } }],
  ["agent_principal_mismatch", { agent: { principalId: "prin_other" } }],
  ["agent_operator_mismatch", { agent: { operatorId: "op_other" } }],
  ["session_inactive", { session: { status: "REVOKED" } }],
  ["session_expired", { session: { expiresAt: "2026-09-28T11:30:00Z" } }],
  ["session_agent_mismatch", { session: { agentId: "agent_other" } }],
];

for (const [expected, override] of BREAKS) {
  test(`a broken chain reports ${expected} and never resolves`, () => {
    const out = resolveAuthority(chain(override));
    assert.strictEqual(out.ok, false, `${expected} must not resolve`);
    assert.strictEqual(out.break, expected);
    assert.ok(out.detail && out.detail.length > 3, "the break explains itself");
  });
}

test("insufficient attestation breaks the chain", () => {
  const out = resolveAuthority(
    chain({
      delegation: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), minAttestation: "tee" } },
      session: { attestation: { kind: "key_only" } },
    })
  );
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.break, "attestation_insufficient");
});

test("a revoked principal reports principal_inactive, NOT attestation_insufficient", () => {
  // Ordering matters: a denial reason that invites the caller to fix the
  // attestation, when the real problem is a revoked principal, is a reason that
  // sends them down a path that cannot succeed.
  const out = resolveAuthority(
    chain({
      principal: { status: "REVOKED" },
      delegation: { scope: { currency: "USDC", maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500), minAttestation: "tee" } },
      session: { attestation: { kind: "none" } },
    })
  );
  assert.strictEqual(out.break, "principal_inactive");
});

test("an agent may act with no session, and then attestation is key_only", () => {
  const out = resolveAuthority(chain({ session: null }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.authority.attestation, "key_only");
  assert.strictEqual(out.authority.sessionId, undefined);
  assert.strictEqual(out.authority.chain.length, 4);
});

test("a sandbox organization may resolve an unverified principal when permitted", () => {
  const out = resolveAuthority(chain({ principal: { verification: "pending" }, requireVerifiedPrincipal: false }));
  assert.strictEqual(out.ok, true);
});

// ── Scope well-formedness, enforced at write time ────────────────────────

test("an incoherent scope is rejected before anything can rely on it", () => {
  assert.strictEqual(scopeWellFormed({ maxAmountPerTxAtomic: "0" }).ok, false);
  assert.strictEqual(scopeWellFormed({ maxAmountPerTxAtomic: "-5" }).ok, false);
  assert.strictEqual(scopeWellFormed({ maxAmountPerTxAtomic: "1.5" }).ok, false);
  assert.strictEqual(scopeWellFormed({ spendingWindowSeconds: 0 }).ok, false);
  const inverted = scopeWellFormed({ maxAmountPerTxAtomic: USDC(1000), maxCumulativeAtomic: USDC(100) });
  assert.strictEqual(inverted.ok, false);
  assert.match(inverted.reason, /can never bind/);
  assert.strictEqual(scopeWellFormed({ maxAmountPerTxAtomic: USDC(50), maxCumulativeAtomic: USDC(500) }).ok, true);
});
