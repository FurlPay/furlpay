import { describe, expect, it } from "vitest";
import { enforceActionStepUp, STEP_UP_PROOF_FIELD } from "../enforceStepUp";
import { computeActionDigest, type ActionProofRecord, type CanonicalJSON } from "../actionProof";
import { requiresStepUp, STEP_UP_AMOUNT_USD } from "@furlpay/security";
import { kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// The gate the routes actually call.
//
// `enforceActionStepUp` returns a NextResponse to send back, or null to proceed.
// Every test here is about which of those two it picks, because the failure mode
// is silent: a gate that returns null when it should have returned a 401 does not
// throw, does not log, and lets the money move.
// ---------------------------------------------------------------------------

const PROOF_PREFIX = "act:proof:";
const USER = "user_enforce_test";
const ENDPOINT = "/investing/order";

const BIG = STEP_UP_AMOUNT_USD + 1; // over the threshold
const SMALL = STEP_UP_AMOUNT_USD - 1; // under it

const BODY: Record<string, CanonicalJSON> = { symbol: "AAPL", side: "buy", quantity: 10 };

async function mintProof(
  body: Record<string, CanonicalJSON> = BODY,
  opts: { endpoint?: string; userId?: string } = {}
): Promise<string> {
  const userId = opts.userId ?? USER;
  const endpoint = opts.endpoint ?? ENDPOINT;
  const nonce = "nonce-enforce-test";
  const proofId = `act_proof_${Math.random().toString(16).slice(2)}${Date.now()}`;
  const record: ActionProofRecord = {
    proofId,
    userId,
    actionDigest: computeActionDigest({ userId, endpoint, method: "POST", body }, nonce),
    nonce,
    endpoint,
    method: "POST",
    credentialId: "cred_test",
    verifiedAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  };
  await kvSet(`${PROOF_PREFIX}${proofId}`, record, 120);
  return proofId;
}

const base = {
  userId: USER,
  action: "place_order" as const,
  endpoint: ENDPOINT,
  method: "POST",
};

describe("the threshold", () => {
  it("lets a sub-threshold action through with no proof", async () => {
    // Deliberate. The web app shares these endpoints and has its own session
    // auth; requiring a passkey ceremony for a $20 order would break it. The
    // limitation is real and documented: below the threshold the client-side gate
    // is still the only gate.
    const res = await enforceActionStepUp({ ...base, amountUsd: SMALL, body: BODY });
    expect(res).toBeNull();
  });

  it("refuses a high-value action with NO proof", async () => {
    const res = await enforceActionStepUp({ ...base, amountUsd: BIG, body: BODY });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const json = await res!.json();
    expect(json.stepUpRequired).toBe(true);
    // The client keys off this to know it should run the ceremony and retry,
    // rather than showing the user a dead end.
    expect(json.methods).toContain("biometric");
  });

  it("refuses exactly AT the threshold", async () => {
    // `>=`, not `>`. An off-by-one here is a free pass at precisely the round
    // number an attacker would pick.
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: STEP_UP_AMOUNT_USD,
      body: BODY,
    });
    expect(res).not.toBeNull();
    expect(requiresStepUp({ action: "place_order", amountUsd: STEP_UP_AMOUNT_USD }).required).toBe(true);
  });

  it("treats a missing amount as sub-threshold", async () => {
    // Matches the existing `(ctx.amountUsd ?? 0)` behaviour for transfer. Called
    // out because it is load-bearing: an action with no USD value must not be
    // blocked by a gate it can never satisfy.
    const res = await enforceActionStepUp({ ...base, body: BODY });
    expect(res).toBeNull();
  });
});

describe("a supplied proof", () => {
  it("is accepted when it matches the request", async () => {
    const proofId = await mintProof();
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(res).toBeNull();
  });

  it("is accepted when the proof field is present in the body", async () => {
    // THE CHICKEN-AND-EGG TRAP.
    //
    // The client must declare the request to GET a challenge, so the digest is
    // committed over a body with no proof id in it. It then sends the same body
    // WITH the proof id attached. If the gate re-derives over the received body
    // verbatim it hashes one extra field, matches nothing, and every single
    // high-value request fails with "your approval was for a different request" —
    // which looks like a broken biometric flow and invites someone to turn the
    // control off.
    //
    // The proof here is minted over BODY (no proof field) and validated against a
    // body that HAS one. It must pass.
    const proofId = await mintProof(BODY);
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(res).toBeNull();
  });

  it("refuses when the body was altered after approval", async () => {
    const proofId = await mintProof(BODY);
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, quantity: 10_000, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("refuses a proof minted for another endpoint", async () => {
    const proofId = await mintProof(BODY, { endpoint: "/swaps" });
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(res).not.toBeNull();
  });

  it("refuses another user's proof", async () => {
    const proofId = await mintProof(BODY, { userId: "someone_else" });
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(res).not.toBeNull();
  });

  it("cannot be replayed on a second request", async () => {
    const proofId = await mintProof();
    const first = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(first).toBeNull();

    const second = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: { ...BODY, [STEP_UP_PROOF_FIELD]: proofId },
      proofId,
    });
    expect(second).not.toBeNull();
    expect(second!.status).toBe(401);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["a number", 12345],
    ["an object", { proofId: "act_proof_x" }],
    ["an array", ["act_proof_x"]],
  ])("refuses a high-value action when proofId is %s", async (_label, value) => {
    // A non-string proofId must be a refusal, not a crash and not a pass. The
    // object case matters most: `typeof {} === "object"` is falsy for the string
    // check, but a looser guard would pass it straight into kvGet.
    const res = await enforceActionStepUp({
      ...base,
      amountUsd: BIG,
      body: BODY,
      proofId: value,
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});

describe("the policy covers every Guardian money action", () => {
  it.each([
    "create_payment",
    "swap",
    "place_order",
    "schedule_investment",
    "earn_deposit",
  ] as const)("%s is gated above the threshold", (action) => {
    // The whole point of extending SensitiveAction. If one of these were left out
    // of VALUE_GATED it would silently return `required: false` for any amount —
    // the exact state all seven endpoints were in before this change.
    expect(requiresStepUp({ action, amountUsd: BIG }).required).toBe(true);
    expect(requiresStepUp({ action, amountUsd: SMALL }).required).toBe(false);
  });

  it("does not change the existing transfer and withdraw behaviour", () => {
    // Regression guard on a shared package. These two had the threshold before
    // this change and must be untouched by it.
    expect(requiresStepUp({ action: "transfer", amountUsd: BIG }).required).toBe(true);
    expect(requiresStepUp({ action: "transfer", amountUsd: SMALL }).required).toBe(false);
    expect(requiresStepUp({ action: "withdraw", amountUsd: BIG }).required).toBe(true);
    expect(requiresStepUp({ action: "withdraw", amountUsd: SMALL }).required).toBe(false);
  });

  it("does not change the always-step-up actions", () => {
    for (const action of ["set_card_limits", "change_settlement_priority", "add_payee", "reveal_card"] as const) {
      // No amount at all, still required — these are gated by kind, not value.
      expect(requiresStepUp({ action }).required).toBe(true);
    }
  });
});
