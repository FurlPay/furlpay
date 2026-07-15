import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Signed session tokens via `jose` (pure Web Crypto -> works in Edge middleware,
// unlike jsonwebtoken). Short-lived HS256 access token in an HttpOnly cookie.
//
// Every token carries:
//   sub   — the user id (resolved from a verified identity, never assumed)
//   roles — authorization roles ("user" | "compliance_officer" | "admin")
//   jti   — unique token id, so individual sessions can be revoked (logout,
//           account lock) instead of remaining valid until expiry.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "furlpay_session";
const ALG = "HS256";
const TTL_SECONDS = 60 * 60; // 1h access token

const DEV_FALLBACK_SECRET = "furlpay_dev_session_secret_change_me_32bytes";

export type Role = "user" | "compliance_officer" | "admin";

function secretKey(): Uint8Array {
  const secret = process.env.FURLPAY_SESSION_SECRET;
  // In production, refuse to sign/verify with a missing or weak secret — a
  // predictable key lets anyone forge a valid session cookie.
  if (!secret || secret.length < 32 || secret === DEV_FALLBACK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FURLPAY_SESSION_SECRET must be set to a strong value (>= 32 chars) in production."
      );
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims extends JWTPayload {
  sub: string; // user id
  safe?: string;
  roles?: Role[];
  jti?: string;
  guest?: boolean;
  /** OIDC auth_time: when the user LAST PROVED their identity (OTP, passkey,
   *  social). Refresh slides `exp` but carries auth_time unchanged, so a
   *  session can only be extended for so long before a real re-login. */
  auth_time?: number;
}

/** How long a session may keep sliding via /api/auth/refresh before the user
 *  must re-authenticate for real. Money-moving actions re-prove identity far
 *  earlier via step-up (lib/stepup.ts) — this ceiling bounds READ access. */
export const MAX_SESSION_LIFETIME_SECONDS = 30 * 24 * 3600;

/** May this session still be slid forward, or is a real re-login due? */
export function canRefreshSession(claims: SessionClaims, nowMs = Date.now()): boolean {
  const authTime = claims.auth_time ?? claims.iat;
  if (!authTime) return false; // no anchor — refuse rather than extend forever
  return nowMs / 1000 - authTime <= MAX_SESSION_LIFETIME_SECONDS;
}

// ---------------------------------------------------------------------------
// Revocation. Logout / account-lock add the token's jti here; verifySession
// rejects revoked tokens. Two layers:
//   1. In-memory map — free, same-instance, checked on every verify (including
//      Edge middleware, where a per-request Redis round-trip would tax every
//      page load).
//   2. Durable kv (Upstash Redis in prod) — cross-instance. Checked when the
//      caller asks for it (`{ durable: true }`): requireUser() and the MCP
//      connector do, so a logged-out token is dead on every route that acts on
//      the user, whichever lambda it lands on. TTL = token TTL, so the
//      denylist stays bounded.
// ---------------------------------------------------------------------------
const g = globalThis as unknown as { __revokedJtis?: Map<string, number> };
const revoked = (): Map<string, number> => (g.__revokedJtis ??= new Map());

const revokedKey = (jti: string) => `session:revoked:${jti}`;

export async function revokeSession(jti: string | undefined): Promise<void> {
  if (!jti) return;
  const now = Date.now();
  revoked().set(jti, now + TTL_SECONDS * 1000);
  // Sweep expired revocations so the set stays bounded.
  for (const [id, expiresAt] of revoked()) {
    if (expiresAt < now) revoked().delete(id);
  }
  // Durable write LAST and best-effort: a kv outage must not turn logout into
  // a 500 — the memory layer above already killed the token on this instance.
  try {
    await kvSet(revokedKey(jti), 1, TTL_SECONDS);
  } catch {
    // Token still expires within TTL_SECONDS; nothing safe to do here.
  }
}

function isRevoked(jti: string | undefined): boolean {
  if (!jti) return false;
  const expiresAt = revoked().get(jti);
  if (expiresAt === undefined) return false;
  if (expiresAt < Date.now()) {
    revoked().delete(jti);
    return false;
  }
  return true;
}

/**
 * Extract the session token from a request: the HttpOnly cookie (web) or an
 * `Authorization: Bearer` header (native mobile app, which stores the token
 * in the Android Keystore instead of a browser cookie jar). Both carry the
 * SAME signed JWT and go through the same verifySession() path — the header
 * grants nothing a cookie wouldn't.
 */
export function tokenFromRequest(req: {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
}): string | undefined {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) return cookie;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  // Every token carries auth_time. A fresh login sets it to now; a refresh
  // passes the ORIGINAL through, which is what bounds total session lifetime.
  return new SignJWT({ roles: ["user"], auth_time: Math.floor(Date.now() / 1000), ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer("furlpay")
    .setAudience("furlpay-app")
    .setJti(claims.jti ?? crypto.randomUUID())
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Verify a token's signature + claims. Returns null if invalid/expired/revoked.
 *
 * `durable: true` additionally checks the cross-instance kv denylist — one kv
 * GET. Route-level auth (requireUser, the MCP connector) passes it; the Edge
 * middleware does not, because every data route re-verifies durably anyway and
 * middleware runs on every page load.
 */
export async function verifySession(
  token: string | undefined | null,
  opts?: { durable?: boolean }
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "furlpay",
      audience: "furlpay-app",
      algorithms: [ALG], // pin HS256 — never honour a header-chosen algorithm
    });
    const claims = payload as SessionClaims;
    if (isRevoked(claims.jti)) return null;
    if (opts?.durable && claims.jti) {
      // Fail-open on kv error: a Redis outage must not sign everyone out.
      // The token still dies at its 1h expiry.
      try {
        if ((await kvGet(revokedKey(claims.jti))) !== null) return null;
      } catch {
        /* kv unreachable — signature/expiry checks above still hold */
      }
    }
    return claims;
  } catch {
    return null;
  }
}

/**
 * Set the session cookie with the SAME flags everywhere. `secure` is explicit
 * (not left to framework inference) so a session token is never sent over
 * plaintext HTTP in production.
 */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** Clear the session cookie (logout). Pair with revokeSession(claims.jti). */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export const SESSION_MAX_AGE = TTL_SECONDS;
