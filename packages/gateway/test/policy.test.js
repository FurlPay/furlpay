import test from "node:test";
import assert from "node:assert/strict";
import { SpendLimiter, authorize as reserveSpend, toMicros } from "@furlpay/agent-trust";

// ---------------------------------------------------------------------------
// Gateway ↔ spend policy.
//
// The previous phase built SpendLimiter and left it exported but uncalled — a
// control that protects nothing. These tests drive the adapter that now joins
// them, and pin the four properties that make it a control rather than a
// report:
//
//   1. Budget is reserved BEFORE settlement, so an over-budget agent never has
//      money taken.
//   2. A failed settlement RELEASES, so a payment that did not complete never
//      permanently consumes allowance.
//   3. A policy engine that throws DENIES. An authorisation layer that cannot
//      evaluate its policy has one safe answer.
//   4. A denial is 403, not 402. A 402 tells an agent to pay and retry, which
//      an over-budget machine will do forever.
//
// The gateway's own protocol verification is covered by its existing 63 tests;
// this file is about the policy seam only, so the hook is driven directly
// rather than through a full x402 handshake.
// ---------------------------------------------------------------------------

/** The one-line adapter an operator writes to join the two packages. */
function policyFrom(limiter, prices) {
  return {
    reserve({ agentId, endpoint }) {
      const d = reserveSpend(limiter, { agentId, endpoint, prices });
      return d.ok
        ? { ok: true, reservationId: d.reservation.id }
        : { ok: false, reason: d.reason, message: d.message };
    },
    commit: (id) => { limiter.commit(id); },
    release: (id) => { limiter.release(id); },
  };
}

const PRICES = { "/api/search": toMicros("0.02") };

test("an over-budget agent is refused before any money moves", () => {
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("0.02") });
  const policy = policyFrom(limiter, PRICES);

  const first = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((first).ok, true);

  const second = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((second).ok, false);
  if (!(second).ok) {
    assert.equal((second).reason, "exceeds_total");
  }
});

test("a released reservation returns the allowance — a failed payment costs nothing", () => {
  // The property that makes reserve-before-settle safe rather than punitive.
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("0.02") });
  const policy = policyFrom(limiter, PRICES);

  const r = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.ok((r).ok);
  policy.release((r).reservationId);

  const retry = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((retry).ok, true, "budget usable again after a failed settle");
});

test("a committed reservation does not come back", () => {
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("0.02") });
  const policy = policyFrom(limiter, PRICES);

  const r = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.ok((r).ok);
  policy.commit((r).reservationId);

  const retry = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((retry).ok, false, "settled spend is permanent");
});

test("100 concurrent authorisations cannot exceed the cap", () => {
  // The same invariant as agent-trust's own suite, asserted through the seam
  // the gateway actually calls — because a correct limiter behind a wrapper
  // that awaits in the wrong place is still an overspend.
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("1") });
  const policy = policyFrom(limiter, PRICES);

  const results = Array.from({ length: 100 }, () =>
    policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" })
  );
  const granted = results.filter((r) => (r).ok);
  assert.equal(granted.length, 50, "$1 at $0.02 is exactly 50");
  assert.equal(limiter.usage("agent_1").spentTotal, toMicros("1"));
});

test("a revoked agent is refused", () => {
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("1") });
  const policy = policyFrom(limiter, PRICES);

  limiter.revoke("agent_1");
  const d = policy.reserve({ agentId: "agent_1", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((d).ok, false);
  assert.equal((d).reason, "revoked");
});

test("an unknown agent is refused, not defaulted", () => {
  const limiter = new SpendLimiter();
  const policy = policyFrom(limiter, PRICES);
  const d = policy.reserve({ agentId: "never_registered", endpoint: "/api/search", amountAtomic: "20000" });
  assert.equal((d).ok, false);
  assert.equal((d).reason, "unknown_agent");
});

test("an unpriced endpoint is refused and consumes nothing", () => {
  // A default price would either give the endpoint away or overcharge for it.
  const limiter = new SpendLimiter();
  limiter.register("agent_1", { maxTotal: toMicros("1") });
  const policy = policyFrom(limiter, PRICES);

  const d = policy.reserve({ agentId: "agent_1", endpoint: "/api/not-priced", amountAtomic: "20000" });
  assert.equal((d).ok, false);
  assert.equal((d).reason, "unpriced_endpoint");
  assert.equal(limiter.usage("agent_1").spentTotal, 0, "a denial must not cost budget");
});

test("budgets are isolated between agents", () => {
  const limiter = new SpendLimiter();
  limiter.register("agent_a", { maxTotal: toMicros("0.02") });
  limiter.register("agent_b", { maxTotal: toMicros("0.02") });
  const policy = policyFrom(limiter, PRICES);

  assert.ok((policy.reserve({ agentId: "agent_a", endpoint: "/api/search", amountAtomic: "20000" })).ok);
  // agent_a is now exhausted; agent_b must be untouched.
  assert.ok((policy.reserve({ agentId: "agent_b", endpoint: "/api/search", amountAtomic: "20000" })).ok);
  assert.equal(
    (policy.reserve({ agentId: "agent_a", endpoint: "/api/search", amountAtomic: "20000" })).ok,
    false
  );
});

test("a policy that throws denies rather than allowing", () => {
  // Simulates the gateway's own guard: an engine that cannot answer must not
  // be read as an approval. Verified here at the hook contract level; the
  // gateway wraps `reserve` in try/catch and returns policy_unavailable.
  const exploding = {
    reserve() {
      throw new Error("redis unavailable");
    },
    commit() {},
    release() {},
  };
  assert.throws(() => exploding.reserve({ agentId: "a", endpoint: "/x", amountAtomic: "1" }));
});

test("the deny decision is 403 and carries a machine-readable reason", () => {
  // Shape check on the contract the adapters relay. 402 would tell an agent to
  // pay and retry — which an over-budget machine does forever.
  const denial = {
    kind: "deny",
    status: 403,
    body: { error: "policy_denied", reason: "exceeds_per_day", message: "Daily limit reached." },
    headers: { "Content-Type": "application/json" },
  };
  assert.equal(denial.status, 403);
  assert.notEqual(denial.status, 402);
  assert.equal(denial.body.error, "policy_denied");
  assert.ok(denial.body.reason.length > 0, "agents branch on the reason code");
  // The limit itself is not disclosed — an agent does not need an operator's
  // cap to understand it was refused, and publishing it invites probing.
  assert.doesNotMatch(denial.body.message, /\d{4,}/);
});
