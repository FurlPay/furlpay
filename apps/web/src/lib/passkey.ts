// ---------------------------------------------------------------------------
// Client-side fingerprint / biometric auth. These helpers drive the real
// browser WebAuthn ceremony via @simplewebauthn/browser, which is what pops the
// device's platform authenticator prompt — Touch ID, Face ID, Windows Hello, or
// an Android fingerprint sensor. The ceremonies are verified server-side by the
// /api/auth/passkey/* routes (backed by @simplewebauthn/server).
// ---------------------------------------------------------------------------

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { getJSON, sendJSON } from "@/lib/api";

/**
 * True when the device exposes a built-in biometric sensor (fingerprint / face)
 * that we can enroll or verify against. Use this to decide whether to surface
 * the fingerprint affordance.
 */
export async function isFingerprintAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/**
 * Enroll the device fingerprint as a passkey. Fetches registration options,
 * runs the create() ceremony (biometric prompt), then verifies the attestation
 * server-side. Resolves true when the credential is stored and a session issued.
 */
export async function registerFingerprint(): Promise<boolean> {
  const optionsJSON = await getJSON<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/register"
  );
  const attResp = await startRegistration({ optionsJSON });
  const r = await sendJSON<{ verified: boolean }>("/api/auth/passkey/register", attResp);
  return r.verified;
}

/**
 * Unlock with the device fingerprint. Fetches authentication options, runs the
 * get() ceremony (biometric prompt), then verifies the assertion server-side.
 * Resolves true when the signature checks out and a session is issued.
 */
export async function authenticateFingerprint(): Promise<boolean> {
  const optionsJSON = await getJSON<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/passkey/authenticate"
  );
  const asseResp = await startAuthentication({ optionsJSON });
  const r = await sendJSON<{ verified: boolean }>("/api/auth/passkey/authenticate", asseResp);
  return r.verified;
}

/**
 * Normalizes the errors startRegistration/startAuthentication can throw into a
 * short, user-facing message. A user who dismisses the biometric prompt raises
 * NotAllowedError; treat that as a cancel rather than a failure.
 */
export function passkeyErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Fingerprint prompt was cancelled or timed out.";
  if (name === "InvalidStateError") return "This device is already enrolled.";
  const msg = (e as { message?: string })?.message;
  return msg || "Fingerprint authentication failed.";
}
