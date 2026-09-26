// ---------------------------------------------------------------------------
// The one place a route asks "has this action been stepped up?".
//
// WHY A HELPER RATHER THAN THE PATTERN COPIED INTO EACH ROUTE
//
// /api/wallets/transfer already implements this inline, correctly, in about
// thirty lines. Copying those thirty lines into five more routes means five more
// chances to get the order wrong, to forget the audit line, or — the one that
// actually happens — to treat a thrown error as "no proof required". The routes
// below move money; the difference between `valid: false` and a caught exception
// is the difference between a refusal and a bypass.
//
// So the decision lives here and a route gets one call and one branch.
//
// WHAT IT DOES NOT DO
//
// It does not require a proof for every action. The threshold is
// `requiresStepUp`, the same policy transfer already uses, so a $20 payment is
// not held hostage to a Face ID sheet and — importantly — the WEB app, which
// shares these endpoints and has its own session-level auth, keeps working
// unchanged. Below the threshold the client-side gate is still the only gate,
// which is a real limitation and is stated plainly rather than papered over:
// raising the floor is a policy decision, not an engineering one, and belongs in
// stepUp.ts where the number is already written down.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requiresStepUp, type SensitiveAction } from "@furlpay/security";
import { validateAndConsumeActionProof, type CanonicalJSON } from "./actionProof";
import { audit } from "@/lib/audit";

/**
 * The field a client attaches its proof to.
 *
 * It is STRIPPED from the body before the digest is re-derived, and that is not
 * a detail — it is a chicken-and-egg problem that would otherwise make the whole
 * mechanism fail closed 100% of the time. The client has to declare the request
 * to get a challenge, so the digest is committed over a body that does not yet
 * contain a proof id. It then sends the same body WITH the proof id attached.
 * Re-deriving over the received body verbatim therefore hashes one extra field
 * and never matches.
 *
 * Stripping it here rather than in each route means one rule instead of five, and
 * a route that forgets cannot produce a mysterious "approval was for a different
 * request" on every single call.
 */
export const STEP_UP_PROOF_FIELD = "stepUpProofId";

export interface StepUpRequest {
  userId: string;
  /** Policy key — what kind of action this is. */
  action: SensitiveAction;
  /** USD value, when the action has one. Drives the threshold. */
  amountUsd?: number;
  /** Registry endpoint the proof was minted against, e.g. "/investing/order". */
  endpoint: string;
  method: string;
  /** The body being executed. The proof is re-derived from exactly this. */
  body: Record<string, CanonicalJSON>;
  /** `stepUpProofId` from the request body, if the client supplied one. */
  proofId?: unknown;
}

/**
 * Returns a `NextResponse` to return immediately, or `null` to proceed.
 *
 * Returning the response rather than throwing keeps the call site a single
 * `if`, and makes "forgot to handle it" a type error at the route rather than a
 * silent pass.
 */
export async function enforceActionStepUp(req: StepUpRequest): Promise<NextResponse | null> {
  const decision = requiresStepUp({ action: req.action, amountUsd: req.amountUsd });

  if (!decision.required) return null;

  // A missing proof is a refusal with instructions, not a 403 dead end. The
  // client is expected to call /api/actions/step-up/challenge, complete the
  // ceremony, and retry with the proofId — `stepUpRequired` is the signal it
  // keys off, matching what /api/wallets/transfer already returns.
  if (typeof req.proofId !== "string" || req.proofId.length === 0) {
    return NextResponse.json(
      {
        error: decision.reason,
        stepUpRequired: true,
        methods: ["biometric", ...decision.methods],
      },
      { status: 401 }
    );
  }

  // See STEP_UP_PROOF_FIELD: the digest was committed before this field existed.
  const { [STEP_UP_PROOF_FIELD]: _proof, ...boundBody } = req.body;

  const check = await validateAndConsumeActionProof(req.userId, req.proofId, {
    endpoint: req.endpoint,
    method: req.method,
    body: boundBody,
  });

  if (!check.valid) {
    // Audited. A proof that fails the BINDING is not a user fumbling Face ID —
    // it is a request that does not match what was approved, and it is the
    // signal worth having in the log when someone asks what happened.
    audit("auth.mfa_failed", req.userId, {
      action: `${req.action}.step_up_failed`,
      endpoint: req.endpoint,
      reason: check.reason,
    });
    return NextResponse.json(
      { error: check.reason ?? "Invalid step-up proof", stepUpRequired: true },
      { status: 401 }
    );
  }

  audit("auth.mfa_passed", req.userId, {
    action: `${req.action}.step_up_ok`,
    endpoint: req.endpoint,
  });
  return null;
}
