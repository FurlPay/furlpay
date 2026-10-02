import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  canMoveBeneficiary,
  checkBeneficiaryEligibility,
  confirmMicroDeposits,
  createBeneficiary,
  getUserBeneficiaries,
  markDepositsLanded,
  removeBeneficiary,
} from "@/lib/ramp/beneficiary";
import {
  activeVerifier,
  stubVerifier,
  VerifierNotConfigured,
  type BeneficiaryVerifier,
} from "@/lib/ramp/beneficiaryVerification";

// The verifier below is a TEST DOUBLE for the partner interface. Production
// has none: activeVerifier() is null and the add-account route refuses.

function fakeVerifier(result: { verified: boolean; nameMatch?: boolean; reason?: string }, failInitiate = false): BeneficiaryVerifier {
  return {
    id: "test-double",
    initiateMicroDeposit: async () => {
      if (failInitiate) throw new Error("account cannot receive");
      return { refId: `ref_${randomUUID()}` };
    },
    confirmMicroDeposit: async () => result,
    getVerificationStatus: async () => "micro_deposit_sent",
  };
}

const input = (userId: string) => ({
  userId,
  accountHolderName: "Priya Sharma",
  accountNumber: "123456789012",
  bankCode: "HDFC0001234",
  country: "IN",
  currency: "INR",
});

beforeEach(() => {
  process.env.FURLPAY_BENEFICIARY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("no partner, no verification", () => {
  it("production has no verifier, and the stub refuses rather than pretending", async () => {
    expect(activeVerifier()).toBeNull();
    await expect(stubVerifier.initiateMicroDeposit({} as never)).rejects.toBeInstanceOf(VerifierNotConfigured);
    await expect(stubVerifier.confirmMicroDeposit("r", [1, 2])).rejects.toBeInstanceOf(VerifierNotConfigured);
  });

  it("createBeneficiary refuses with no verifier", async () => {
    await expect(createBeneficiary(input(`u_${randomUUID()}`), null)).rejects.toThrow(/verification partner/);
  });
});

describe("micro-deposit lifecycle", () => {
  it("verified only after deposits land, amounts match AND the name matches; then a 24h hold", async () => {
    const userId = `u_${randomUUID()}`;
    const v = fakeVerifier({ verified: true, nameMatch: true });
    const b = await createBeneficiary(input(userId), v);
    expect(b.status).toBe("micro_deposit_sent");
    expect(JSON.stringify(b)).not.toContain("123456789012");

    expect((await checkBeneficiaryEligibility(b.id, userId))).toMatchObject({ eligible: false, action: { type: "verify_beneficiary" } });

    await markDepositsLanded(b.id);
    const verified = await confirmMicroDeposits(b.id, userId, [12, 34], v);
    expect(verified.status).toBe("verified");
    // Verified, but inside the hold.
    expect(await checkBeneficiaryEligibility(b.id, userId)).toMatchObject({ eligible: false, reason: expect.stringMatching(/24-hour/) });
  });

  it("a name mismatch suspends for review instead of verifying", async () => {
    const userId = `u_${randomUUID()}`;
    const v = fakeVerifier({ verified: true, nameMatch: false });
    const b = await createBeneficiary(input(userId), v);
    await markDepositsLanded(b.id);
    expect((await confirmMicroDeposits(b.id, userId, [12, 34], v)).status).toBe("suspended");
  });

  it("a missing name verdict is not a match", async () => {
    const userId = `u_${randomUUID()}`;
    const v = fakeVerifier({ verified: true });
    const b = await createBeneficiary(input(userId), v);
    await markDepositsLanded(b.id);
    expect((await confirmMicroDeposits(b.id, userId, [12, 34], v)).status).toBe("suspended");
  });

  it("wrong amounts or a bounced deposit fail the account", async () => {
    const userId = `u_${randomUUID()}`;
    const bounced = await createBeneficiary(input(userId), fakeVerifier({ verified: false }, true));
    expect(bounced.status).toBe("micro_deposit_failed");

    const v = fakeVerifier({ verified: false, reason: "amounts did not match" });
    const b = await createBeneficiary(input(userId), v);
    await markDepositsLanded(b.id);
    expect((await confirmMicroDeposits(b.id, userId, [1, 2], v)).status).toBe("micro_deposit_failed");
  });

  it("only the owner can confirm or remove", async () => {
    const userId = `u_${randomUUID()}`;
    const v = fakeVerifier({ verified: true, nameMatch: true });
    const b = await createBeneficiary(input(userId), v);
    await markDepositsLanded(b.id);
    await expect(confirmMicroDeposits(b.id, "attacker", [12, 34], v)).rejects.toThrow(/not found/);
    await expect(removeBeneficiary(b.id, "attacker")).rejects.toThrow(/not found/);
    await removeBeneficiary(b.id, userId);
    expect(await getUserBeneficiaries(userId)).toEqual([]);
    expect(await checkBeneficiaryEligibility(b.id, userId)).toEqual({ eligible: false, reason: "Beneficiary not found." });
  });

  it("refuses illegal moves (a failed or removed account never becomes verified)", () => {
    expect(canMoveBeneficiary("pending", "verified")).toBe(false);
    expect(canMoveBeneficiary("micro_deposit_failed", "verified")).toBe(false);
    expect(canMoveBeneficiary("removed", "verified")).toBe(false);
    expect(canMoveBeneficiary("awaiting_confirmation", "verified")).toBe(true);
  });
});
