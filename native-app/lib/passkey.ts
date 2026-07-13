import { Passkey } from "react-native-passkey";
import { api } from "./api";

// ---------------------------------------------------------------------------
// Native passkey (WebAuthn) — the mobile twin of apps/web/src/lib/passkey.ts.
//
// The ceremony is identical to the web one and hits the SAME endpoints; only the
// authenticator differs. On web, @simplewebauthn/browser drives navigator
// .credentials; here, react-native-passkey drives Android's Credential Manager,
// so the private key is generated and held in the device's secure element and
// gated on the fingerprint. It never leaves the phone — which is exactly what
// the marketing on /login promises but the app has never actually done.
//
// Two things make this work at all, and both are easy to get wrong:
//
//  1. rpId is furlpay.com, but a NATIVE caller's origin is
//     `android:apk-key-hash:<base64url(SHA-256(signing cert))>`, not an https
//     URL. The server must list that in expectedOrigin — see
//     FURLPAY_ANDROID_CERT_SHA256 in apps/web/src/lib/webauthn.ts.
//  2. Android will only let this app speak for furlpay.com because
//     /.well-known/assetlinks.json publishes
//     `delegate_permission/common.get_login_creds` for com.furlpay.app.
//
// The server returns the session JWT in the body for mobile clients (the
// X-Furlpay-Client header is set by lib/api.ts).
// ---------------------------------------------------------------------------

/** Options JSON from the server; passed to the authenticator untouched. */
type OptionsJSON = Record<string, unknown>;

export function isPasskeySupported(): boolean {
  return Passkey.isSupported();
}

/**
 * Sign in with the device fingerprint. Fetches authentication options, runs the
 * get() ceremony (biometric prompt), verifies the assertion server-side.
 * Resolves the session token.
 */
export async function authenticateWithPasskey(): Promise<string> {
  const options = await api<OptionsJSON>("/auth/passkey/authenticate", { anonymous: true });
  const assertion = await Passkey.get(options as never);
  const res = await api<{ verified: boolean; token?: string }>("/auth/passkey/authenticate", {
    method: "POST",
    body: assertion,
    anonymous: true,
  });
  if (!res.verified || !res.token) throw new Error("Passkey was not accepted.");
  return res.token;
}

/**
 * Enroll this device's fingerprint as a passkey. Also returns a session token —
 * registering proves possession, so it signs you in too (same as web).
 */
export async function registerPasskey(): Promise<string> {
  const options = await api<OptionsJSON>("/auth/passkey/register", { anonymous: true });
  const attestation = await Passkey.create(options as never);
  const res = await api<{ verified: boolean; token?: string }>("/auth/passkey/register", {
    method: "POST",
    body: attestation,
    anonymous: true,
  });
  if (!res.verified || !res.token) throw new Error("Passkey could not be registered.");
  return res.token;
}

/**
 * Approve one 3DS2 card-auth challenge with the device fingerprint.
 *
 * The server binds the WebAuthn challenge to this specific purchase in
 * /options, so the resulting signature cannot be replayed to approve a
 * different one. Both calls ride the session token (not anonymous) — the
 * assertion proves user presence ON TOP of the session, it doesn't replace it.
 *
 * Throws ApiError 412 when no passkey is enrolled for the account — callers
 * should route the user to enrollment, not show a generic failure.
 */
export async function approveCardChallenge(challengeId: string): Promise<void> {
  const options = await api<OptionsJSON>("/cards/challenges/options", {
    method: "POST",
    body: { challengeId },
  });
  const assertion = await Passkey.get(options as never);
  await api("/cards/challenges/verify", {
    method: "POST",
    body: { challengeId, decision: "approved", assertion },
  });
}

/**
 * Turn the authenticator's errors into something a human can act on. A user who
 * dismisses the fingerprint sheet raises a cancellation — that's not a failure,
 * and must not be shown as one.
 */
export function passkeyErrorMessage(e: unknown): string {
  const err = e as { error?: string; name?: string; message?: string };
  const code = err?.error ?? err?.name ?? "";
  if (/cancel/i.test(code)) return "Fingerprint prompt was cancelled.";
  if (/NotSupported/i.test(code)) return "This device doesn't support passkeys.";
  if (/InvalidState/i.test(code)) return "This device is already enrolled.";
  if (/NoCredential|NotAllowed/i.test(code)) {
    return "No passkey found on this device. Create one first, or sign in another way.";
  }
  return err?.message || "Fingerprint sign-in failed.";
}
