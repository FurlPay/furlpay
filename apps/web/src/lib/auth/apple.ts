// ---------------------------------------------------------------------------
// Verify the identity token that "Sign in with Apple" returns. Apple signs the
// ID token with ES256 (JWKS at https://appleid.apple.com/auth/keys). Per
// Apple's guidance we MUST verify server-side: signature against Apple's JWKS,
// iss == https://appleid.apple.com, aud == our Services ID (client_id), and not
// expired — then key the user off the stable `sub` claim (Apple's email can be
// a private relay and may change; sub does not).
// Docs: https://developer.apple.com/documentation/sign_in_with_apple
//
// Live mode verifies with jose against Apple's JWKS. Mock mode (no
// APPLE_CLIENT_ID) decodes the JWT WITHOUT signature verification so the button
// works locally — clearly dev-only and refused in production, mirroring
// lib/auth/google.ts.
// ---------------------------------------------------------------------------

const MODE = process.env.INTEGRATION_MODE || "mock";
const CLIENT_ID = process.env.APPLE_CLIENT_ID; // Services ID, e.g. com.furlpay.web

export function appleIsLive(): boolean {
  return MODE === "live" && !!CLIENT_ID;
}

export interface AppleIdentity {
  sub: string; // stable Apple account id — use this as the user key
  email: string;
  emailVerified: boolean;
  name?: string; // Apple only sends the name on first consent (via the form)
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed identity token");
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(json);
}

/** Verify an Apple identity token and return the normalized identity, or throw. */
export async function verifyAppleIdentityToken(idToken: string, name?: string): Promise<AppleIdentity> {
  if (appleIsLive()) {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: "https://appleid.apple.com",
      audience: CLIENT_ID,
    });
    if (!payload.sub || !payload.email) throw new Error("Apple token missing required claims");
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      name,
    };
  }

  // Mock/dev only: trust the payload without signature verification. This path
  // MUST never run in production — an unverified JWT is a full auth bypass.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Apple sign-in is not configured for production. Set INTEGRATION_MODE=live and APPLE_CLIENT_ID.",
    );
  }

  const p = decodeJwtPayload(idToken);
  const sub = String(p.sub ?? "");
  const email = String(p.email ?? "");
  if (!sub || !email) throw new Error("Stub token missing sub/email");
  return {
    sub,
    email,
    emailVerified: p.email_verified !== false,
    name,
  };
}
