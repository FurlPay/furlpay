import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IntentTransitionError,
  canTransition,
  createIntent,
  isAtomicAmount,
  isExpired,
  isKeyReuse,
  isTerminal,
  matches,
  mayHaveTouchedChain,
  needsRelease,
  recoveryFor,
  sumAtomic,
  transition,
  type IntentState,
  type PaymentIntent,
} from "../src/intent.js";

// ---------------------------------------------------------------------------
// PaymentIntent.
//
// Two properties matter more than everything else here, and both are about
// what happens when an HTTP response is lost:
//
//   UNKNOWN IS NEITHER SUCCESS NOR FAILURE. An RPC timeout tells you nothing
//   about the chain, and a machine that resolves it by assuming will either
//   tell a paying customer their money vanished or hand out a paid resource
//   for nothing.
//
//   ANYTHING THAT MIGHT HAVE TOUCHED THE CHAIN RECONCILES. A retry that signs
//   a fresh payment because it could not find a verdict is the double charge
//   this whole record exists to prevent.
// ---------------------------------------------------------------------------

const ALL: IntentState[] = [
  "CREATED", "POLICY_CHECKED", "BUDGET_RESERVED", "PAYMENT_REQUIRED",
  "PAYMENT_SUBMITTED", "PAYMENT_OBSERVED", "PAYMENT_CONFIRMED", "SETTLED",
  "COMMITTED", "POLICY_DENIED", "BUDGET_DENIED", "EXPIRED",
  "PAYMENT_REJECTED", "PAYMENT_FAILED", "SETTLEMENT_FAILED", "PAYMENT_UNKNOWN",
];

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    ...createIntent({
      paymentIntentId: "pi_1",
      principalId: "prin_1",
      agentId: "agent_1",
      requestId: "req_1",
      idempotencyKey: "key_1",
      requestHash: "hash_1",
      merchant: "api.example.com",
      resource: "/v1/search",
      endpoint: "/v1/search",
      amountAtomic: "1000",
      currency: "USDC",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      network: "solana",
      payee: "merchant_pubkey",
      ttlSeconds: 300,
      now: () => 1_000_000,
    }),
    ...over,
  };
}

// ── money ──────────────────────────────────────────────────────────────────

test("amounts are integer atomic units, and nothing else is accepted", () => {
  for (const ok of ["0", "1", "1000", "9007199254740993"]) {
    assert.equal(isAtomicAmount(ok), true, `${ok} should be valid`);
  }
  // Each of these would compare or sum wrongly somewhere downstream.
  for (const bad of ["0.001", "1e6", "-1", "01", "", " 1", "1.0", "1_000"]) {
    assert.equal(isAtomicAmount(bad), false, `${bad} should be refused`);
  }
});

test("a non-atomic amount is refused at construction, not at settlement", () => {
  assert.throws(
    () => intent({}) && createIntent({ ...baseInput(), amountAtomic: "0.001" }),
    RangeError
  );
});
function baseInput() {
  return {
    paymentIntentId: "pi_x", principalId: "p", agentId: "a", requestId: "r",
    idempotencyKey: "k", requestHash: "h", merchant: "m", resource: "/x",
    endpoint: "/x", amountAtomic: "1", currency: "USDC", asset: "mint",
    network: "solana", payee: "payee", ttlSeconds: 60,
  };
}

test("sums stay exact past 2^53, where a JS number silently stops being one", () => {
  // ~9 billion USDC atomic units is inside a treasury's annual range.
  assert.equal(sumAtomic(["9007199254740992", "1"]), "9007199254740993");
  assert.equal(sumAtomic([]), "0");
  assert.equal(sumAtomic(["1000", "2000", "3"]), "3003");
});

// ── the state machine ──────────────────────────────────────────────────────

test("the happy path is walkable end to end", () => {
  const path: IntentState[] = [
    "POLICY_CHECKED", "BUDGET_RESERVED", "PAYMENT_REQUIRED", "PAYMENT_SUBMITTED",
    "PAYMENT_OBSERVED", "PAYMENT_CONFIRMED", "SETTLED", "COMMITTED",
  ];
  let i = intent();
  for (const next of path) i = transition(i, next);
  assert.equal(i.state, "COMMITTED");
  assert.equal(isTerminal(i.state), true);
});

test("illegal transitions throw rather than silently doing nothing", () => {
  // A no-op would leave a caller believing the move happened.
  assert.throws(() => transition(intent(), "SETTLED"), IntentTransitionError);
  assert.throws(() => transition(intent({ state: "COMMITTED" }), "SETTLED"), IntentTransitionError);
  assert.throws(() => transition(intent({ state: "PAYMENT_CONFIRMED" }), "CREATED"), IntentTransitionError);
});

test("terminal states are terminal", () => {
  for (const t of ALL.filter(isTerminal)) {
    for (const to of ALL) {
      assert.equal(canTransition(t, to), false, `${t} -> ${to} must be refused`);
    }
  }
});

test("payments never move backwards, except out of UNKNOWN", () => {
  // UNKNOWN is the one state that exists to be resolved later, so it is the
  // one state with edges that look like going back.
  const order = ALL.filter((s) => !isTerminal(s) && s !== "PAYMENT_UNKNOWN");
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      assert.equal(canTransition(order[i]!, order[j]!), false, `${order[i]} -> ${order[j]}`);
    }
  }
  assert.equal(canTransition("PAYMENT_UNKNOWN", "PAYMENT_OBSERVED"), true);
  assert.equal(canTransition("PAYMENT_UNKNOWN", "PAYMENT_CONFIRMED"), true);
});

test("a confirmed payment can still fail to settle", () => {
  // Forbidding this would force the machine to lie when a rail rejects after
  // the transfer has already confirmed on chain.
  assert.equal(canTransition("PAYMENT_CONFIRMED", "SETTLEMENT_FAILED"), true);
  assert.equal(canTransition("SETTLED", "SETTLEMENT_FAILED"), true);
});

// ── UNKNOWN ────────────────────────────────────────────────────────────────

test("UNKNOWN is reachable from every state where bytes are on the wire", () => {
  for (const s of ["PAYMENT_SUBMITTED", "PAYMENT_OBSERVED", "PAYMENT_CONFIRMED"] as const) {
    assert.equal(canTransition(s, "PAYMENT_UNKNOWN"), true, `${s} must be able to become unknown`);
  }
});

test("UNKNOWN is not terminal, and is not a failure", () => {
  assert.equal(isTerminal("PAYMENT_UNKNOWN"), false);
  assert.notEqual("PAYMENT_UNKNOWN" as IntentState, "PAYMENT_FAILED" as IntentState);
  // It can resolve either way once evidence arrives — that is the whole point.
  assert.equal(canTransition("PAYMENT_UNKNOWN", "PAYMENT_CONFIRMED"), true);
  assert.equal(canTransition("PAYMENT_UNKNOWN", "PAYMENT_FAILED"), true);
});

test("UNKNOWN cannot jump straight to SETTLED or COMMITTED", () => {
  // Resolving uncertainty into success without observing the chain is the
  // exact failure this state exists to prevent.
  assert.equal(canTransition("PAYMENT_UNKNOWN", "SETTLED"), false);
  assert.equal(canTransition("PAYMENT_UNKNOWN", "COMMITTED"), false);
});

// ── crash recovery ─────────────────────────────────────────────────────────

test("a retry reconciles rather than re-paying, once a signature exists", () => {
  // The scenario: broadcast succeeded, the process died before responding.
  const crashed = intent({
    state: "PAYMENT_SUBMITTED",
    transactionSignature: "5xk2realSignature",
  });
  const r = recoveryFor(crashed);
  assert.equal(r.action, "reconcile");
  assert.equal(r.action === "reconcile" && r.signature, "5xk2realSignature");
});

test("an UNKNOWN intent with a signature reconciles — never restarts", () => {
  // The most dangerous case. "We do not know" plus "restart" is a double
  // charge.
  const r = recoveryFor(intent({ state: "PAYMENT_UNKNOWN", transactionSignature: "sig" }));
  assert.equal(r.action, "reconcile");
});

test("even a stored FAILED verdict is re-checked against the chain", () => {
  // The verdict was written by a process that then crashed; the chain is
  // cheaper to trust than that process's last words.
  const r = recoveryFor(intent({ state: "PAYMENT_FAILED", transactionSignature: "sig" }));
  assert.equal(r.action, "reconcile");
});

test("a committed intent replays and charges nothing", () => {
  assert.equal(recoveryFor(intent({ state: "COMMITTED" })).action, "replay");
});

test("restart is offered only where no signature can exist", () => {
  for (const s of ["POLICY_DENIED", "BUDGET_DENIED", "EXPIRED", "PAYMENT_REJECTED"] as const) {
    assert.equal(recoveryFor(intent({ state: s })).action, "restart", `${s} is safe to restart`);
  }
});

test("an in-flight intent with no signature is neither replayed nor restarted", () => {
  assert.equal(recoveryFor(intent({ state: "BUDGET_RESERVED" })).action, "in_progress");
});

test("the signature is write-once", () => {
  // Overwriting it discards evidence of a broadcast that may still be sitting
  // in a block — the evidence a retry needs in order not to pay twice.
  const submitted = transition(
    transition(transition(transition(intent(), "POLICY_CHECKED"), "BUDGET_RESERVED"), "PAYMENT_REQUIRED"),
    "PAYMENT_SUBMITTED",
    { transactionSignature: "first" }
  );
  assert.throws(
    () => transition(submitted, "PAYMENT_OBSERVED", { transactionSignature: "second" }),
    /refusing to overwrite/
  );
  // Restating the same signature is fine — a retry may repeat itself.
  assert.doesNotThrow(() =>
    transition(submitted, "PAYMENT_OBSERVED", { transactionSignature: "first" })
  );
});

test("transitions are immutable", () => {
  const before = intent();
  const after = transition(before, "POLICY_CHECKED");
  assert.equal(before.state, "CREATED", "the original is untouched");
  assert.equal(after.state, "POLICY_CHECKED");
  assert.notEqual(before, after);
});

// ── idempotency matching ───────────────────────────────────────────────────

test("a match needs principal AND key AND request hash", () => {
  const i = intent();
  assert.equal(matches(i, { principalId: "prin_1", idempotencyKey: "key_1", requestHash: "hash_1" }), true);
  // Key alone collides across tenants.
  assert.equal(matches(i, { principalId: "other", idempotencyKey: "key_1", requestHash: "hash_1" }), false);
  // Key + principal replays the wrong result for a different request.
  assert.equal(matches(i, { principalId: "prin_1", idempotencyKey: "key_1", requestHash: "other" }), false);
});

test("same key with a different body is reuse, not a match", () => {
  // The case that hands somebody a $100 receipt for a $1,000 payment.
  const i = intent();
  const probe = { principalId: "prin_1", idempotencyKey: "key_1", requestHash: "different" };
  assert.equal(isKeyReuse(i, probe), true);
  assert.equal(matches(i, probe), false);
});

test("the same key under two principals is not reuse", () => {
  const i = intent();
  const probe = { principalId: "prin_2", idempotencyKey: "key_1", requestHash: "anything" };
  assert.equal(isKeyReuse(i, probe), false);
  assert.equal(matches(i, probe), false);
});

// ── budget hygiene ─────────────────────────────────────────────────────────

test("abandoning an in-flight intent releases its budget", () => {
  assert.equal(needsRelease(intent({ state: "BUDGET_RESERVED", reservationId: "r1" })), true);
  assert.equal(needsRelease(intent({ state: "PAYMENT_UNKNOWN", reservationId: "r1" })), true);
});

test("a committed intent does not release — that would refund spent money", () => {
  assert.equal(needsRelease(intent({ state: "COMMITTED", reservationId: "r1" })), false);
});

test("an intent that never reserved has nothing to release", () => {
  assert.equal(needsRelease(intent({ state: "POLICY_DENIED", reservationId: null })), false);
});

test("expiry is read from the clock, not assumed", () => {
  const i = intent();
  assert.equal(isExpired(i, 1_000_000), false);
  assert.equal(isExpired(i, 1_000_000 + 301_000), true);
});

test("mayHaveTouchedChain is true for every post-broadcast state", () => {
  // The predicate recoveryFor depends on. A false negative here is a double
  // charge, so it is asserted directly rather than only through recovery.
  for (const s of ["PAYMENT_SUBMITTED", "PAYMENT_OBSERVED", "PAYMENT_CONFIRMED",
                   "PAYMENT_UNKNOWN", "SETTLED", "COMMITTED", "SETTLEMENT_FAILED",
                   "PAYMENT_FAILED"] as const) {
    assert.equal(mayHaveTouchedChain(s), true, `${s} may have a signature`);
  }
  for (const s of ["CREATED", "POLICY_CHECKED", "BUDGET_RESERVED", "PAYMENT_REQUIRED",
                   "POLICY_DENIED", "BUDGET_DENIED", "PAYMENT_REJECTED"] as const) {
    assert.equal(mayHaveTouchedChain(s), false, `${s} cannot have a signature`);
  }
});
