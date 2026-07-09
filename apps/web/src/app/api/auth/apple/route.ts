import { NextRequest, NextResponse } from "next/server";
import { findOrCreateUserByIdentity, updateUser } from "@/lib/store";
import { verifyAppleIdentityToken } from "@/lib/auth/apple";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emailTemplates";

// POST /api/auth/apple — body: { id_token, name? } (the Apple identity token
// JWT, plus the name Apple only supplies on first consent). Verifies the token
// server-side, resolves (or creates) the account for that VERIFIED Apple
// identity, and issues a session bound to that user.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.apple", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

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

  const { account, created } = findOrCreateUserByIdentity({
    appleSub: identity.sub,
    email: identity.email,
    name: identity.name,
    authProvider: "apple",
  });
  // Returning user: keep the linked identity fields fresh.
  updateUser(account.user.id, {
    email: identity.email,
    appleSub: identity.sub,
    authProvider: "apple",
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
  audit(created ? "auth.signup" : "auth.login", account.user.id, { provider: "apple" });
  if (created && identity.email) {
    void sendEmail({ to: identity.email, category: "welcome", ...welcomeEmail(identity.name) });
  }
  return res;
}
