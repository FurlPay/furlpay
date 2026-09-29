import { financialEnvironment } from "@/lib/flags";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// SR2 — payer authentication, and why this is one function instead of three.
//
// THE DEFECT. `liveMode()` was defined THREE TIMES, identically, in x402.ts,
// x402Facilitator.ts and mpp.ts:
//
//     process.env.INTEGRATION_MODE === "live" || process.env.X402_ENFORCE_SIGNATURE === "1"
//
// Two problems compounded.
//
//   1. IT FAILS OPEN. With neither variable set — which is the DEFAULT — EIP-3009
//      signature recovery is skipped and only structural checks run. A live HTTP
//      request against a production build returned `isValid:true` for a two-byte
//      signature. Production inherited the development posture by omission,
//      which is the worst way to inherit a security setting: nothing is
//      misconfigured, nobody disabled anything, and the check is simply absent.
//
//   2. THREE COPIES DRIFT. Tightening one leaves the other two, and the one that
//      matters is whichever the attacker reaches.
//
// THE RULE. Production ALWAYS enforces, and no environment variable can turn it
// off. `X402_ENFORCE_SIGNATURE=0` in production is not honoured — it is logged as
// ignored, because an operator who set it deserves to learn that it did nothing
// rather than believe it worked. Outside production the existing opt-in still
// applies, so the zero-credential development path is unchanged.
//
// WHY THE ESCAPE HATCH CANNOT LEAK INTO PRODUCTION. It is not a flag that
// production forgets to unset; it is a branch production never takes.
// `financialEnvironment()` resolves production from `FURLPAY_ENV=production`, or
// infers it from a real production build, and this function checks that FIRST.
// There is no ordering in which a variable is consulted before the environment.
// ---------------------------------------------------------------------------

/** Why signatures are (or are not) being cryptographically verified. */
export type EnforcementReason =
  /** Production. Mandatory, not configurable. */
  | "production_mandatory"
  /** Opted in outside production via INTEGRATION_MODE=live. */
  | "integration_mode_live"
  /** Opted in outside production via X402_ENFORCE_SIGNATURE=1. */
  | "explicitly_enabled"
  /** Development/staging default: structural checks only. */
  | "development_structural_only";

export interface EnforcementState {
  /** True when EIP-3009 signatures must cryptographically verify. */
  readonly enforced: boolean;
  readonly reason: EnforcementReason;
  readonly environment: ReturnType<typeof financialEnvironment>;
  /** True when a variable asked for enforcement OFF and was overruled. */
  readonly overrodeRequestToDisable: boolean;
}

/** Values that read as an explicit request to switch enforcement off. */
const DISABLE_REQUESTS = new Set(["0", "false", "no", "off"]);

/**
 * Resolve enforcement. Pure with respect to its inputs (the environment), so the
 * tests can assert every branch by setting variables rather than by mocking.
 */
export function enforcementState(): EnforcementState {
  const environment = financialEnvironment();
  const raw = (process.env.X402_ENFORCE_SIGNATURE ?? "").trim().toLowerCase();
  const askedToDisable = DISABLE_REQUESTS.has(raw);

  if (environment === "production") {
    return {
      enforced: true,
      reason: "production_mandatory",
      environment,
      overrodeRequestToDisable: askedToDisable,
    };
  }

  if (process.env.INTEGRATION_MODE === "live") {
    return {
      enforced: true,
      reason: "integration_mode_live",
      environment,
      overrodeRequestToDisable: false,
    };
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return { enforced: true, reason: "explicitly_enabled", environment, overrodeRequestToDisable: false };
  }
  return {
    enforced: false,
    reason: "development_structural_only",
    environment,
    overrodeRequestToDisable: false,
  };
}

let warnedOnce = false;

/**
 * Whether EIP-3009 signatures must cryptographically verify on this request.
 *
 * THE ONLY function any x402/MPP path may consult for this. The three previous
 * copies are gone; this replaces all of them.
 */
export function signatureEnforced(): boolean {
  const state = enforcementState();
  // Logged once per process, not per request: a per-request log on a
  // rate-limited public endpoint is an amplification the attacker controls.
  if (state.overrodeRequestToDisable && !warnedOnce) {
    warnedOnce = true;
    log.error(
      "X402_ENFORCE_SIGNATURE asked to disable signature verification in production and was IGNORED — " +
        "payer authentication is mandatory in production and cannot be switched off",
      { environment: state.environment, requested: process.env.X402_ENFORCE_SIGNATURE }
    );
  }
  return state.enforced;
}

/** Reset the once-per-process warning. Tests only. */
export function __resetEnforcementWarning(): void {
  warnedOnce = false;
}

/**
 * Assert at startup that this deployment cannot serve payments unverified.
 *
 * Exists so the guarantee is checkable by something other than reading
 * `signatureEnforced`'s implementation — a startup probe and a test can both ask
 * the question directly. Throws rather than returning false, because a
 * production process that has reached this and found enforcement off is a
 * process that must not accept traffic.
 */
export function assertProductionEnforcesSignatures(): void {
  const state = enforcementState();
  if (state.environment === "production" && !state.enforced) {
    throw new Error(
      "Refusing to serve: signature enforcement resolved to OFF in production. " +
        "This is unreachable by construction and indicates enforcementState() was modified."
    );
  }
}
