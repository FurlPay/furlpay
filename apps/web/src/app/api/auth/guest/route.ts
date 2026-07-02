import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// POST /api/auth/guest — TESTING ONLY. Issues a signed session for the seeded
// demo user WITHOUT any authentication, so the app can be clicked through on a
// device before real login is wired up end-to-end.
//
// This is an intentional auth bypass, so it is DISABLED unless the deployment
// explicitly opts in with NEXT_PUBLIC_ALLOW_GUEST=1. It is never on by default —
// do not set that flag on the production furlpay.com deployment.
export async function POST() {
  if (process.env.NEXT_PUBLIC_ALLOW_GUEST !== "1") {
    return NextResponse.json({ error: "Guest login disabled" }, { status: 403 });
  }

  const token = await signSession({ sub: db.user.id, safe: db.user.safeAddress });
  const res = NextResponse.json({ verified: true, guest: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
