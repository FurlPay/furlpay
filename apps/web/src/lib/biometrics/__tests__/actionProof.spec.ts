import { describe, expect, it } from "vitest";
import {
  canonicalJSON,
  computeActionDigest,
  validateAndConsumeActionProof,
  type ActionProofRecord,
  type CanonicalJSON,
} from "../actionProof";
import { kvSet, kvGet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Action-bound step-up proofs.
//
// WHAT WAS WRONG. The iOS Guardian app gates every money-moving action behind
// Face ID, via `BiometricGate`, which returns a local Bool from LAContext.
// Nothing about it reached the server. Measured across all seven endpoints
// Guardian can dispatch to — /payments/create, /swaps, /investing/order,
// /investing/schedule, /earn/deposit, /cards/settings, /support/tickets — there
// was zero enforced step-up, zero biometric proof and zero MFA. A bearer token
// alone authorised a $25,000 investing order.
//
// So the Face ID sheet was decorative. A patched client, a stolen token or a
// replayed request skipped it entirely and left no server-side trace that it had
// been skipped.
//
// The first block below is the attack the binding has to defeat, expressed the
// same way biometricPay.spec.ts expresses its own: approve one thing, submit
// another. If any of those pass, this module is theatre.
// ---------------------------------------------------------------------------

const PROOF_PREFIX = "act:proof:";
const USER = "user_action_test";

const ORDER_ENDPOINT = "/investing/order";
const APPROVED_BODY = { symbol: "AAPL", side: "buy", quantity: 1, amountUsd: 230 };

/**
 * Mint a proof the way `verifyActionStepUpAssertion` does, without an
 * authenticator. The signature ceremony is @simplewebauthn's job and is not what
 * is under test; what is under test is what happens at SPEND time.
 */
async function mintProof(
  opts: {
    endpoint?: string;
    method?: string;
    body?: Record<string, CanonicalJSON>;
    userId?: string;
    nonce?: string;
    ttlMs?: number;
  } = {}
): Promise<string> {
  const userId = opts.userId ?? USER;
  const endpoint = opts.endpoint ?? ORDER_ENDPOINT;
  const method = opts.method ?? "POST";
  const body = opts.body ?? APPROVED_BODY;
  const nonce = opts.nonce ?? "nonce-fixed-for-test";
  const proofId = `act_proof_${Math.random().toString(16).slice(2)}${Date.now()}`;

  const record: ActionProofRecord = {
    proofId,
    userId,
    actionDigest: computeActionDigest({ userId, endpoint, method, body }, nonce),
    nonce,
    endpoint,
    method: method.toUpperCase(),
    credentialId: "cred_test",
    verifiedAt: Date.now(),
    expiresAt: Date.now() + (opts.ttlMs ?? 120_000),
  };

  await kvSet(`${PROOF_PREFIX}${proofId}`, record, 120);
  return proofId;
}

describe("the substitution attack", () => {
  it("refuses a larger quantity than was approved", async () => {
    // The exploit in its plainest form: the user saw "buy 1 AAPL" above Face ID.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: 1000, amountUsd: 230_000 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/different request/i);
  });

  it("refuses a different symbol", async () => {
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, symbol: "GME" },
    });
    expect(result.valid).toBe(false);
  });

  it("refuses a flipped side", async () => {
    // buy -> sell is the whole position, not a detail.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, side: "sell" },
    });
    expect(result.valid).toBe(false);
  });

  it("refuses the SAME body sent to a different endpoint", async () => {
    // A proof for an investing order must not authorise a swap. Binding only the
    // body would let one approval travel between routes.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: "/swaps",
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(false);
  });

  it("refuses a different method on the same endpoint", async () => {
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "DELETE",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(false);
  });

  it("refuses an ADDED field the user never saw", async () => {
    // The subtle one. Every approved field is untouched and a new one is
    // appended — so a binding that checked only the fields it knew about would
    // pass this, and the extra field could be anything the route honours.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, overrideLimit: true },
    });
    expect(result.valid).toBe(false);
  });

  it("refuses a REMOVED field", async () => {
    const { amountUsd, ...withoutAmount } = APPROVED_BODY;
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: withoutAmount,
    });
    expect(result.valid).toBe(false);
  });

  it("refuses a numeric string where a number was approved", async () => {
    // "1" and 1 are different bodies. A digest computed over a loosely-coerced
    // value would treat them as the same approval.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: "1" },
    });
    expect(result.valid).toBe(false);
  });
});

describe("the approved request", () => {
  it("is accepted", async () => {
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result).toEqual({ valid: true });
  });

  it("is accepted with keys in a different order", async () => {
    // The client and the route need not agree on key order — only on content.
    // Without canonical sorting every proof would be rejected as tampering and
    // the control would have to be turned off to ship.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { amountUsd: 230, quantity: 1, side: "buy", symbol: "AAPL" },
    });
    expect(result.valid).toBe(true);
  });

  it("is accepted with a lower-case method", async () => {
    const proofId = await mintProof({ method: "post" });
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(true);
  });

  it("is accepted for a nested body", async () => {
    const body = {
      order: { symbol: "AAPL", legs: [{ side: "buy", qty: 1 }] },
      idempotencyKey: "abc",
    };
    const proofId = await mintProof({ body });
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { idempotencyKey: "abc", order: { legs: [{ qty: 1, side: "buy" }], symbol: "AAPL" } },
    });
    expect(result.valid).toBe(true);
  });

  it("refuses a reordered ARRAY", async () => {
    // Arrays are ordered and must stay ordered: two legs swapped is a different
    // order, not the same one written differently.
    const body = { legs: [{ side: "buy" }, { side: "sell" }] };
    const proofId = await mintProof({ body });
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { legs: [{ side: "sell" }, { side: "buy" }] },
    });
    expect(result.valid).toBe(false);
  });
});

describe("single use", () => {
  it("cannot be replayed, even with the correct body", async () => {
    const proofId = await mintProof();
    const first = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(first.valid).toBe(true);

    const second = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(second.valid).toBe(false);
    expect(second.reason).toMatch(/expired or already used/i);
  });

  it("is burned even when the body does NOT match", async () => {
    // Otherwise an attacker retries with a mutated body until one hashes right —
    // an offline-ish oracle against a live proof. One attempt per proof.
    const proofId = await mintProof();
    await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: 999 },
    });
    expect(await kvGet(`${PROOF_PREFIX}${proofId}`)).toBeNull();

    // And the correct body no longer works either.
    const retry = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(retry.valid).toBe(false);
  });
});

describe("principal and expiry", () => {
  it("refuses another user's proof", async () => {
    const proofId = await mintProof({ userId: "user_someone_else" });
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/principal mismatch/i);
  });

  it("refuses an expired proof", async () => {
    const proofId = await mintProof({ ttlMs: -1000 });
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it.each([
    ["empty", ""],
    ["wrong prefix", "bio_proof_abc"],
    ["no prefix", "abc123"],
    ["unknown", "act_proof_doesnotexist"],
  ])("refuses a %s proofId", async (_label, id) => {
    const result = await validateAndConsumeActionProof(USER, id, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: APPROVED_BODY,
    });
    expect(result.valid).toBe(false);
  });

  it("refuses a body that cannot be canonicalised, rather than passing it", async () => {
    // FAIL-OPEN GUARD. `validateAndConsumeActionProof` wraps the digest
    // computation in try/catch because `canonicalJSON` throws on NaN, Infinity
    // and undefined. The catch has exactly one safe answer.
    //
    // A mutation study found this path completely untested: changing the catch to
    // `return { valid: true }` left all 36 other tests green. A body carrying NaN
    // would then have skipped the binding entirely — the one input guaranteed to
    // reach the catch is also the one an attacker can send.
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: NaN },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/cannot be verified/i);
  });

  it.each([
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["undefined", undefined],
  ])("refuses a body containing %s", async (_label, bad) => {
    const proofId = await mintProof();
    const result = await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: bad as never },
    });
    expect(result.valid).toBe(false);
  });

  it("burns the proof even when the body cannot be canonicalised", async () => {
    // The burn happens before the digest is computed, so an unparseable body
    // must not become a way to hold a proof open and retry.
    const proofId = await mintProof();
    await validateAndConsumeActionProof(USER, proofId, {
      endpoint: ORDER_ENDPOINT,
      method: "POST",
      body: { ...APPROVED_BODY, quantity: NaN },
    });
    expect(await kvGet(`${PROOF_PREFIX}${proofId}`)).toBeNull();
  });

  it("never throws, whatever it is handed", async () => {
    // A route that wrapped this in try/catch and treated a throw as "no proof
    // supplied" would fail open. Returning a verdict for every input removes
    // that possibility.
    for (const id of [undefined, null, 123, {}] as unknown[]) {
      const result = await validateAndConsumeActionProof(
        USER,
        id as string,
        { endpoint: ORDER_ENDPOINT, method: "POST", body: APPROVED_BODY }
      );
      expect(result.valid).toBe(false);
    }
  });
});

describe("canonical serialisation", () => {
  it("sorts object keys, recursively", () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    expect(canonicalJSON({ x: { q: 1, p: 2 } })).toBe(canonicalJSON({ x: { p: 2, q: 1 } }));
  });

  it("preserves array order", () => {
    expect(canonicalJSON([1, 2])).not.toBe(canonicalJSON([2, 1]));
  });

  it("emits numbers in a form that survives a JSON round trip", () => {
    // The property that matters is that the server's re-encoding of a parsed body
    // matches the client's, so anything JSON.parse can produce must come back the
    // same way.
    //
    // Deliberately NOT asserting `canonicalJSON(1.0) === canonicalJSON(1)`: an
    // earlier version did, and it is vacuous — JavaScript has one numeric type,
    // so `1.0` IS `1` before this function is called and the assertion cannot
    // fail. Same for -0, whose `String()` is already "0".
    for (const n of [0, 1, -1, 1.5, 1e21, 1e-7, Number.MAX_SAFE_INTEGER]) {
      expect(canonicalJSON(JSON.parse(JSON.stringify(n)))).toBe(canonicalJSON(n));
    }
  });

  it("distinguishes a number from its string form", () => {
    expect(canonicalJSON(1)).not.toBe(canonicalJSON("1"));
  });

  it("distinguishes null from the string \"null\"", () => {
    expect(canonicalJSON(null)).not.toBe(canonicalJSON("null"));
  });

  it("refuses non-finite numbers rather than coercing them", () => {
    // JSON.stringify turns these into `null`, which would make NaN, Infinity and
    // an actual null all hash identically.
    expect(() => canonicalJSON(NaN)).toThrow(/non-finite/i);
    expect(() => canonicalJSON(Infinity)).toThrow(/non-finite/i);
    expect(() => canonicalJSON(-Infinity)).toThrow(/non-finite/i);
  });

  it("refuses an undefined value rather than dropping it", () => {
    expect(() => canonicalJSON({ a: undefined } as never)).toThrow(/undefined/i);
  });

  it("is injective across shapes that a delimiter join would collide", () => {
    // The reason the digest is length-prefixed. Two structures whose naive
    // concatenations are identical must still differ.
        const a = canonicalJSON({ ab: 1, c: 2 });
    const b = canonicalJSON({ a: "b", c: 2 });
    expect(a).not.toBe(b);
  });
});

describe("the digest", () => {
  it("is stable across calls", () => {
    const intent = { userId: USER, endpoint: ORDER_ENDPOINT, method: "POST", body: APPROVED_BODY };
    expect(computeActionDigest(intent, "n")).toBe(computeActionDigest(intent, "n"));
  });

  it("changes with the nonce", () => {
    // Two approvals of the identical action must not share a digest, or one
    // proof's digest could be matched by a different proof's replay.
    const intent = { userId: USER, endpoint: ORDER_ENDPOINT, method: "POST", body: APPROVED_BODY };
    expect(computeActionDigest(intent, "n1")).not.toBe(computeActionDigest(intent, "n2"));
  });

  it("changes with the user", () => {
    const base = { endpoint: ORDER_ENDPOINT, method: "POST", body: APPROVED_BODY };
    expect(computeActionDigest({ ...base, userId: "a" }, "n")).not.toBe(
      computeActionDigest({ ...base, userId: "b" }, "n")
    );
  });

  it("is case-insensitive for the user id but NOT the endpoint", () => {
    const base = { method: "POST", body: APPROVED_BODY };
    // User ids are compared case-insensitively elsewhere in this codebase.
    expect(computeActionDigest({ ...base, userId: "Alice", endpoint: "/x" }, "n")).toBe(
      computeActionDigest({ ...base, userId: "alice", endpoint: "/x" }, "n")
    );
    // Paths are case-sensitive; folding them would let /Investing/Order be
    // approved by a proof minted for /investing/order.
    expect(computeActionDigest({ ...base, userId: "a", endpoint: "/X" }, "n")).not.toBe(
      computeActionDigest({ ...base, userId: "a", endpoint: "/x" }, "n")
    );
  });

  it("is a 64-character hex string", () => {
    const d = computeActionDigest(
      { userId: USER, endpoint: ORDER_ENDPOINT, method: "POST", body: APPROVED_BODY },
      "n"
    );
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cannot be forged by shifting bytes across field boundaries", () => {
    // Why the digest is length-prefixed rather than delimiter-joined.
    //
    // These two intents produce the IDENTICAL string under `parts.join("|")`:
    //
    //   userId "x|1", method "2"   ->  … |x|1|2| …
    //   userId "x",   method "1|2" ->  … |x|1|2| …
    //
    // Digits are the trick: `userId` is lower-cased and `method` upper-cased, so
    // most characters break the collision — digits survive both untouched. Verified
    // to collide under a join and not under length-prefixing before being written
    // down; an earlier version of this test used an example that did not actually
    // collide, and therefore passed against the broken encoding too.
    const a = computeActionDigest(
      { userId: "x|1", endpoint: "/e", method: "2", body: {} },
      "n"
    );
    const b = computeActionDigest(
      { userId: "x", endpoint: "/e", method: "1|2", body: {} },
      "n"
    );
    expect(a).not.toBe(b);
  });
});
