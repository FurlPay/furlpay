import { NextRequest, NextResponse } from "next/server";
import { readFormBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { verifyAppleIdentityToken } from "@/lib/auth/apple";
import { findOrCreateUserByIdentityDurable } from "@/lib/store";
import { CODE_CHALLENGE, mintNativeCode } from "@/lib/nativeSession";
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
//
// PKCE BINDING (audit P1-2, 2026-10-05). The app opens Apple with
//   state = "<random>.<code_challenge>"   and   nonce = "<code_challenge>"
// where code_challenge = base64url(SHA-256(code_verifier)). This route:
//   - refuses a state that carries no well-formed challenge (pkce_required);
//   - requires the id_token's nonce to EQUAL that challenge, so an id_token
//     from a different sign-in (another device, another tab, a replay) cannot
//     be posted against this session's state;
//   - binds the minted code to the challenge, so only the holder of the
//     verifier can redeem it at /api/auth/native/exchange.
const STATE = /^([A-Za-z0-9-]{16,64})\.([A-Za-z0-9_-]{43})$/;

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.apple.callback", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const form = await readFormBody(req).catch(() => null);
  const idToken = String(form?.get("id_token") ?? "");
  // Echo `state` back to the app so it can reject a deep link that didn't come
  // from the flow it started (login CSRF). Opaque to us; length-capped so a
  // hostile form POST can't stuff arbitrary payload into the redirect.
  const state = String(form?.get("state") ?? "").slice(0, 128);
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

  const pkce = STATE.exec(state);
  const codeChallenge = pkce?.[2];
  if (!codeChallenge || !CODE_CHALLENGE.test(codeChallenge)) return fail(req, "pkce_required", state);

  if (!idToken) return fail(req, "missing_id_token", state);

  let identity;
  try {
    identity = await verifyAppleIdentityToken(idToken, name, { expectedNonce: codeChallenge });
  } catch {
    return fail(req, "invalid_apple_token", state);
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
    codeChallenge,
  });
  audit("auth.handoff_minted", account.user.id, { provider: "apple", direction: "web_to_native" });

  // 303 so the browser follows with GET into the app's deep link.
  return NextResponse.redirect(
    `furlpay://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    303
  );
}

function fail(_req: NextRequest, reason: string, state = ""): NextResponse {
  return NextResponse.redirect(
    `furlpay://auth?error=${encodeURIComponent(reason)}&state=${encodeURIComponent(state)}`,
    303
  );
}
