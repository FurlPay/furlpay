import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// ---------------------------------------------------------------------------
// Signed session tokens via `jose` (pure Web Crypto -> works in Edge middleware,
// unlike jsonwebtoken). Short-lived HS256 access token in an HttpOnly cookie.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "furlpay_session";
const ALG = "HS256";
const TTL_SECONDS = 60 * 60; // 1h access token

const DEV_FALLBACK_SECRET = "furlpay_dev_session_secret_change_me_32bytes";

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
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer("furlpay")
    .setAudience("furlpay-app")
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a token's signature + claims. Returns null if invalid/expired. */
export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "furlpay",
      audience: "furlpay-app",
    });
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = TTL_SECONDS;
