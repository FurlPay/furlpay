// ---------------------------------------------------------------------------
// Step-up verification — what the app does when the server answers
// `{ error: "step_up_required" }` (apps/web/src/lib/ramp/rampGuard.ts).
//
// WHAT COUNTS. The server accepts only a fresh OTP or passkey ceremony bound
// to THIS session (lib/stepup.ts on the web side). Face ID / fingerprint on the
// phone is shown first because it stops someone holding an unlocked phone, but
// it is NOT the step-up: a local biometric result never reaches the server in
// a form it could trust. So the flow is:
//
//   1. device-owner prompt (biometric or device PIN)  — local
//   2. passkey, or a code sent to the account's OWN email — server-verified
//   3. the server issues a fresh session with the step-up recorded on it
//   4. back to the screen that asked, which retries
//
// The email is the account's, read from /api/profile and not editable here:
// completing a code for a different address would sign into a different
// account, not step up this one.
//
// No selfie / liveness step: no identity provider is selected (it would be a
// screen that verifies nothing).
// ---------------------------------------------------------------------------

import { ApiError } from "./api";

/** Step-up windows are 15 minutes server-side; a step-up is single-use per payout. */
export const STEP_UP_WINDOW_MINUTES = 15;

/** True when an API failure is the server asking for a step-up. */
export function isStepUpRequired(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 401) return false;
  const d = (e.data ?? {}) as { error?: string };
  return d.error === "step_up_required";
}

/** Only in-app routes may be returned to after a step-up (no open redirect). */
export function safeReturnPath(raw: unknown, fallback = "/(tabs)"): string {
  return typeof raw === "string" && /^\/[a-z0-9\-/()]*$/i.test(raw) && !raw.startsWith("//") ? raw : fallback;
}

/** A six-digit (or longer) numeric code, trimmed. Null when it cannot be a code. */
export function parseOtp(text: string): string | null {
  const t = text.replace(/\s+/g, "");
  return /^\d{4,10}$/.test(t) ? t : null;
}
