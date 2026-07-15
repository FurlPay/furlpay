import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { canRefreshSession, setSessionCookie, signSession, SESSION_MAX_AGE } from "@/lib/session";

// POST /api/auth/refresh — slide a still-valid 1h session forward.
//
// Without this, every client dies at the 1h JWT expiry: the native app's 401
// handler force-signs the user out mid-use, and the web cookie evaporates.
// Refresh re-mints the token (new jti, fresh exp) but carries the ORIGINAL
// auth_time, so a session can slide for at most MAX_SESSION_LIFETIME (30d)
// before a real re-login. The old token is NOT revoked — it dies at its own
// expiry ≤1h out, and revoking it would 401 requests already in flight from
// other tabs/screens still holding it.
//
// requireUser gives us, for free: durable revocation check (a logged-out
// token cannot refresh), deleted-account and locked-account checks, and the
// MCP scope firewall (a connector token 403s here — it has its own OAuth
// refresh_token grant at /api/oauth/token).

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { claims } = auth;

  if (!canRefreshSession(claims)) {
    // The 30-day ceiling. `reauth` tells the client this is not a transient
    // failure — clear the token and show the login screen.
    return NextResponse.json({ error: "session_too_old", reauth: true }, { status: 401 });
  }

  const token = await signSession({
    sub: claims.sub,
    ...(claims.safe ? { safe: claims.safe } : {}),
    ...(claims.roles ? { roles: claims.roles } : {}),
    ...(claims.guest ? { guest: true } : {}),
    auth_time: claims.auth_time ?? claims.iat, // the original login, unchanged
  });

  // Same convention as otp/check: mobile (X-Furlpay-Client: mobile-*) gets the
  // token in the body for the Keystore; web gets the HttpOnly cookie only.
  const isMobileClient = (req.headers.get("x-furlpay-client") ?? "").startsWith("mobile");
  const res = NextResponse.json(
    { refreshed: true, expiresIn: SESSION_MAX_AGE, ...(isMobileClient ? { token } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
  setSessionCookie(res, token);
  return res;
}
