import { currentEpoch } from "@/lib/sessionEpoch";
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
//
//  1. DEPLOYMENT GATE. Refused whenever the build is a production build
//     (NODE_ENV=production) UNLESS Vercel reports the deployment itself as a
//     preview (VERCEL_ENV=preview). Preview deploys are production builds, so
//     without that carve-out the device-testing and Play-review flows this
//     endpoint exists for could not work at all. On furlpay.com VERCEL_ENV is
//     "production", so the gate closes and no dashboard variable reopens it.
//
//     Note the gate is NOT "regardless of env vars" — VERCEL_ENV is itself an
//     env var. It is a Vercel *system* variable, which is what makes it
//     trustworthy here; the protection is that production deployments are not
//     labelled "preview", not that env vars are ignored.
//
//  2. EXPLICIT OPT-IN. Even past the gate, the deployment must set
//     ALLOW_GUEST_LOGIN=1 (server-side). The NEXT_PUBLIC_ALLOW_GUEST flag only
//     renders the button in the UI and authorizes nothing.
//
// Set these flags as Preview-scoped env vars in the Vercel dashboard, never in
// vercel.json build.env — that applies to production deploys too.
//
// Both gates are pinned by src/app/api/auth/__tests__/guest.spec.ts.
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
    sepoch: await currentEpoch(db.user.id),
  });
  // Mobile clients get the token in the body (Bearer flow) — same pattern as
  // /api/auth/otp/check. Web keeps the HttpOnly cookie only.
  const isMobileClient = (req.headers.get("x-furlpay-client") ?? "").startsWith("mobile");
  const res = NextResponse.json({ verified: true, guest: true, ...(isMobileClient ? { token } : {}) });
  setSessionCookie(res, token);
  audit("auth.guest_login", db.user.id);
  return res;
}
