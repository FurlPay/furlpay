import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getClient, issueCode, parseScopes, redirectUriMatches, SCOPES, type Scope } from "@/lib/mcp/oauth";
import { audit } from "@/lib/audit";

// POST /api/oauth/authorize — the consent decision itself.
//
// Called by the /oauth/authorize consent page after the SIGNED-IN human clicks
// Allow. requireUser is the whole point: the authorization code is minted for
// the user in the session, never for a user id the client asked for.
//
// The redirect_uri is re-validated against the registered client here, not
// trusted from the page — the page is client-side and therefore an attacker's
// keyboard.

const Schema = z.object({
  client_id: z.string().min(1).max(80),
  redirect_uri: z.string().url().max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  scope: z.string().max(300).optional(),
  state: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "oauth.authorize", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Schema);
  if (body instanceof NextResponse) return body;

  // A guest/demo session must not be able to grant a connector access to a real
  // money account.
  if (auth.claims.guest) {
    return NextResponse.json({ error: "Guest sessions cannot connect FurlPay to an AI client." }, { status: 403 });
  }

  const client = await getClient(body.client_id);
  if (!client) return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  if (!client.redirect_uris.some((r) => redirectUriMatches(r, body.redirect_uri))) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const scopes: Scope[] = parseScopes(body.scope ?? null);
  const code = await issueCode({
    clientId: body.client_id,
    userId: auth.account.user.id,
    redirectUri: body.redirect_uri,
    codeChallenge: body.code_challenge,
    scopes,
  });

  audit("mcp.consent_granted", auth.account.user.id, { clientId: body.client_id, scopes });

  const url = new URL(body.redirect_uri);
  url.searchParams.set("code", code);
  if (body.state) url.searchParams.set("state", body.state);
  return NextResponse.json({ redirectTo: url.toString() });
}

export async function GET() {
  return NextResponse.json({ scopes: SCOPES });
}
