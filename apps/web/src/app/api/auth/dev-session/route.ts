import { NextRequest, NextResponse } from "next/server";
import { currentEpoch } from "@/lib/sessionEpoch";
import { db } from "@/lib/store";
import { signSession, setSessionCookieForRequest } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { devAutoLoginEnabled, safeNextPath } from "@/lib/devAutoLogin";
import { publicOrigin } from "@/lib/publicOrigin";

export const dynamic = "force-dynamic";

// GET /api/auth/dev-session?next=/analytics — LOCAL DEVELOPMENT ONLY.
//
// Signs the browser into the seeded demo account and redirects to `next`, so
// pages such as /analytics open without the sign-in screen while developing.
// The middleware sends unauthenticated page requests here instead of /login
// when, and only when, devAutoLoginEnabled() is true.
//
// Closed unless BOTH hold: NODE_ENV !== "production" (no production build, no
// preview build) AND the server-only flag FURLPAY_DEV_AUTO_LOGIN=1. Otherwise
// it answers 404, as if it did not exist. A production runtime also has no demo
// seed (lib/store.ts), so there would be nothing to sign in as.
//
// The session is the same one /api/auth/guest mints: roles ["user"], guest:
// true. Admin access in development comes from the demo account being the
// development bootstrap admin (lib/adminIdentity.ts), never from this token.
export async function GET(req: NextRequest) {
  if (!devAutoLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimitOr429(req, "auth.dev_session", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const demo = db;
  if (!demo) return NextResponse.json({ error: "No local demo account" }, { status: 404 });

  const token = await signSession({
    sub: demo.user.id,
    safe: demo.user.safeAddress,
    roles: ["user"],
    guest: true,
    sepoch: await currentEpoch(demo.user.id),
  });
  const res = NextResponse.redirect(new URL(safeNextPath(req.nextUrl.searchParams.get("next")), publicOrigin(req)));
  setSessionCookieForRequest(req, res, token);
  audit("auth.dev_session", demo.user.id);
  return res;
}
