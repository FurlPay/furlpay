// ---------------------------------------------------------------------------
// Real FIDO2 / WebAuthn passkey ceremony state (backed by @simplewebauthn/server
// in the route handlers). Challenge + credential stores are in-memory here;
// production persists credentials (id, publicKey, counter) per user in the DB.
// ---------------------------------------------------------------------------

export interface StoredCredential {
  id: string; // base64url credential ID
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  name?: string; // human label derived from the registering device's UA
  createdAt?: string; // ISO timestamp
  lastUsedAt?: string; // ISO timestamp, stamped on each verified assertion
}

interface WebAuthnState {
  challenges: Map<string, string>; // userId -> current challenge
  credentials: Map<string, StoredCredential[]>; // userId -> credentials
}

const g = globalThis as unknown as { __webauthn?: WebAuthnState };
const state: WebAuthnState =
  g.__webauthn ?? (g.__webauthn = { challenges: new Map(), credentials: new Map() });

export const RP_NAME = "Furlpay";

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

function resolveOrigins(): string[] {
  const explicit = splitList(process.env.FURLPAY_ORIGIN);
  if (explicit.length) return explicit;
  const derived = [VERCEL_PROD_URL, VERCEL_DEPLOY_URL]
    .filter(Boolean)
    .map((u) => `https://${hostOf(u!)}`);
  if (derived.length) return Array.from(new Set(derived));
  return ["http://localhost:3000"];
}

// All accepted values for verification (assertion/attestation checks).
export const EXPECTED_RPIDS = resolveRpIDs();
export const EXPECTED_ORIGINS = resolveOrigins();

// Primary values, used where the WebAuthn API requires a single string
// (challenge/option generation). This is your registrable domain in production.
export const RP_ID = EXPECTED_RPIDS[0];
export const ORIGIN = EXPECTED_ORIGINS[0];

export function setChallenge(userId: string, challenge: string) {
  state.challenges.set(userId, challenge);
}
export function takeChallenge(userId: string): string | undefined {
  const c = state.challenges.get(userId);
  state.challenges.delete(userId);
  return c;
}

export function getCredentials(userId: string): StoredCredential[] {
  return state.credentials.get(userId) ?? [];
}
export function addCredential(userId: string, cred: StoredCredential) {
  const list = state.credentials.get(userId) ?? [];
  list.push(cred);
  state.credentials.set(userId, list);
}
export function updateCounter(userId: string, credId: string, counter: number) {
  const list = state.credentials.get(userId) ?? [];
  const c = list.find((x) => x.id === credId);
  if (c) {
    c.counter = counter;
    c.lastUsedAt = new Date().toISOString();
  }
}
export function removeCredential(userId: string, credId: string): boolean {
  const list = state.credentials.get(userId) ?? [];
  const next = list.filter((x) => x.id !== credId);
  if (next.length === list.length) return false;
  state.credentials.set(userId, next);
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
