// ---------------------------------------------------------------------------
// The account page's data layer, and an honest map of what is actually wired.
//
// Every function here either calls a route that exists today, or is a named
// integration point that throws `NotWiredError`. Nothing in this module
// pretends: a capability without a backend does not resolve successfully with
// a fabricated result, because a settings screen that reports "saved" and
// changes nothing is worse than one that says it cannot save yet.
//
// WIRED TODAY
//   getProfile / patchProfile      GET|PATCH /api/profile
//   getMfa / enrollMfa / verifyMfa / disableMfa
//                                  GET|POST  /api/security/mfa
//   getPasskeys / deletePasskey    GET|DELETE /api/auth/passkey/credentials
//   getLinkedWallet                GET /api/wallet/link  (404s when the
//                                  deployment has wallet linking switched off)
//   getDeletionPreview             GET /api/account
//
// NOT WIRED — UI is built, integration point is marked
//   uploadAvatar        No object storage is configured in this app (no Blob,
//                       no S3, no Supabase Storage). lib/profileAvatar.ts says
//                       so explicitly and only stores an https URL from an
//                       identity provider we authenticate against. A real
//                       upload needs a bucket plus a signed-URL route first.
//   setUsername         `User` has `name` and `email` and no handle field. A
//                       username needs a column, a uniqueness index and a
//                       reservation/collision policy — not a client-side field.
//   getBackupCodes      /api/security/mfa implements enroll/verify/disable and
//                       has no recovery-code store. Codes must be generated,
//                       hashed and single-use server-side.
//   revokeSession       The device list is read-only account state. Revocation
//                       needs a session table keyed by jti (the logout route
//                       revokes only the CALLING session's jti today).
//   startVerification   There is no /api/kyc. `kycStatus`/`kycTier` are read
//                       from the account; nothing starts a verification flow.
//   disconnectWallet    /api/wallet/link exposes GET only. Unlinking needs a
//                       DELETE with the same step-up the link required.
//   savePreferences     Theme / language / currency have no columns on `User`.
//                       Stored per-device below so the control is real, with
//                       the server sync marked pending.
// ---------------------------------------------------------------------------

import { getJSON, sendJSON } from "@/lib/api";

/** Thrown by an integration point whose backend does not exist yet. The UI
 *  catches it and shows the "not available on this deployment" state rather
 *  than a generic failure, so the two are never confused. */
export class NotWiredError extends Error {
  readonly capability: string;
  constructor(capability: string, detail: string) {
    super(detail);
    this.name = "NotWiredError";
    this.capability = capability;
  }
}

// ── Profile ────────────────────────────────────────────────────────────────

export interface Device {
  name: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export interface Profile {
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string | null;
  /** Internal account identifier. NOT a wallet and NOT a destination — see
   *  lib/receiveAddress.ts for why this must never be rendered as one. */
  accountReference: string;
  /** The only address funds may be sent to. Null until a wallet is linked and
   *  its EIP-191 proof verified. */
  receiveAddress: {
    address: string;
    verifiedBy: "eip191";
    verifiedAt: string;
    chainFamily: "evm";
  } | null;
  receiveAddressUnavailableReason: "no_wallet_linked" | "link_not_verified" | null;
  kycStatus: "verified" | "pending" | "unverified";
  region: string;
  tier: "Standard" | "Pro" | "Ultra";
  security: {
    biometricEnabled: boolean;
    accountLocked: boolean;
    lastLogin: string;
    loginAlerts: boolean;
    totpEnabled: boolean;
    hardwareKeys: { name: string; addedAt: string }[];
    devices: Device[];
  };
  notifications: {
    transactions: boolean;
    security: boolean;
    priceAlerts: boolean;
    product: boolean;
  };
}

export const getProfile = () => getJSON<Profile>("/api/profile");

export const patchProfile = (body: Record<string, unknown>) =>
  sendJSON("/api/profile", body, "PATCH");

// ── Two-factor authentication ──────────────────────────────────────────────

export interface MfaState {
  totpEnabled: boolean;
  hardwareKeys: { name: string; addedAt: string }[];
  /** How many single-use recovery codes are left. Never the codes themselves. */
  recoveryCodesRemaining: number;
}

export const getMfa = () => getJSON<MfaState>("/api/security/mfa");

/** Returns the shared secret and its otpauth URI, once, for QR enrollment.
 *  Enrollment does NOT switch 2FA on — `verifyMfa` does, after the user proves
 *  they can generate a code. */
export const enrollMfa = () =>
  sendJSON<{ secret: string; otpauthUrl: string }>(
    "/api/security/mfa",
    { action: "enroll" },
    "POST"
  );

/**
 * Switches TOTP on after the user proves they can generate a code.
 *
 * Returns the recovery codes, ONCE. The server stores only their hashes, so
 * this response is the single opportunity to show them — the caller must render
 * them and tell the user to save them, not log or discard them.
 */
export const verifyMfa = (code: string) =>
  sendJSON<{
    success: boolean;
    totpEnabled: boolean;
    recoveryCodes: string[];
    recoveryCodesRemaining: number;
  }>("/api/security/mfa", { action: "verify", code }, "POST");

/**
 * Turns TOTP off. REQUIRES a current authenticator code or a recovery code.
 *
 * It did not used to. The route disabled on the authenticated session alone,
 * which meant the second factor could be removed with only the first — a stolen
 * session was enough to strip MFA and keep long-term access. This client even
 * documented that it "deliberately sends NO code". Both sides are fixed: the
 * server verifies, and the caller must collect the code.
 */
export const disableMfa = (code: string) =>
  sendJSON<{ success: boolean; totpEnabled: boolean }>(
    "/api/security/mfa",
    { action: "disable", code },
    "POST"
  );

/**
 * Replaces the recovery-code set, invalidating the old one.
 *
 * Behind the same proof as disabling, because it is a credential change.
 */
export const regenerateRecoveryCodes = (code: string) =>
  sendJSON<{ success: boolean; recoveryCodes: string[]; recoveryCodesRemaining: number }>(
    "/api/security/mfa",
    { action: "regenerate-recovery", code },
    "POST"
  );

/**
 * How many single-use recovery codes remain.
 *
 * This used to throw `NotWiredError` — correctly, because the server had no
 * store and handing the user a printout that unlocks nothing is worse than
 * admitting the gap. The store now exists (`lib/mfaRecovery.ts`: SHA-256 hashes,
 * single use, constant-time compare), so the count is real.
 *
 * Only a COUNT is available by design. The codes are returned exactly once, by
 * `verifyMfa` or `regenerateRecoveryCodes`; the server keeps hashes and cannot
 * reproduce them afterwards.
 */
export async function getBackupCodes(): Promise<{ remaining: number }> {
  const state = await getJSON<MfaState>("/api/security/mfa");
  return { remaining: state.recoveryCodesRemaining ?? 0 };
}

// ── Sign-in methods (passkeys) ─────────────────────────────────────────────

export interface PasskeyCredential {
  id: string;
  name: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  transports?: string[];
}

export const getPasskeys = () =>
  getJSON<{ credentials: PasskeyCredential[]; safeAddress: string }>(
    "/api/auth/passkey/credentials"
  );

/**
 * Revokes one passkey.
 *
 * Hand-rolled rather than `sendJSON`, which only speaks POST and PATCH. The
 * server's refusals are meaningful and are surfaced verbatim: it returns 409
 * when this is the account's ONLY passkey, because removing it would lock the
 * user out — a message the UI must show rather than flatten into "failed".
 */
export async function deletePasskey(credentialId: string): Promise<void> {
  const res = await fetch("/api/auth/passkey/credentials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error || `Could not remove this passkey (${res.status}).`);
}

// ── Wallet ─────────────────────────────────────────────────────────────────

export interface LinkedWalletInfo {
  address: string;
  chainFamily: string;
  verificationMethod: string;
  verifiedAt: string;
  status: string;
}

/** Resolves `null` both when nothing is linked and when this deployment has
 *  wallet linking switched off (the route 404s) — the UI distinguishes them
 *  by asking `linkingEnabled` separately is not possible, so it treats both as
 *  "no wallet linked" and offers the connect flow, which reports the 404. */
export const getLinkedWallet = () =>
  getJSON<{ linked: LinkedWalletInfo | null }>("/api/wallet/link");

/**
 * TODO(integration): unlink.
 *
 * /api/wallet/link is GET-only. A DELETE must require the same step-up the
 * link did — an attacker with a live session should not be able to detach a
 * proven self-custodial address silently.
 */
export async function disconnectWallet(): Promise<void> {
  throw new NotWiredError(
    "wallet-disconnect",
    "Unlinking needs a step-up-guarded DELETE on /api/wallet/link, which does not exist yet."
  );
}

// ── Verification / KYC ─────────────────────────────────────────────────────

/**
 * TODO(integration): start verification.
 *
 * `kycStatus` and `kycTier` are read from the account record; no route starts
 * a verification session. Wiring this means a provider (Persona/Sumsub), a
 * hosted-flow URL per user and a signed webhook that moves the tier — the
 * client must never set its own KYC state.
 */
export async function startVerification(): Promise<{ url: string }> {
  throw new NotWiredError(
    "kyc-start",
    "There is no /api/kyc route; verification status is read-only account state today."
  );
}

// ── Avatar & username ──────────────────────────────────────────────────────

/**
 * TODO(integration): avatar upload.
 *
 * There is no object storage in this app — see lib/profileAvatar.ts, which
 * stores only an https URL on a provider host we authenticate against, and
 * says why. An upload needs a bucket, a signed-upload route, content-type and
 * size validation, and image re-encoding to strip EXIF before anything is
 * served back.
 */
export async function uploadAvatar(_file: File): Promise<{ avatarUrl: string }> {
  throw new NotWiredError(
    "avatar-upload",
    "No object storage is configured on this deployment, so there is nowhere to upload a picture yet."
  );
}

/**
 * TODO(integration): username.
 *
 * The account record has a display `name` and an `email` and no handle. A
 * username needs its own column, a uniqueness constraint, a reserved-word list
 * and a rename policy before the UI can offer one.
 */
export async function setUsername(_username: string): Promise<void> {
  throw new NotWiredError(
    "username",
    "The account record has no username field yet — only a display name and an email."
  );
}

// ── Sessions ───────────────────────────────────────────────────────────────

/**
 * TODO(integration): revoke a session.
 *
 * `security.devices` is descriptive account state. Revocation needs a session
 * table keyed by the JWT `jti`; /api/auth/logout revokes only the jti of the
 * session making the call, so there is nothing to target another device with.
 */
export async function revokeSession(_deviceName: string): Promise<void> {
  throw new NotWiredError(
    "session-revoke",
    "Revoking another device needs a per-jti session table; logout only revokes the calling session."
  );
}

// ── Per-device preferences ─────────────────────────────────────────────────

export interface DevicePreferences {
  language: string;
  currency: string;
}

const PREFS_KEY = "furlpay:account:prefs";

export const DEFAULT_PREFERENCES: DevicePreferences = { language: "en", currency: "USD" };

/**
 * Preferences that genuinely persist — on this device.
 *
 * localStorage rather than a fabricated server call: there are no columns for
 * these on the account, so a "saved" toast backed by nothing would be the lie
 * this module exists to avoid. The UI says plainly that they are per-device
 * until the preferences API lands.
 */
export function loadPreferences(): DevicePreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DevicePreferences>;
    return {
      language: typeof parsed.language === "string" ? parsed.language : DEFAULT_PREFERENCES.language,
      currency: typeof parsed.currency === "string" ? parsed.currency : DEFAULT_PREFERENCES.currency,
    };
  } catch {
    // A private window, cleared site data, or storage disabled entirely.
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(next: DevicePreferences): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

// ── Account deletion ───────────────────────────────────────────────────────

export interface Retained {
  record: string;
  reason: string;
}

export interface DeletionPreview {
  stepUpSatisfied: boolean;
  retained: Retained[];
}

export const getDeletionPreview = () => getJSON<DeletionPreview>("/api/account");
