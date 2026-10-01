import { describe, expect, it } from "vitest";
import { findOrCreateUserByIdentity, setKycStatus, updateUser, getAccount } from "../store";
import { kycTransitionAllowed, type KycState } from "../webhookOrdering";

// ---------------------------------------------------------------------------
// The KYC transition rule is enforced at the ONLY mutation point, setKycStatus.
//
// The rule (lib/webhookOrdering.ts kycTransitionAllowed): nothing may move a
// user OUT of "verified" automatically — a redelivered, out-of-order
// `inquiry.failed` must not demote a verified user. Everything else is allowed,
// including unverified → verified, which is the real provider-approval path
// (Persona/Sumsub signal approval in one event; no "pending" write exists).
//
// Before this, only the Persona/Sumsub failure branches checked the rule; any
// other caller of setKycStatus could demote freely. These tests drive the real
// store.
// ---------------------------------------------------------------------------

let n = 0;
function fresh(status: KycState, tier: 0 | 1 | 2 | 3 = 0) {
  const { account } = findOrCreateUserByIdentity({ email: `kyc-boundary-${Date.now()}-${n++}@example.test` });
  // Seed the starting state directly: this test is about the TRANSITION, and
  // reaching "verified" through setKycStatus is itself one of the cases below.
  account.user.kycStatus = status;
  account.user.kycTier = tier;
  return account.user.id;
}
const status = (id: string) => getAccount(id)!.user.kycStatus;
const tier = (id: string) => getAccount(id)!.user.kycTier;

describe("setKycStatus enforces the transition rule", () => {
  it.each<[KycState, KycState]>([
    ["unverified", "verified"], // provider approval
    ["unverified", "pending"],
    ["pending", "verified"],
    ["pending", "unverified"], // a pending user failing is the normal unhappy path
    ["unverified", "unverified"],
    ["verified", "verified"], // no-op (e.g. a tier refresh)
  ])("ALLOWS %s → %s and applies it", (from, to) => {
    const id = fresh(from);
    expect(setKycStatus(id, to)).toBe(true);
    expect(status(id)).toBe(to);
  });

  it.each<[KycState, KycState]>([
    ["verified", "unverified"],
    ["verified", "pending"],
  ])("REFUSES %s → %s, returns false and writes nothing", (from, to) => {
    const id = fresh(from, 2);
    expect(setKycStatus(id, to, 0)).toBe(false);
    expect(status(id)).toBe("verified");
    expect(tier(id)).toBe(2); // the tier downgrade that rode along is refused too
  });

  it("a refused demotion leaves eligibility intact (tier cap unchanged)", () => {
    const id = fresh("verified", 2);
    setKycStatus(id, "unverified", 0);
    expect(tier(id)).toBe(2);
  });

  it("applies the tier together with an allowed transition", () => {
    const id = fresh("unverified", 0);
    expect(setKycStatus(id, "verified", 2)).toBe(true);
    expect(tier(id)).toBe(2);
  });

  it("returns false for an unknown user", () => {
    expect(setKycStatus("no-such-user", "verified", 2)).toBe(false);
  });

  it("agrees with kycTransitionAllowed on every pair (one rule, not two)", () => {
    const all: KycState[] = ["unverified", "pending", "verified"];
    for (const from of all) {
      for (const to of all) {
        const id = fresh(from);
        expect(setKycStatus(id, to)).toBe(kycTransitionAllowed(from, to));
      }
    }
  });
});

describe("the identity patch path cannot touch KYC", () => {
  it("updateUser ignores kycStatus and kycTier even if a caller smuggles them in", () => {
    const id = fresh("unverified", 0);
    updateUser(id, { kycStatus: "verified", kycTier: 3 } as unknown as Parameters<typeof updateUser>[1]);
    expect(status(id)).toBe("unverified");
    expect(tier(id)).toBe(0);
  });
});
