import { NextRequest, NextResponse } from "next/server";
import { findOrCreateUserByIdentityDurable, updateUser } from "@/lib/store";
import { verifyAppleIdentityToken } from "@/lib/auth/apple";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emailTemplates";
import { validateBody } from "@/lib/validate";
import { z } from "zod";

// An Apple identity token is a compact JWS. Shape-checking it here does not
// replace signature verification (verifyAppleIdentityToken does that against
// appleid.apple.com/auth/keys) -- it rejects a malformed blob at the edge, and
// validateBody's 100KB cap stops an oversized body being parsed at all.
const AppleAuthSchema = z.object({
  id_token: z
    .string()
    .min(1, "Missing id_token")
    .max(8192, "Token is implausibly large for an identity token")
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/, "Malformed id_token"),
  // Apple sends the name only on FIRST consent, and never again. It is
  // client-supplied and unverified, so it is length-capped and treated as a
  // display hint only -- never as an identifier.
  name: z.string().trim().max(128).optional(),
});

// POST /api/auth/apple — body: { id_token, name? } (the Apple identity token
// JWT, plus the name Apple only supplies on first consent). Verifies the token
// server-side, resolves (or creates) the account for that VERIFIED Apple
// identity, and issues a session bound to that user.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.apple", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, AppleAuthSchema);
  if (body instanceof NextResponse) return body;
  const { id_token: idToken, name } = body;

  let identity;
  try {
    identity = await verifyAppleIdentityToken(idToken, name);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Invalid Apple token" }, { status: 401 });
  }

  // Same gate the Google route applies, and for the same reason.
  //
  // findOrCreateUserByIdentityDurable falls back from appleSub to EMAIL, so a
  // matching email LINKS this Apple identity to an existing account -- one
  // that may have been created by email OTP. That link is only sound if the
  // provider has actually verified the address; otherwise an identity carrying
  // a victim's unverified email takes over the victim's account.
  //
  // This check was missing here while Google had it. Apple sets
  // email_verified on real Apple IDs and on its private-relay addresses, so
  // this should never fire in practice -- which is exactly why its absence was
  // invisible. The repo rule is: never merge accounts on an untrusted email.
  if (!identity.emailVerified) {
    audit("auth.login", "anonymous", { provider: "apple", rejected: "email_unverified" });
    return NextResponse.json(
      { error: "Your Apple email address is not verified. Verify it with Apple and try again." },
      { status: 403 }
    );
  }

  const { account, created } = await findOrCreateUserByIdentityDurable({
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
  audit(created ? "auth.signup" : "auth.login", account.user.id, { provider: "apple" });
  if (created && identity.email) {
    void sendEmail({ to: identity.email, category: "welcome", ...welcomeEmail(identity.name) });
  }
  return res;
}
