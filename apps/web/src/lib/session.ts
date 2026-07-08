import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextResponse } from "next/server";

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
}

// ---------------------------------------------------------------------------
// Revocation. Logout / account-lock add the token's jti here; verifySession
// rejects revoked tokens. In-memory per instance (Edge and Node runtimes keep
// separate sets) — production swaps this for Redis with a TTL equal to the
// token TTL. The interface is deliberately async-free so the swap is drop-in.
// ---------------------------------------------------------------------------
const g = globalThis as unknown as { __revokedJtis?: Map<string, number> };
const revoked = (): Map<string, number> => (g.__revokedJtis ??= new Map());

export function revokeSession(jti: string | undefined): void {
  if (!jti) return;
  const now = Date.now();
  revoked().set(jti, now + TTL_SECONDS * 1000);
  // Sweep expired revocations so the set stays bounded.
  for (const [id, expiresAt] of revoked()) {
    if (expiresAt < now) revoked().delete(id);
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

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ roles: ["user"], ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer("furlpay")
    .setAudience("furlpay-app")
    .setJti(claims.jti ?? crypto.randomUUID())
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a token's signature + claims. Returns null if invalid/expired/revoked. */
export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "furlpay",
      audience: "furlpay-app",
      algorithms: [ALG], // pin HS256 — never honour a header-chosen algorithm
    });
    const claims = payload as SessionClaims;
    if (isRevoked(claims.jti)) return null;
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
