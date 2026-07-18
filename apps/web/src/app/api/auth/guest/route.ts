import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/auth/guest — TESTING ONLY. Issues a signed session for the seeded
// demo user WITHOUT any authentication, so the app can be clicked through on a
// device before real login is wired up end-to-end.
//
// This is an intentional auth bypass, so it fails closed twice over:
//  - NEVER in production, regardless of env vars (a misconfigured dashboard
//    variable must not open an auth bypass on furlpay.com), and
//  - elsewhere only when the deployment opts in with ALLOW_GUEST_LOGIN=1
//    (server-side var — the NEXT_PUBLIC_ALLOW_GUEST flag only shows the
//    button in the UI and authorizes nothing).
//
// Set these flags as Preview-scoped env vars in the Vercel dashboard, never in
// vercel.json build.env — that applies to production deploys too.
export async function POST(req: NextRequest) {
  // Mints a session with no credential — cheap to spam, so keep it well under
  // the middleware's 150/min baseline.
  const limited = await rateLimitOr429(req, "auth.guest", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Guest login disabled" }, { status: 403 });
  }
  const optedIn =
    process.env.ALLOW_GUEST_LOGIN === "1" ||
    // In local dev only, the UI flag doubles as the opt-in for convenience.
    (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ALLOW_GUEST === "1");
  if (!optedIn) {
    return NextResponse.json({ error: "Guest login disabled" }, { status: 403 });
  }

  const token = await signSession({
    sub: db.user.id,
    safe: db.user.safeAddress,
    roles: db.user.roles,
    guest: true,
  });
  // Mobile clients get the token in the body (Bearer flow) — same pattern as
  // /api/auth/otp/check. Web keeps the HttpOnly cookie only.
  const isMobileClient = (req.headers.get("x-furlpay-client") ?? "").startsWith("mobile");
  const res = NextResponse.json({ verified: true, guest: true, ...(isMobileClient ? { token } : {}) });
  setSessionCookie(res, token);
  audit("auth.guest_login", db.user.id);
  return res;
}
