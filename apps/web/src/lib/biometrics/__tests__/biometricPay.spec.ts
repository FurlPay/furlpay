import { describe, expect, it, beforeEach } from "vitest";
import { computePaymentDigest, validateAndConsumeBiometricProof } from "../biometricPay";
import { kvSet, kvGet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Biometric payment proofs — the transaction binding.
//
// THE DEFECT THESE TESTS PIN: validateAndConsumeBiometricProof() accepted a
// `transfer` argument and never read it. Every check it performed was about WHO
// (userId) and WHEN (expiry); none was about WHAT. So a proof minted for "$5 to
// addressA" authorised ANY transfer — an attacker on a hijacked session could
// display a $5 payment, collect the victim's fingerprint, then submit $5,000 to
// their own address with the same proofId and sail through the step-up gate.
//
// That is worse than no biometric gate at all, because the prompt told the user
// they were approving one specific payment. The first describe block below is
// the exploit, and it must fail to be exploitable.
// ---------------------------------------------------------------------------

const PROOF_PREFIX = "bio:proof:";
const USER = "user_bio_test";

const AUTHORIZED = { amount: 5, asset: "USDC", recipient: "0xAAA1", chain: "base" };
const ATTACKER = { amount: 5000, asset: "USDC", recipient: "0xBBB2", chain: "base" };

/**
 * Mint a proof the way verifyBiometricPaymentAssertion does, without needing a
 * real authenticator — the signature ceremony is @simplewebauthn's job and is
 * not what is under test here. What is under test is what happens at SPEND time.
 */
async function mintProof(
  params: typeof AUTHORIZED,
  opts: { nonce?: string; userId?: string; ttlMs?: number } = {}
): Promise<string> {
  const userId = opts.userId ?? USER;
  const nonce = opts.nonce ?? "nonce-fixed-for-test";
  const proofId = `bio_proof_${Math.random().toString(16).slice(2)}`;
  const digest = computePaymentDigest({ userId, ...params }, nonce);

  await kvSet(
    `${PROOF_PREFIX}${proofId}`,
    {
      proofId,
      userId,
      paymentDigest: digest,
      nonce,
      credentialId: "cred_1",
      verifiedAt: Date.now(),
      expiresAt: Date.now() + (opts.ttlMs ?? 120_000),
    },
    120
  );
  return proofId;
}

describe("the cross-transaction replay exploit", () => {
  it("REJECTS a proof spent on a different amount", async () => {
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, {
      ...AUTHORIZED,
      amount: 5000,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/different payment/i);
  });

  it("REJECTS a proof spent on a different recipient", async () => {
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, {
      ...AUTHORIZED,
      recipient: "0xBBB2",
    });
    expect(res.valid).toBe(false);
  });

  it("REJECTS the full attack: small approval, large transfer elsewhere", async () => {
    // The exact scenario the design claims to defend.
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, ATTACKER);
    expect(res.valid).toBe(false);
  });

  it.each([
    ["asset", { asset: "USDT" }],
    ["chain", { chain: "arbitrum" }],
    ["a tiny amount change", { amount: 5.000001 }],
  ])("REJECTS a changed %s", async (_label, override) => {
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, {
      ...AUTHORIZED,
      ...override,
    });
    expect(res.valid).toBe(false);
  });
});

describe("the authorized transfer still works", () => {
  it("accepts the exact transfer that was approved", async () => {
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED);
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("normalises case and whitespace the way the digest does", async () => {
    // A recipient echoed back checksummed, or an asset in lower case, must not
    // look like a different payment — that would be a false rejection on a
    // legitimate transfer, which trains users to re-approve blindly.
    const proofId = await mintProof(AUTHORIZED);
    const res = await validateAndConsumeBiometricProof(USER, proofId, {
      amount: 5,
      asset: "usdc",
      recipient: "  0xaaa1  ",
      chain: "BASE",
    });
    expect(res.valid).toBe(true);
  });
});

describe("single use", () => {
  it("burns the proof even on a successful spend", async () => {
    const proofId = await mintProof(AUTHORIZED);
    expect((await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED)).valid).toBe(true);

    const replay = await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED);
    expect(replay.valid).toBe(false);
    expect(replay.reason).toMatch(/expired or already consumed/i);
  });

  it("burns the proof on a MISMATCHED spend too", async () => {
    // Critical: if a failed attempt left the proof alive, an attacker could probe
    // amounts until one matched. Burning on read makes each proof one guess.
    const proofId = await mintProof(AUTHORIZED);
    await validateAndConsumeBiometricProof(USER, proofId, ATTACKER);

    expect(await kvGet(`${PROOF_PREFIX}${proofId}`)).toBeNull();
    const second = await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED);
    expect(second.valid).toBe(false);
  });
});

describe("principal and lifetime", () => {
  it("rejects another user's proof", async () => {
    const proofId = await mintProof(AUTHORIZED, { userId: "someone_else" });
    const res = await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/principal mismatch/i);
  });

  it("rejects an expired proof", async () => {
    const proofId = await mintProof(AUTHORIZED, { ttlMs: -1000 });
    const res = await validateAndConsumeBiometricProof(USER, proofId, AUTHORIZED);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/expired/i);
  });

  it.each([
    ["empty", ""],
    ["wrong prefix", "proof_abc123"],
    ["a challenge id", "bio_chal_abc123"],
    ["unknown", "bio_proof_doesnotexist"],
  ])("rejects a %s proof id", async (_label, id) => {
    const res = await validateAndConsumeBiometricProof(USER, id, AUTHORIZED);
    expect(res.valid).toBe(false);
  });
});

describe("computePaymentDigest", () => {
  it("is deterministic", () => {
    const p = { userId: USER, ...AUTHORIZED };
    expect(computePaymentDigest(p, "n1")).toBe(computePaymentDigest(p, "n1"));
  });

  it("changes with every committed field", () => {
    const base = { userId: USER, ...AUTHORIZED };
    const d = computePaymentDigest(base, "n1");
    expect(computePaymentDigest({ ...base, amount: 6 }, "n1")).not.toBe(d);
    expect(computePaymentDigest({ ...base, asset: "USDT" }, "n1")).not.toBe(d);
    expect(computePaymentDigest({ ...base, recipient: "0xBBB2" }, "n1")).not.toBe(d);
    expect(computePaymentDigest({ ...base, chain: "arbitrum" }, "n1")).not.toBe(d);
    expect(computePaymentDigest({ ...base, userId: "other" }, "n1")).not.toBe(d);
    expect(computePaymentDigest(base, "n2")).not.toBe(d);
  });

  it("is not confusable across field boundaries", () => {
    // The fields are joined with "|", so a value containing the separator must not
    // be able to shift meaning into the next field.
    const a = computePaymentDigest(
      { userId: USER, amount: 5, asset: "USDC", recipient: "0xA", chain: "base" },
      "n"
    );
    const b = computePaymentDigest(
      { userId: USER, amount: 5, asset: "USDC", recipient: "0xA|base", chain: "" },
      "n"
    );
    expect(a).not.toBe(b);
  });
});
