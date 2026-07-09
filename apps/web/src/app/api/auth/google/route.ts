import { NextRequest, NextResponse } from "next/server";
import { findOrCreateUserByIdentityDurable, updateUser } from "@/lib/store";
import { verifyGoogleCredential } from "@/lib/auth/google";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emailTemplates";

// POST /api/auth/google — body: { credential } (the GIS ID token JWT).
// Verifies the token server-side, resolves (or creates) the account for that
// VERIFIED Google identity, and issues a session bound to that user. Phone
// verification is still required separately (Google provides email, not phone).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.google", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

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

  const { account, created } = await findOrCreateUserByIdentityDurable({
    googleSub: identity.sub,
    email: identity.email,
    name: identity.name,
    authProvider: "google",
  });
  // Returning user: keep the linked identity fields fresh.
  updateUser(account.user.id, {
    email: identity.email,
    googleSub: identity.sub,
    authProvider: "google",
    ...(identity.name ? { name: identity.name } : {}),
  });

  const token = await signSession({
    sub: account.user.id,
    safe: account.user.safeAddress,
    roles: account.user.roles,
  });
  const res = NextResponse.json({
    success: true,
    email: identity.email,
    name: identity.name ?? account.user.name,
    phoneVerified: !!account.user.phoneVerified,
  });
  setSessionCookie(res, token);
  audit(created ? "auth.signup" : "auth.login", account.user.id, { provider: "google" });
  if (created && identity.email) {
    void sendEmail({ to: identity.email, category: "welcome", ...welcomeEmail(identity.name) });
  }
  return res;
}
