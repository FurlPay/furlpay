import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { verifyAppleIdentityToken } from "@/lib/auth/apple";
import { findOrCreateUserByIdentityDurable } from "@/lib/store";
import { mintNativeCode } from "@/lib/nativeSession";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

// POST /api/auth/apple/callback — Apple's redirect target for the NATIVE flow.
//
// Apple will not redirect to a custom scheme (furlpay://) — redirect_uri must be
// an https URL registered in the Apple developer portal. And when the request
// asks for name/email scopes, Apple delivers the result as an HTML form POST,
// not a query redirect. So the Android app opens Apple in a Custom Tab pointed
// at this URL, and this route converts the result back into something the app
// can consume: a one-time code on a furlpay:// deep link.
//
// The session JWT itself is never placed in that URL — see lib/nativeSession.ts
// for why (URLs leak; the JWT is spend authority).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.apple.callback", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const form = await req.formData().catch(() => null);
  const idToken = String(form?.get("id_token") ?? "");
  // Apple sends `user` (JSON with the name) only on the very first consent.
  let name: string | undefined;
  try {
    const raw = form?.get("user");
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
      name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ") || undefined;
    }
  } catch {
    /* name is a nicety, never a blocker */
  }

  if (!idToken) return fail(req, "missing_id_token");

  let identity;
  try {
    identity = await verifyAppleIdentityToken(idToken, name);
  } catch {
    return fail(req, "invalid_apple_token");
  }

  const { account } = await findOrCreateUserByIdentityDurable({
    appleSub: identity.sub,
    email: identity.email,
    authProvider: "apple",
    ...(identity.name ? { name: identity.name } : {}),
  });

  const code = await mintNativeCode({
    sub: account.user.id,
    safe: account.user.safeAddress,
    roles: account.user.roles,
    provider: "apple",
  });
  audit("auth.handoff_minted", account.user.id, { provider: "apple", direction: "web_to_native" });

  // 303 so the browser follows with GET into the app's deep link.
  return NextResponse.redirect(`furlpay://auth?code=${encodeURIComponent(code)}`, 303);
}

function fail(_req: NextRequest, reason: string): NextResponse {
  return NextResponse.redirect(`furlpay://auth?error=${encodeURIComponent(reason)}`, 303);
}
