import { Passkey } from "react-native-passkey";
import { api } from "./api";
import { haptic } from "./haptics";

// ---------------------------------------------------------------------------
// Fingerprint Pay — the mobile twin of apps/web/src/lib/biometrics/biometricPay.ts.
//
// WHY THIS EXISTS, AND WHY confirmWithBiometrics() IS NOT ENOUGH
//
// lib/biometrics.ts already prompts for Face ID / fingerprint before a money
// action, and that is the right thing for a local approval gate. But what it
// returns is a BOOLEAN INSIDE OUR OWN JAVASCRIPT. The server never sees it, so
// it proves nothing to the server: a patched build, a hooked
// LocalAuthentication, or a repackaged APK can return `true` without any
// biometric ever happening. The gate protects the UI, not the transfer.
//
// The same reasoning is already written down on the web side, in
// apps/web/src/lib/stepup.ts:
//
//     Local device biometrics do NOT count: they gate the device key, not
//     control of the server-side FurlPay account.
//
// This module closes that gap for native. It runs the SAME server protocol the
// web app uses:
//
//   1. POST /wallets/biometric-pay/challenge  -> WebAuthn options bound to
//      H(userId|amount|asset|recipient|chain|nonce)
//   2. Passkey.get(options)                   -> the assertion is signed INSIDE
//      the secure element, gated on the fingerprint, with
//      userVerification:"required" so a silent credential is refused
//   3. POST /wallets/biometric-pay/verify     -> server verifies the signature
//      and mints a single-use proofId
//   4. the transfer carries `biometricProof`, and the server re-derives the
//      digest from the transfer it is actually about to execute
//
// Step 4 is the part that matters and the part that was missing server-side
// until recently: the proof is bound to ONE payment. A proof collected for
// "$5 to addressA" cannot authorise "$5000 to addressB", so an attacker who
// shows the user a small payment and then swaps the parameters gets rejected.
//
// Nothing here replaces confirmWithBiometrics — that stays as the local
// approval UX for actions with no server-side step-up. This is for money.
// ---------------------------------------------------------------------------

export interface FingerprintPayIntent {
  amount: number;
  /** Token symbol, e.g. "USDC". */
  asset: string;
  /** Destination address, exactly as it will be submitted to the transfer. */
  recipient: string;
  /** Chain slug, exactly as it will be submitted to the transfer. */
  chain: string;
}

export interface FingerprintPayProof {
  /** Single-use token to send as `biometricProof` on the transfer. */
  proofId: string;
  /** Seconds until the proof expires — short by design. */
  expiresInSeconds: number;
}

export type FingerprintPayFailure =
  /** No platform authenticator, or no passkey registered for this account. */
  | { ok: false; reason: "unsupported" }
  /** The user dismissed the fingerprint / Face ID sheet. */
  | { ok: false; reason: "cancelled" }
  /** The server refused the assertion, or the challenge expired. */
  | { ok: false; reason: "rejected"; message: string };

export type FingerprintPayResult = ({ ok: true } & FingerprintPayProof) | FingerprintPayFailure;

/** Options JSON from the server; handed to the authenticator untouched. */
type OptionsJSON = Record<string, unknown>;

export function isFingerprintPaySupported(): boolean {
  try {
    return Passkey.isSupported();
  } catch {
    // Older devices and some OEM builds throw rather than returning false.
    return false;
  }
}

/**
 * Cancellation, as reported by the OS.
 *
 * react-native-passkey surfaces a user dismissal as a thrown error with an
 * inconsistent shape across Android Credential Manager and iOS
 * AuthenticationServices, so the check is deliberately broad. Getting this wrong
 * in the OTHER direction is what matters: reporting "payment failed" when the
 * user simply changed their mind would send them to support over nothing.
 */
function isCancellation(err: unknown): boolean {
  const text = `${(err as { error?: string })?.error ?? ""} ${(err as Error)?.message ?? ""}`;
  return /cancel|abort|UserCancelled|NotAllowedError|dismiss/i.test(text);
}

/**
 * Authorize ONE payment with the device biometric, returning a server-verified
 * single-use proof.
 *
 * The intent passed here MUST be the exact parameters the transfer will carry.
 * The server re-derives the digest from the transfer at execution time, so any
 * difference — a rounded amount, a checksummed address, a different chain —
 * fails the binding and the transfer falls back to TOTP. That is the intended
 * behaviour, not a bug to work around by loosening the intent.
 */
export async function authorizePaymentWithFingerprint(
  intent: FingerprintPayIntent
): Promise<FingerprintPayResult> {
  if (!isFingerprintPaySupported()) return { ok: false, reason: "unsupported" };

  // 1 — transaction-bound challenge.
  let challengeId: string;
  let options: OptionsJSON;
  try {
    const res = await api<{ challengeId: string; options: OptionsJSON }>(
      "/wallets/biometric-pay/challenge",
      { method: "POST", body: intent }
    );
    challengeId = res.challengeId;
    options = res.options;
  } catch (err) {
    // The commonest cause is "no passkeys registered for biometric payment",
    // which is a setup state rather than a failure — the caller offers
    // enrolment instead of an error.
    const message = (err as Error)?.message ?? "";
    if (/no passkey/i.test(message)) return { ok: false, reason: "unsupported" };
    return { ok: false, reason: "rejected", message: message || "Could not start biometric approval." };
  }

  // 2 — the assertion is signed in the secure element, gated on the biometric.
  let assertion: unknown;
  try {
    assertion = await Passkey.get(options as never);
  } catch (err) {
    if (isCancellation(err)) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "rejected", message: "Biometric approval did not complete." };
  }

  // 3 — server-side verification mints the single-use proof.
  try {
    const res = await api<{ proofId: string; expiresInSeconds: number }>(
      "/wallets/biometric-pay/verify",
      { method: "POST", body: { challengeId, assertion } }
    );
    // Confirmation only AFTER the server accepted it. Buzzing on the local
    // biometric would tell the user they had paid before anything was verified.
    haptic.success();
    return { ok: true, proofId: res.proofId, expiresInSeconds: res.expiresInSeconds };
  } catch (err) {
    haptic.error();
    return {
      ok: false,
      reason: "rejected",
      message: (err as Error)?.message || "That approval was not accepted. Please try again.",
    };
  }
}

/**
 * Human-readable copy for a failure.
 *
 * Kept next to the failure type so a new reason cannot ship without a string,
 * and deliberately free of blame or false certainty: a cancelled approval is not
 * an error, and a rejected one does not claim where the fault lies.
 */
export function fingerprintPayMessage(failure: FingerprintPayFailure): string {
  switch (failure.reason) {
    case "unsupported":
      return "This device can't approve payments with a fingerprint yet. Add a passkey in Settings → Security.";
    case "cancelled":
      return "Approval cancelled. Nothing was sent.";
    case "rejected":
      return failure.message;
  }
}
