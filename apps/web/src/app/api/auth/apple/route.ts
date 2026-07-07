import { NextRequest, NextResponse } from "next/server";
import { db, updateUser } from "@/lib/store";
import { verifyAppleIdentityToken } from "@/lib/auth/apple";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// POST /api/auth/apple — body: { id_token, name? } (the Apple identity token
// JWT, plus the name Apple only supplies on first consent). Verifies the token
// server-side, links the Apple account to the user, and issues a signed
// session. Phone verification is still handled separately.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const idToken = body?.id_token;
  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "Missing id_token" }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(idToken, typeof body?.name === "string" ? body.name : undefined);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Invalid Apple token" }, { status: 401 });
  }

  updateUser({
    email: identity.email,
    appleSub: identity.sub,
    authProvider: "apple",
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
