import { NextRequest, NextResponse } from "next/server";
import { db, updateUser } from "@/lib/store";
import { verifyGoogleCredential } from "@/lib/auth/google";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// POST /api/auth/google — body: { credential } (the GIS ID token JWT).
// Verifies the token server-side, links the Google account to the user, and
// issues a signed session. Phone verification is still required separately
// (Google provides email but not a phone number).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const credential = body?.credential;
  if (!credential || typeof credential !== "string") {
    return NextResponse.json({ error: "Missing credential" }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Invalid Google token" }, { status: 401 });
  }

  updateUser({
    email: identity.email,
    googleSub: identity.sub,
    authProvider: "google",
    ...(identity.name ? { name: identity.name } : {}),
  });

  const token = await signSession({ sub: db.user.id, safe: db.user.safeAddress });
  const res = NextResponse.json({
    success: true,
    email: identity.email,
    name: identity.name ?? db.user.name,
    phoneVerified: !!db.user.phoneVerified,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
