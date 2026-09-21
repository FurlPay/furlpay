// ---------------------------------------------------------------------------
// Real FIDO2 / WebAuthn passkey ceremony state (backed by @simplewebauthn/server
// in the route handlers).
//
// Challenges and credentials live in KV (Redis), NOT in memory. This is load-
// bearing, not tidiness: a WebAuthn ceremony is two requests — a GET that mints
// the challenge and a POST that verifies the assertion against it. On serverless
// those two routinely land on DIFFERENT instances, so an in-memory Map made the
// POST fail with "No pending challenge" more often than not, and any registered
// credential vanished on the next cold start. Passkeys cannot work at all
// without a shared store.
// ---------------------------------------------------------------------------

import { kvGet, kvSet, kvDel, kvSetNx } from "./kv";

export interface StoredCredential {
  id: string; // base64url credential ID
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  name?: string; // human label derived from the registering device's UA
  createdAt?: string; // ISO timestamp
  lastUsedAt?: string; // ISO timestamp, stamped on each verified assertion
}

/** Wire form: publicKey is bytes, and JSON can't carry a Uint8Array. */
interface CredentialRow extends Omit<StoredCredential, "publicKey"> {
  publicKeyB64: string;
}

const CHALLENGE_KEY = (userId: string) => `webauthn:chal:${userId}`;
const CREDS_KEY = (userId: string) => `webauthn:creds:${userId}`;
/** A ceremony the user doesn't finish in 5 minutes is abandoned. */
const CHALLENGE_TTL_S = 300;

const toRow = (c: StoredCredential): CredentialRow => {
  const { publicKey, ...rest } = c;
  return { ...rest, publicKeyB64: Buffer.from(publicKey).toString("base64") };
};
const fromRow = (r: CredentialRow): StoredCredential => {
  const { publicKeyB64, ...rest } = r;
  return { ...rest, publicKey: new Uint8Array(Buffer.from(publicKeyB64, "base64")) };
};

export const RP_NAME = "FurlPay";

// ---------------------------------------------------------------------------
// Relying Party configuration.
//
// The rpID and expected origin(s) are resolved from EXPLICIT server config —
// never from the request `Host` header. Deriving the rpID from a client-supplied
// header is the single most common WebAuthn deployment mistake: because the Host
// header is attacker-controllable behind a reverse proxy, it lets a phishing
// origin bind credentials to your domain and defeats WebAuthn's core anti-
// phishing guarantee. See web.dev/articles/webauthn-rp-id.
//
// Precedence:
//   1. FURLPAY_RP_ID / FURLPAY_ORIGIN (comma-separated to allow multiple)
//   2. Vercel-provided deploy URLs (stable prod domain + per-deploy preview URL)
//   3. localhost dev defaults
//
// SimpleWebAuthn accepts arrays for expectedOrigin/expectedRPID, so we verify
// against every configured origin/host while still generating options with a
// single primary rpID (the registrable eTLD+1, e.g. "furlpay.app").
// ---------------------------------------------------------------------------

function hostOf(value: string): string {
  const withScheme = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Vercel injects these automatically at build/runtime.
// VERCEL_PROJECT_PRODUCTION_URL — stable production domain (e.g. furlpay.app)
// VERCEL_URL — per-deployment URL (preview/branch, e.g. web-git-x.vercel.app)
const VERCEL_PROD_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const VERCEL_DEPLOY_URL = process.env.VERCEL_URL;

function resolveRpIDs(): string[] {
  const explicit = splitList(process.env.FURLPAY_RP_ID);
  if (explicit.length) return explicit;
  const derived = [VERCEL_PROD_URL, VERCEL_DEPLOY_URL].filter(Boolean).map((u) => hostOf(u!));
  if (derived.length) return Array.from(new Set(derived));
  return ["localhost"];
}

/**
 * The Android app's WebAuthn origin.
 *
 * A native Android caller does NOT present `https://furlpay.com` as its origin —
 * Google Play Services presents `android:apk-key-hash:<base64url(SHA-256(signing
 * cert))>`. If that string isn't in expectedOrigin, every assertion from the app
 * is rejected with an origin mismatch, no matter how correct the ceremony is.
 *
 * The rpID stays `furlpay.com`; what binds the app to it is the
 * `delegate_permission/common.get_login_creds` relation already published in
 * /.well-known/assetlinks.json for com.furlpay.app.
 *
 * Configure with the signing cert's SHA-256 (hex, colons optional). For the
 * upload key that is 15:92:F6:8B:…:29:13, which yields
 *   android:apk-key-hash:FZL2i74WWu9H61EwOaJk70GVblJ3y4opm56t5sETKRM
 * NOTE: after Play App Signing re-signs the app, the cert on real devices is
 * Play's, so this must list the PLAY app-signing SHA-256 too (comma-separated),
 * exactly like assetlinks.json.
 */
function androidOrigins(): string[] {
  return splitList(process.env.FURLPAY_ANDROID_CERT_SHA256).map((hex) => {
    const bytes = Buffer.from(hex.replace(/:/g, "").trim(), "hex");
    const b64url = bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `android:apk-key-hash:${b64url}`;
  });
}

/**
 * The browser extension's WebAuthn origin.
 *
 * Since Chrome 122 an extension may call navigator.credentials.get() with an
 * rpID for any domain in its host_permissions — the FurlPay extension declares
 * `https://furlpay.com/*`, so it can assert a furlpay.com passkey directly. The
 * browser presents the caller's origin as `chrome-extension://<id>`, which the
 * RP must accept explicitly or every assertion fails on origin mismatch (same
 * mechanic as the Android apk-key-hash above).
 *
 * SECURITY — read before setting this. Trusting this origin widens the signing
 * surface from "one web origin we control" to "that origin PLUS whatever the
 * extension build pipeline ships". It stays phishing-resistant (an arbitrary
 * website still cannot assert), but a malicious extension update becomes a way
 * to approve payments. Therefore:
 *   - Pin EXACT extension ids. Never a wildcard, never a pattern.
 *   - Only list ids you publish. An id you don't control is a signing key you
 *     handed to someone else.
 *   - Unset (the default) means extension assertions are simply rejected.
 */
function extensionOrigins(): string[] {
  return splitList(process.env.FURLPAY_EXTENSION_ID)
    .map((id) => id.trim().replace(/^chrome-extension:\/\//, "").replace(/\/+$/, ""))
    // Chrome extension ids are exactly 32 chars, a-p. Anything else is a
    // misconfiguration and must not silently become a trusted origin.
    .filter((id) => /^[a-p]{32}$/.test(id))
    .map((id) => `chrome-extension://${id}`);
}

function resolveOrigins(): string[] {
  const android = androidOrigins();
  const extension = extensionOrigins();
  const explicit = splitList(process.env.FURLPAY_ORIGIN);
  if (explicit.length) return Array.from(new Set([...explicit, ...android, ...extension]));
  const derived = [VERCEL_PROD_URL, VERCEL_DEPLOY_URL]
    .filter(Boolean)
    .map((u) => `https://${hostOf(u!)}`);
  if (derived.length) return Array.from(new Set([...derived, ...android, ...extension]));
  return ["http://localhost:3000", ...android, ...extension];
}

// All accepted values for verification (assertion/attestation checks).
export const EXPECTED_RPIDS = resolveRpIDs();
export const EXPECTED_ORIGINS = resolveOrigins();

// Primary values, used where the WebAuthn API requires a single string
// (challenge/option generation). This is your registrable domain in production.
export const RP_ID = EXPECTED_RPIDS[0];
export const ORIGIN = EXPECTED_ORIGINS[0];

export async function setChallenge(userId: string, challenge: string): Promise<void> {
  await kvSet(CHALLENGE_KEY(userId), challenge, CHALLENGE_TTL_S);
}
/** Single-use: the challenge is consumed on read, so an assertion can't be replayed. */
export async function takeChallenge(userId: string): Promise<string | undefined> {
  const c = await kvGet<string>(CHALLENGE_KEY(userId));
  if (c) await kvDel(CHALLENGE_KEY(userId));
  return c ?? undefined;
}

export async function getCredentials(userId: string): Promise<StoredCredential[]> {
  const rows = await kvGet<CredentialRow[]>(CREDS_KEY(userId));
  return (rows ?? []).map(fromRow);
}
export async function addCredential(userId: string, cred: StoredCredential): Promise<void> {
  const list = await getCredentials(userId);
  list.push(cred);
  await kvSet(CREDS_KEY(userId), list.map(toRow));
}
export async function updateCounter(userId: string, credId: string, counter: number): Promise<void> {
  const list = await getCredentials(userId);
  const c = list.find((x) => x.id === credId);
  if (!c) return;
  c.counter = counter;
  c.lastUsedAt = new Date().toISOString();
  await kvSet(CREDS_KEY(userId), list.map(toRow));
}
export async function removeCredential(userId: string, credId: string): Promise<boolean> {
  const list = await getCredentials(userId);
  const next = list.filter((x) => x.id !== credId);
  if (next.length === list.length) return false;
  await kvSet(CREDS_KEY(userId), next.map(toRow));
  // Drop the ownership claim too, or the id stays reserved forever and the
  // same authenticator could never be re-registered.
  await clearCredentialOwner(credId);
  return true;
}

/* -------------------------- credential ownership --------------------------- */
//
// WHY THIS INDEX EXISTS
// =====================
// Credentials were stored ONLY as `webauthn:creds:<userId>` — a per-user list
// with no way back. So an assertion arriving with a credential id could not be
// mapped to its owner, and every passkey route resolved the user as
// `db.user`: the shared seeded demo account. Registration filed every
// credential under that one account and authentication issued a session for
// it, regardless of which passkey was presented.
//
// A WebAuthn assertion identifies the CREDENTIAL, not the user. The relying
// party is what turns one into the other, so that mapping has to exist as
// data. This is it: one key per credential, global, pointing at its owner.

const OWNER_KEY = (credId: string) => `webauthn:owner:${credId}`;

/**
 * Claim a credential id for a user. Returns false if it is already claimed.
 *
 * SETNX, deliberately: the index doubles as the uniqueness constraint. A
 * credential id is globally unique by construction in WebAuthn, so a second
 * claim means either a replayed registration or an id collision — and either
 * way the safe answer is to refuse rather than silently repoint an existing
 * credential at a different account.
 */
export async function claimCredentialOwner(credId: string, userId: string): Promise<boolean> {
  // No TTL: ownership outlives any ceremony. It is cleared explicitly by
  // removeCredential and by account deletion.
  return kvSetNx(OWNER_KEY(credId), userId, OWNERSHIP_TTL_S);
}

export async function getCredentialOwner(credId: string): Promise<string | undefined> {
  return (await kvGet<string>(OWNER_KEY(credId))) ?? undefined;
}

export async function clearCredentialOwner(credId: string): Promise<void> {
  await kvDel(OWNER_KEY(credId));
}

/**
 * Ten years. Upstash requires a TTL on SETNX, and "never" is not expressible;
 * this is long enough to mean never in practice while still letting an
 * abandoned index entry age out rather than leak forever.
 */
const OWNERSHIP_TTL_S = 10 * 365 * 24 * 60 * 60;

/* --------------------------- ceremony challenges --------------------------- */
//
// Keyed by the CHALLENGE, not by the user.
//
// The old scheme stored one challenge per user id, which only works if the
// server already knows who is signing in. It does not: that is the whole point
// of a discoverable-credential ("usernameless") flow, where the user is
// revealed by the assertion. Keying on the challenge lets the options endpoint
// mint one without naming a user, and lets verification look up exactly the
// challenge the authenticator signed over.
//
// Still single-use and still 300s, so the replay property is unchanged.

const CEREMONY_KEY = (challenge: string) => `webauthn:chal:c:${challenge}`;

export async function putCeremonyChallenge(challenge: string): Promise<void> {
  await kvSet(CEREMONY_KEY(challenge), 1, CHALLENGE_TTL_S);
}

/** Consumed on read — a challenge verifies at most one assertion. */
export async function consumeCeremonyChallenge(challenge: string): Promise<boolean> {
  const hit = await kvGet<number>(CEREMONY_KEY(challenge));
  if (hit === null || hit === undefined) return false;
  await kvDel(CEREMONY_KEY(challenge));
  return true;
}

/** Coarse device label from the registering request's User-Agent — for display only. */
export function deviceLabelFromUA(ua: string | null): string {
  const s = ua ?? "";
  const os = /iPhone|iPad/.test(s)
    ? "iOS"
    : /Android/.test(s)
      ? "Android"
      : /Mac OS X/.test(s)
        ? "macOS"
        : /Windows/.test(s)
          ? "Windows"
          : /Linux/.test(s)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /Firefox\//.test(s)
      ? "Firefox"
      : /Chrome\//.test(s)
        ? "Chrome"
        : /Safari\//.test(s)
          ? "Safari"
          : "Browser";
  return `${browser} on ${os}`;
}
