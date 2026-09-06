import { describe, it, expect } from "vitest";
import { assessTrust } from "../score";
import {
  METHOD_ASSURANCE,
  requiredVerification,
  STRONG_CHECK_VALIDITY_MS,
  type HeldAssurance,
} from "../verification";
import type { ObservedReason, ReasonCode } from "../reasons";

// ---------------------------------------------------------------------------
// Adaptive verification.
//
// The property under test: friction is spent where it changes an outcome, and
// new personal data is collected only when identity itself is in doubt.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-06T12:00:00.000Z");

const reason = (code: ReasonCode, confidence = 1): ObservedReason => ({
  code,
  confidence,
  observedAt: new Date(NOW).toISOString(),
});

const NOTHING_HELD: HeldAssurance = {
  documentVerified: false,
  livenessPassed: false,
  passkeyEnrolled: false,
  totpEnrolled: false,
  bankAccountProven: false,
  phoneProven: false,
};

/**
 * A fixture that actually lands in the step-up band.
 *
 * Written out because the arithmetic is not obvious: a recent credential
 * change plus a new device scores 225 and sits in "low", which means the
 * step-up branch is never reached. Fixtures have to be calibrated against the
 * score engine, not assumed from how alarming the reasons sound.
 */
const MEDIUM_PRESENCE = () =>
  assessTrust(
    [
      reason("ACC.CREDENTIAL_CHANGE_RECENT"),
      reason("DEV.MUTATION_MID_SESSION"),
      reason("BEH.DEVIATES_FROM_BASELINE"),
    ],
    NOW
  );

/** Medium band, but the doubt is about WHO they are rather than who is acting. */
const MEDIUM_IDENTITY = () =>
  assessTrust(
    [
      reason("IDN.NAME_DOB_MISMATCH"),
      reason("IDN.DOCUMENT_UNVERIFIED"),
      reason("DEV.MUTATION_MID_SESSION"),
    ],
    NOW
  );

const WELL_ENROLLED: HeldAssurance = {
  documentVerified: true,
  livenessPassed: true,
  passkeyEnrolled: true,
  totpEnrolled: true,
  bankAccountProven: true,
  phoneProven: true,
  lastStrongCheckAt: new Date(NOW - 30 * 86_400_000).toISOString(),
};

describe("low risk is not taxed", () => {
  it("asks nothing of a trusted customer", () => {
    const result = requiredVerification(assessTrust([], NOW), WELL_ENROLLED, {}, NOW);
    expect(result.action).toBe("approve");
    expect(result.methods).toEqual([]);
    expect(result.frictionCost).toBe(0);
  });

  it("asks nothing at the low band", () => {
    // Maximum verification on everyone is a different failure, not the safe
    // choice: it abandons the honest funnel while a ring completes the check
    // with a stolen ID because the expected value justifies the effort.
    const low = assessTrust([reason("DEV.NEW_TO_ACCOUNT"), reason("NET.ANONYMISING_PROXY")], NOW);
    expect(low.band === "trusted" || low.band === "low").toBe(true);
    expect(requiredVerification(low, WELL_ENROLLED, {}, NOW).methods).toEqual([]);
  });

  it("asks nothing of a recent credential change alone", () => {
    // Alarming-sounding and still only 225. A control that fired here would
    // step up every customer who changed their phone number.
    const modest = assessTrust(
      [reason("ACC.CREDENTIAL_CHANGE_RECENT"), reason("DEV.NEW_TO_ACCOUNT")],
      NOW
    );
    expect(modest.band).toBe("low");
    expect(requiredVerification(modest, WELL_ENROLLED, {}, NOW).methods).toEqual([]);
  });
});

describe("presence doubt is answered with what the customer already holds", () => {
  const mediumRisk = MEDIUM_PRESENCE();

  it("lands in the step-up band", () => {
    expect(mediumRisk.band).toBe("medium");
  });

  it("prefers a passkey over anything that collects new data", () => {
    const result = requiredVerification(mediumRisk, WELL_ENROLLED, {}, NOW);
    expect(result.action).toBe("step_up");
    // Cheapest-first, and the cheapest strong method collects nothing new.
    expect(result.methods[0]).toBe("reauth_passkey");
  });

  it("does NOT request a document when only presence is in doubt", () => {
    // A passkey re-assertion and a document capture both answer "is this the
    // account holder". Only one adds a biometric template and a government
    // identifier to what we must then protect.
    const result = requiredVerification(mediumRisk, WELL_ENROLLED, {}, NOW);
    expect(result.methods).not.toContain("document");
    expect(result.methods).not.toContain("liveness");
  });

  it("offers alternatives rather than mandating one method", () => {
    const result = requiredVerification(mediumRisk, WELL_ENROLLED, {}, NOW);
    expect(result.requireAll).toBe(false);
    expect(result.methods.length).toBeGreaterThan(1);
  });

  it("falls back to an OTP when nothing stronger is enrolled", () => {
    // Escalating straight to a document because no factor is enrolled would
    // punish the customer for our own onboarding gap.
    const result = requiredVerification(mediumRisk, NOTHING_HELD, {}, NOW);
    expect(result.methods).toEqual(["otp"]);
    expect(result.explanation).toMatch(/least intrusive/);
  });
});

describe("identity doubt is the only case that collects new identity data", () => {
  it("issues document AND liveness together, never one alone", () => {
    // A document proves a document is authentic. Liveness proves someone is
    // present. Only the pair proves the presenter owns the document.
    const result = requiredVerification(
      MEDIUM_IDENTITY(),
      NOTHING_HELD,
      { isIdentityDoubt: true },
      NOW
    );
    expect(result.methods).toContain("document");
    expect(result.methods).toContain("liveness");
    expect(result.requireAll).toBe(true);
  });

  it("costs materially more friction, and says so", () => {
    const identity = requiredVerification(
      MEDIUM_IDENTITY(),
      NOTHING_HELD,
      { isIdentityDoubt: true },
      NOW
    );
    const presence = requiredVerification(MEDIUM_PRESENCE(), WELL_ENROLLED, {}, NOW);
    expect(identity.frictionCost).toBeGreaterThan(presence.frictionCost * 3);
  });
});

describe("high risk goes to a human before it goes to the customer", () => {
  it("asks the analyst, not the customer, on a hold", () => {
    // Requesting documents on evidence a human has not yet confirmed is real
    // collects sensitive data to support a decision that may be reversed.
    const high = assessTrust([reason("VEL.BURST"), reason("GRF.SHARED_INSTRUMENT")], NOW);
    const result = requiredVerification(high, WELL_ENROLLED, {}, NOW);

    expect(["hold", "manual_review"]).toContain(result.action);
    expect(result.methods).toEqual(["human_review"]);
  });

  it("asks for nothing at all on a decline", () => {
    // Nothing the customer could provide changes a sanctions outcome, and
    // requesting a document would collect data we then have to retain.
    const result = requiredVerification(
      assessTrust([reason("CMP.SANCTIONS_MATCH")], NOW),
      NOTHING_HELD,
      {},
      NOW
    );
    expect(result.action).toBe("decline");
    expect(result.methods).toEqual([]);
    expect(result.frictionCost).toBe(0);
  });
});

describe("staleness and context", () => {
  it("re-asks for a selfie once a strong check has aged out", () => {
    // Re-verification is how a sold account is caught after the takeover.
    const stale: HeldAssurance = {
      ...WELL_ENROLLED,
      lastStrongCheckAt: new Date(NOW - STRONG_CHECK_VALIDITY_MS - 86_400_000).toISOString(),
    };
    const result = requiredVerification(MEDIUM_PRESENCE(), stale, {}, NOW);
    expect(result.methods).toContain("selfie_match");
  });

  it("treats a missing or unparseable check date as stale", () => {
    const noDate: HeldAssurance = { ...WELL_ENROLLED, lastStrongCheckAt: undefined };
    const badDate: HeldAssurance = { ...WELL_ENROLLED, lastStrongCheckAt: "not-a-date" };
    for (const held of [noDate, badDate]) {
      const result = requiredVerification(MEDIUM_PRESENCE(), held, {}, NOW);
      expect(result.methods).toContain("selfie_match");
    }
  });

  it("adds bank-account proof for a new beneficiary", () => {
    // Re-asserting presence does not address an authorised-push-payment scam
    // at all — the real account holder is the one being deceived.
    const result = requiredVerification(
      MEDIUM_PRESENCE(),
      WELL_ENROLLED,
      { isNewBeneficiary: true },
      NOW
    );
    expect(result.methods).toContain("bank_account_proof");
  });
});

describe("the method table records what each check actually proves", () => {
  it("never claims a method proves identity when it proves possession", () => {
    // Treating methods as interchangeable "verification" is how a system ends
    // up with six checks that all prove the same thing and none that prove the
    // thing in doubt.
    expect(METHOD_ASSURANCE.otp.proves).toMatch(/channel/);
    expect(METHOD_ASSURANCE.reauth_passkey.proves).toMatch(/authenticator/);
    expect(METHOD_ASSURANCE.document.proves).toMatch(/document/);
    expect(METHOD_ASSURANCE.liveness.proves).toMatch(/live human/);
  });

  it("prices the data-collecting methods as higher friction than the others", () => {
    for (const cheap of ["reauth_passkey", "otp", "totp"] as const) {
      for (const expensive of ["document", "liveness", "selfie_match"] as const) {
        expect(
          METHOD_ASSURANCE[cheap].friction,
          `${cheap} vs ${expensive}`
        ).toBeLessThan(METHOD_ASSURANCE[expensive].friction);
      }
    }
  });
});
