// ---------------------------------------------------------------------------
// Client-side fingerprint / biometric auth. These helpers drive the real
// browser WebAuthn ceremony via @simplewebauthn/browser, which is what pops the
// device's platform authenticator prompt — Touch ID, Face ID, Windows Hello, or
// an Android fingerprint sensor. The ceremonies are verified server-side by the
// /api/auth/passkey/* routes (backed by @simplewebauthn/server).
// ---------------------------------------------------------------------------

import {
  WebAuthnAbortService,
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
  return authenticateFingerprintBounded().result;
}

/**
 * The same ceremony, but ABANDONABLE.
 *
 * WHY A SECOND ENTRY POINT. A caller that bounds the ceremony with a timeout —
 * the card reveal gate does, at 60s — can stop waiting, but it cannot recall an
 * assertion already travelling to the server. `POST /authenticate` grants a
 * session AND calls `recordStepUp()`, so a ceremony completing after the caller
 * gave up would silently establish authorization the user was told had failed,
 * satisfying the wallet-link and account gates minutes later.
 *
 * `Promise.race` cannot fix that: racing changes which promise the CALLER reads,
 * not what the other one does. Nor can cancelling the browser prompt —
 * `WebAuthnAbortService.cancelCeremony()` aborts a prompt still on screen, but a
 * prompt already answered is already in flight, and the service is a singleton
 * that would cancel unrelated ceremonies too.
 *
 * Only the server can refuse the result, and `abandon()` is how it is asked to:
 * deleting the challenge makes verification fail before any credential lookup,
 * before a session is signed, and before `recordStepUp` is reached.
 *
 * Returns the challenge synchronously-ish via `abandon`, so the caller never has
 * to hold the options itself.
 */
export function authenticateFingerprintBounded(): {
  result: Promise<boolean>;
  /** Ask the server to refuse this ceremony. Best-effort and idempotent. */
  abandon: () => Promise<void>;
} {
  let challenge: string | undefined;
  let settled = false;

  const result = (async () => {
    const optionsJSON = await getJSON<PublicKeyCredentialRequestOptionsJSON>(
      "/api/auth/passkey/authenticate"
    );
    challenge = optionsJSON.challenge;
    const asseResp = await startAuthentication({ optionsJSON });
    const r = await sendJSON<{ verified: boolean }>("/api/auth/passkey/authenticate", asseResp);
    settled = true;
    return r.verified;
  })();

  const abandon = async (): Promise<void> => {
    // Nothing to abandon before the options arrive, and nothing to gain after the
    // assertion was already accepted — at that point the ceremony genuinely
    // completed in time and the session is legitimately issued.
    if (!challenge || settled) return;
    try {
      // Cancel a prompt still on screen as well. This is the cosmetic half: it
      // dismisses a dialog the user is no longer expected to answer. The
      // challenge delete below is the half that carries the security property.
      WebAuthnAbortService.cancelCeremony();
    } catch {
      // Not available in every environment; never let it block the delete.
    }
    await sendJSON("/api/auth/passkey/authenticate", { challenge }, "DELETE").catch(() => {
      // Best-effort by nature. If this request is itself lost, the ceremony's
      // own 300s challenge TTL is the backstop.
    });
  };

  return { result, abandon };
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
