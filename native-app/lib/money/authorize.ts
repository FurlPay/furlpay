import { assessRisk, type RiskAssessment, type RiskSignals } from "@/lib/security/riskEngine";
import { requireAuthFor, type RiskAction } from "@/lib/security/riskPolicy";
import { isDeviceCompromised } from "@/lib/security/tamperDetection";
import {
  authorizePaymentWithFingerprint,
  isFingerprintPaySupported,
  type FingerprintPayIntent,
} from "@/lib/biometricPay";

// ---------------------------------------------------------------------------
// The single authorization boundary for money movement.
//
// Every money-moving call site — manual Send, Swap, a co-pilot action, an agent
// spend — goes through this one function. Before it existed, each screen made
// its own arrangements, and they disagreed in ways that mattered:
//
//   * Send and Swap both authenticated with `confirmWithBiometrics`, which
//     RETURNS TRUE when the user has switched biometric approvals off in
//     Settings or has none enrolled. On such a device the highest-value paths
//     in the app submitted with no authentication at all. (The identical bug
//     was found and fixed on the AI path in the previous pass; this is the same
//     root cause on the manual paths.)
//   * Neither called the risk engine, so it was a tested library that nothing
//     used.
//
// ORDER IS PART OF THE CONTRACT: risk is evaluated BEFORE authentication.
// A BLOCK must never show the user a fingerprint prompt for something that was
// never going to be submitted — that teaches people to authorize things that
// then fail, which is exactly the habit an attacker wants.
//
// THE CLIENT CANNOT OVERRIDE A DECISION. There is no parameter here that lets a
// caller assert its own verdict; `signals` are inputs to the engine, not the
// answer. Anything an LLM or a request body proposes reaches this function only
// as an amount and a category.
// ---------------------------------------------------------------------------

export type AuthorizeOutcome =
  /** Proceed to submission. */
  | {
      ok: true;
      assessment: RiskAssessment;
      /**
       * A single-use, server-minted proof that the device biometric authorised
       * THIS EXACT payment — present only when the caller supplied a `payment`
       * intent and the hardware ceremony succeeded.
       *
       * The caller must forward it to the transfer as `biometricProof`. When it
       * is absent the transfer falls back to the server's own step-up (TOTP),
       * which is the correct behaviour on a device with no passkey — not a
       * degraded one to paper over.
       */
      biometricProof?: string;
    }
  /** Do not submit. `message` is written for the user. */
  | {
      ok: false;
      /** Why, in a form the UI can branch on. */
      kind: "blocked" | "review" | "auth_failed" | "no_device_lock" | "declined";
      message: string;
      assessment: RiskAssessment;
    };

export interface AuthorizeInput {
  /** Classified action, from the central policy table. */
  action: RiskAction;
  /** Value at risk, in USD. Used by the risk rules and shown in the prompt. */
  amountUsd: number;
  /** What the OS prompt says. Must name the amount and the destination. */
  reason: string;
  /**
   * Everything the risk engine may look at, minus `action`/`amountUsd` which
   * come from above. Callers pass what they actually know; the engine treats
   * `undefined` as "no signal", never as "safe".
   */
  signals?: Omit<RiskSignals, "action" | "amountUsd">;
  /** Force a fresh prompt, bypassing the step-up grace window. */
  forceAuth?: boolean;
  /**
   * The exact payment being authorised, when there is one.
   *
   * Supplying it upgrades authentication from a LOCAL device check to a
   * server-verified, transaction-bound WebAuthn assertion. The difference
   * matters: `requireAuthFor` ultimately resolves to a boolean in this app's own
   * JavaScript, which a patched build can fake and which the server never sees.
   * A proof, by contrast, is signed in the secure element over
   * H(userId|amount|asset|recipient|chain|nonce) and re-derived server-side from
   * the transfer actually being executed — so it cannot be moved to a different
   * payment.
   *
   * These values MUST be byte-identical to what the transfer will carry. A
   * rounded amount or a re-cased address changes the digest, the server rejects
   * the binding, and the payment silently falls back to TOTP.
   */
  payment?: FingerprintPayIntent;
}

/**
 * Decide whether a money movement may be submitted, and prove the user is
 * present when the rules demand it.
 *
 * Returns rather than throws: every branch is a state the UI must render
 * distinctly, and an exception would collapse "blocked", "needs review" and
 * "you declined the prompt" into one catch block.
 */
export async function authorizeMoneyMove(input: AuthorizeInput): Promise<AuthorizeOutcome> {
  const assessment = assessRisk({
    action: input.action,
    amountUsd: input.amountUsd,
    deviceCompromised: isDeviceCompromised(),
    ...(input.signals ?? {}),
  });

  // --- BLOCK: never reaches the network -----------------------------------
  if (assessment.decision === "BLOCK") {
    return {
      ok: false,
      kind: "blocked",
      message: explain(assessment, "We can't complete this payment."),
      assessment,
    };
  }

  // --- REVIEW: not a success, and not a submission -------------------------
  // Deliberately NOT submitted-then-flagged. Sending it and calling it
  // "in review" would mean the money is committed while the UI implies it is
  // being considered.
  if (assessment.decision === "REVIEW") {
    return {
      ok: false,
      kind: "review",
      message: explain(assessment, "This payment needs to be reviewed before it can be sent."),
      assessment,
    };
  }

  // --- Preferred: server-verified, transaction-bound biometric -------------
  //
  // Tried BEFORE the local prompt, and only when the caller named the payment.
  // One prompt either way — this replaces the local one rather than adding a
  // second, because asking twice for the same approval teaches people to tap
  // through prompts.
  //
  // Each failure mode is handled on its own terms, and the distinction is the
  // whole point of not collapsing them:
  //
  //   unsupported -> no passkey on this device. Fall through to the local gate,
  //                  so a user without one can still send. The server then
  //                  applies its own step-up.
  //   cancelled   -> the user dismissed the sheet. That is a DECISION, not a
  //                  failure: return immediately and do not fall through to a
  //                  local prompt, which would re-ask something just refused.
  //   rejected    -> the server would not accept the assertion. Do not fall
  //                  through: a local boolean must not rescue an approval the
  //                  server already declined.
  if (input.payment && isFingerprintPaySupported()) {
    const bio = await authorizePaymentWithFingerprint(input.payment);

    if (bio.ok) return { ok: true, assessment, biometricProof: bio.proofId };

    if (bio.reason === "cancelled") {
      return {
        ok: false,
        kind: "declined",
        message: "Approval cancelled. Nothing was sent.",
        assessment,
      };
    }

    if (bio.reason === "rejected") {
      return { ok: false, kind: "auth_failed", message: bio.message, assessment };
    }
    // "unsupported" falls through deliberately.
  }

  // --- STEP_UP or ALLOW: authenticate ------------------------------------
  // `requireAuthFor` no-ops for low/medium actions, so an ALLOW on a
  // non-money action does not prompt. A STEP_UP forces a prompt even when the
  // grace window would otherwise have covered it.
  const auth = await requireAuthFor(input.action, {
    reason: input.reason,
    force: input.forceAuth || assessment.decision === "STEP_UP",
  });

  if (auth.ok) return { ok: true, assessment };

  if (auth.reason === "no_device_lock") {
    return {
      ok: false,
      kind: "no_device_lock",
      message:
        "This device has no screen lock, so we can't confirm it's you. Add a PIN, pattern or biometric in your device settings, then try again.",
      assessment,
    };
  }

  return {
    ok: false,
    kind: "auth_failed",
    message: "We couldn't confirm it was you, so nothing was sent.",
    assessment,
  };
}

/**
 * Compose the user-facing sentence.
 *
 * Leads with the rule that fired so the refusal is actionable. Never "for
 * security reasons" — that tells the user nothing and trains them to click
 * through warnings.
 */
function explain(a: RiskAssessment, fallback: string): string {
  const top = a.rules[0];
  if (!top) return fallback;
  return `${fallback} ${top.detail}`;
}

/**
 * Warnings worth showing on the review screen before the user commits.
 *
 * Separate from the decision: these do not block, and a caller that ignores
 * them still gets a correct decision. Surfacing them is how a first payment to
 * an unknown address gets a second look without being obstructed.
 */
export function riskWarningsFor(
  action: RiskAction,
  amountUsd: number,
  signals?: Omit<RiskSignals, "action" | "amountUsd">
): string[] {
  return assessRisk({ action, amountUsd, ...(signals ?? {}) }).warnings;
}
