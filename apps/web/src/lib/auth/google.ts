// ---------------------------------------------------------------------------
// Verify the ID token that "Sign in with Google" (Google Identity Services)
// returns as response.credential. Per Google's 2026 guidance we MUST verify the
// token server-side (signature against Google's JWKS, aud == our client id,
// iss == accounts.google.com, not expired) and key the user off the `sub` claim
// — never the email, since a user's email can change.
// Docs: https://developers.google.com/identity/gsi/web/reference/js-reference
//
// Live mode uses google-auth-library's OAuth2Client.verifyIdToken. Mock mode
// (no GOOGLE_CLIENT_ID) decodes the JWT WITHOUT signature verification so the
// button works locally against a stub token — clearly dev-only.
// ---------------------------------------------------------------------------

const MODE = process.env.INTEGRATION_MODE || "mock";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

export function googleIsLive(): boolean {
  return MODE === "live" && !!CLIENT_ID;
}

export interface GoogleIdentity {
  sub: string; // stable Google account id — use this as the user key
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed credential");
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(json);
}

/** Verify a GIS credential and return the normalized identity, or throw. */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  if (googleIsLive()) {
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("Google token missing required claims");
    return {
      sub: p.sub,
      email: p.email,
      emailVerified: !!p.email_verified,
      name: p.name,
      picture: p.picture,
    };
  }

  // Mock/dev only: trust the payload without signature verification. This path
  // MUST never run in production — an unverified JWT means anyone can forge any
  // identity and mint a session (full auth bypass). Refuse it, mirroring the
  // production guard in lib/session.ts.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Google sign-in is not configured for production. Set INTEGRATION_MODE=live and GOOGLE_CLIENT_ID."
    );
  }

  const p = decodeJwtPayload(credential);
  const sub = String(p.sub ?? "");
  const email = String(p.email ?? "");
  if (!sub || !email) throw new Error("Stub token missing sub/email");
  return {
    sub,
    email,
    emailVerified: p.email_verified !== false,
    name: p.name ? String(p.name) : undefined,
    picture: p.picture ? String(p.picture) : undefined,
  };
}
