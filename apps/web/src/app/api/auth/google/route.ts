import { NextRequest, NextResponse } from "next/server";
import { findOrCreateUserByIdentityDurable, updateUser } from "@/lib/store";
import { verifyGoogleCredential } from "@/lib/auth/google";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emailTemplates";
import { setAvatarUrl } from "@/lib/profileAvatar";

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

  // Account resolution falls back from googleSub to email (store.ts
  // findUserByIdentity), which means a matching email LINKS this Google identity
  // to an existing account (e.g. one created via email OTP). That link is only
  // safe if Google has actually VERIFIED the email — otherwise an attacker could
  // register a Google account carrying a victim's unverified email and take over
  // the victim's OTP account by email match. Consumer Google accounts are always
  // verified; reject the rare unverified case rather than link on an unproven
  // identifier. (The repo rule: never merge accounts on an untrusted email.)
  if (!identity.emailVerified) {
    audit("auth.login", "anonymous", { provider: "google", rejected: "email_unverified" });
    return NextResponse.json(
      { error: "Your Google email address is not verified. Verify it with Google and try again." },
      { status: 403 }
    );
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
  // The profile photo Google already hosts, so the header avatar can show the
  // user's own face instead of their initials. Best-effort and awaited only to
  // keep the write ordered before the response — setAvatarUrl swallows its own
  // failures, because an avatar is never worth failing a sign-in over.
  await setAvatarUrl(account.user.id, identity.picture);

  const token = await signSession({
    sub: account.user.id,
    safe: account.user.safeAddress,
    roles: account.user.roles,
  });
  // Native clients hold the JWT in the Android Keystore and send it as
  // `Authorization: Bearer` — they have no cookie jar. See lib/clientKind.ts.
  const res = NextResponse.json({
    success: true,
    email: identity.email,
    name: identity.name ?? account.user.name,
    phoneVerified: !!account.user.phoneVerified,
    ...(isMobileClient(req) ? { token } : {}),
  });
  setSessionCookie(res, token);
  audit(created ? "auth.signup" : "auth.login", account.user.id, { provider: "google" });
  if (created && identity.email) {
    void sendEmail({ to: identity.email, category: "welcome", ...welcomeEmail(identity.name) });
  }
  return res;
}
