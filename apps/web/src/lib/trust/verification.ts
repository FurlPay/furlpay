import type { RiskBand, TrustAction, TrustAssessment } from "./score";
import { recommendedAction } from "./score";

// ---------------------------------------------------------------------------
// Adaptive verification.
//
// THE PREMISE. Putting every customer through maximum verification is not the
// safe choice, it is a different failure. Full document-and-liveness on every
// signup abandons most of the funnel, and the customers who abandon are not
// the fraudsters — a fraud ring will happily complete a liveness check with a
// stolen ID, because for them the expected value justifies the effort. So
// maximum friction filters out the honest and keeps the determined. Friction
// must be spent where it changes an outcome.
//
// THE SECOND PREMISE, which matters more. Friction is not free and it is not
// evenly distributed. A document check fails more often for customers with
// worn IDs, non-Latin names, or unusual formats; a liveness check fails more
// often in poor lighting and on cheap cameras. Every step-up is therefore a
// small tax levied unevenly, and "just ask for more" has a cost that lands on
// the people least able to absorb it.
//
// WHAT THIS MODULE IS. A mapping from (risk band, action, what we already
// hold) to the CHEAPEST verification that would resolve the doubt. It is
// deliberately not a policy about who is trustworthy — that is the score's
// job. It answers only: given this much doubt, what is the least we can ask?
// ---------------------------------------------------------------------------

export type VerificationMethod =
  /** One-time code to a channel the customer already proved they hold. */
  | "otp"
  /** Re-assert an enrolled authenticator. Cheap, high assurance, no new data. */
  | "reauth_passkey"
  /** Time-based code. Fallback where no passkey is enrolled. */
  | "totp"
  /** Selfie matched against a document already on file. */
  | "selfie_match"
  /** Active or passive liveness. Defeats a static photo, not a good deepfake. */
  | "liveness"
  /** Government ID capture and authentication. The most expensive step. */
  | "document"
  /** Prove control of a bank account (micro-deposit or a rail's own check). */
  | "bank_account_proof"
  /** Prove control of the payment instrument. */
  | "instrument_proof"
  /** A human reviews before anything proceeds. */
  | "human_review";

/**
 * Assurance each method delivers, 0..1, and what it actually proves.
 *
 * The numbers are policy. The COMMENTS are the part that must not be lost:
 * each method proves something specific and narrow, and treating them as
 * interchangeable "verification" is how a system ends up with six checks that
 * all prove the same thing and none that prove the thing in doubt.
 */
export const METHOD_ASSURANCE: Record<
  VerificationMethod,
  { assurance: number; proves: string; friction: number }
> = {
  otp: {
    assurance: 0.35,
    // Proves possession of a channel. Does NOT prove identity, and is the
    // weakest link against SIM-swap and against a social-engineering victim
    // who will read the code out to the person on the phone.
    proves: "control of a previously-proven channel",
    friction: 0.2,
  },
  reauth_passkey: {
    assurance: 0.7,
    // Strong, phishing-resistant, and cheapest of the strong methods because
    // it collects no new personal data at all. Preferred wherever enrolled.
    proves: "possession of the enrolled authenticator",
    friction: 0.15,
  },
  totp: {
    assurance: 0.5,
    proves: "possession of the enrolled secret",
    friction: 0.25,
  },
  selfie_match: {
    assurance: 0.6,
    proves: "the person present resembles the document on file",
    friction: 0.5,
  },
  liveness: {
    assurance: 0.65,
    // Defeats a photo held to a camera. Against a competent real-time
    // face-swap it is a much weaker control than its assurance number
    // suggests, which is why it never appears alone above the medium band.
    proves: "a live human is present",
    friction: 0.55,
  },
  document: {
    assurance: 0.8,
    // Proves a document exists and is authentic. Does NOT prove the presenter
    // owns it — that requires pairing with selfie or liveness, which is why
    // the two are issued together for identity doubt.
    proves: "an authentic government document",
    friction: 0.8,
  },
  bank_account_proof: {
    assurance: 0.75,
    // Unusually strong against synthetic identity, because opening a bank
    // account already required the bank's own verification. Borrowed
    // assurance, and cheap for the customer.
    proves: "control of a named bank account",
    friction: 0.6,
  },
  instrument_proof: {
    assurance: 0.7,
    proves: "control of the payment instrument",
    friction: 0.5,
  },
  human_review: {
    assurance: 0.9,
    proves: "an analyst has examined the whole picture",
    friction: 1.0,
  },
};

/** What the customer has already satisfied. Never re-ask for these. */
export interface HeldAssurance {
  readonly documentVerified: boolean;
  readonly livenessPassed: boolean;
  readonly passkeyEnrolled: boolean;
  readonly totpEnrolled: boolean;
  readonly bankAccountProven: boolean;
  readonly phoneProven: boolean;
  /** ISO timestamp of the strongest check, for staleness. */
  readonly lastStrongCheckAt?: string;
}

export interface VerificationRequirement {
  readonly action: TrustAction;
  /** Methods to offer, cheapest-first. Satisfying ONE is normally enough. */
  readonly methods: readonly VerificationMethod[];
  /** True when every listed method must be satisfied, not just one. */
  readonly requireAll: boolean;
  readonly explanation: string;
  /** Total friction imposed, for the metric that keeps this honest. */
  readonly frictionCost: number;
}

/**
 * How long a strong identity check stays fresh.
 *
 * Re-verification is not a security ritual — it is how a stolen-then-sold
 * account is caught after the takeover. Twelve months balances that against
 * the cost of re-checking people who have done nothing wrong.
 */
export const STRONG_CHECK_VALIDITY_MS = 365 * 86_400_000;

function strongCheckStale(held: HeldAssurance, now: number): boolean {
  if (!held.lastStrongCheckAt) return true;
  const at = Date.parse(held.lastStrongCheckAt);
  if (!Number.isFinite(at)) return true;
  return now - at > STRONG_CHECK_VALIDITY_MS;
}

/**
 * Choose the cheapest verification that resolves this much doubt.
 *
 * The ordering rule throughout: prefer methods that collect NO NEW PERSONAL
 * DATA over methods that do. A passkey re-assertion and a document capture can
 * both resolve "is this the account holder", and only one of them adds a
 * biometric template and a government identifier to our retention obligations.
 * Data minimisation is not only a compliance posture here; unheld data cannot
 * be breached.
 */
export function requiredVerification(
  assessment: TrustAssessment,
  held: HeldAssurance,
  context: { readonly isIdentityDoubt?: boolean; readonly isNewBeneficiary?: boolean } = {},
  now: number = Date.now()
): VerificationRequirement {
  const decision = recommendedAction(assessment);
  const band: RiskBand = assessment.band;

  // Critical, or a standalone compliance trigger: nothing is asked, because
  // nothing the customer could provide changes the answer. Requesting a
  // document from a sanctioned party is theatre that also collects data we
  // then have to hold.
  if (decision.action === "decline") {
    return {
      action: "decline",
      methods: [],
      requireAll: false,
      explanation: decision.explanation,
      frictionCost: 0,
    };
  }

  if (decision.action === "manual_review" || decision.action === "hold") {
    return {
      action: decision.action,
      methods: ["human_review"],
      requireAll: true,
      explanation:
        `${decision.explanation} An analyst reviews before this proceeds; the customer is not asked ` +
        "for documents on evidence a human has not yet confirmed is real.",
      frictionCost: METHOD_ASSURANCE.human_review.friction,
    };
  }

  if (band === "trusted" || band === "low") {
    return {
      action: "approve",
      methods: [],
      requireAll: false,
      explanation: `Score ${assessment.score} needs no additional verification.`,
      frictionCost: 0,
    };
  }

  // Medium: step up, and choose by WHAT IS IN DOUBT rather than by score.
  const methods: VerificationMethod[] = [];

  if (context.isIdentityDoubt || (!held.documentVerified && assessment.score >= 500)) {
    // Identity doubt is the one case that genuinely needs new data. Document
    // and liveness go together: a document proves a document exists, liveness
    // proves someone is present, and only the pair proves the presenter owns
    // it.
    methods.push("document", "liveness");
    return {
      action: "step_up",
      methods,
      requireAll: true,
      explanation:
        "Identity itself is in doubt, which is the only case that warrants collecting new " +
        "identity data. Document and liveness are issued together because neither alone proves " +
        "the presenter owns the document.",
      frictionCost: METHOD_ASSURANCE.document.friction + METHOD_ASSURANCE.liveness.friction,
    };
  }

  // Otherwise the doubt is about PRESENCE — is the account holder the one
  // acting — and that is answerable with what they already hold.
  if (held.passkeyEnrolled) methods.push("reauth_passkey");
  if (held.totpEnrolled) methods.push("totp");
  if (held.phoneProven) methods.push("otp");

  if (context.isNewBeneficiary && held.bankAccountProven) {
    // A new beneficiary paired with a large amount is the shape of both
    // takeover and authorised-push-payment fraud, and re-asserting presence
    // does not address the second one at all.
    methods.push("bank_account_proof");
  }

  if (methods.length === 0) {
    // Nothing enrolled to fall back on. Rather than escalate straight to a
    // document, ask for the cheapest thing that establishes anything at all.
    return {
      action: "step_up",
      methods: ["otp"],
      requireAll: false,
      explanation:
        "No stronger factor is enrolled. An OTP is weak but is the least intrusive way to " +
        "establish channel control before considering identity data.",
      frictionCost: METHOD_ASSURANCE.otp.friction,
    };
  }

  const stale = strongCheckStale(held, now);
  if (stale && held.documentVerified) {
    methods.push("selfie_match");
  }

  const cheapest = [...new Set(methods)].sort(
    (a, b) => METHOD_ASSURANCE[a].friction - METHOD_ASSURANCE[b].friction
  );

  return {
    action: "step_up",
    methods: cheapest,
    requireAll: false,
    explanation:
      `Score ${assessment.score} raises doubt about who is acting, not about who they are. ` +
      "Any one of these re-establishes presence without collecting new personal data.",
    frictionCost: METHOD_ASSURANCE[cheapest[0]].friction,
  };
}
