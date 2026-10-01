import { publicRequestUrl } from "@/lib/publicOrigin";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getAccountDurable } from "@/lib/store";
import { issueAccessToken, issueRefreshToken, redeemCode, rotateRefreshToken } from "@/lib/mcp/oauth";
import { verifyDpopProof, DpopError } from "@/lib/mcp/dpop";
import { audit } from "@/lib/audit";

// POST /api/oauth/token — authorization_code + PKCE exchange, and refresh_token
// rotation.
//
// Form-encoded per OAuth. No client secret (public client); the PKCE verifier IS
// the proof on the code grant, possession of the (single-use, rotating) refresh
// token is the proof on the refresh grant. The code is single-use and atomically
// claimed in redeemCode, so a replay loses even if it wins the race; a replayed
// refresh token revokes its whole family (see lib/mcp/oauth.ts).
//
// DPoP (RFC 9449) is opportunistic: when the client sends a `DPoP` header, the
// issued access token is sender-constrained to that key (cnf.jkt) and the
// refresh family is bound to it, so neither is replayable from another machine.
// Clients that send no proof get plain Bearer tokens — existing connectors are
// unaffected.

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "oauth.token", { limit: 30, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const form = await req.formData().catch(() => null);
  const get = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : "";
  };

  const dpopHeader = req.headers.get("dpop") || undefined;
  // htu is what the client signed: the PUBLIC URL, not the bind address.
  const url = publicRequestUrl(req);
  const htu = `${url.origin}${url.pathname}`;

  const grantType = get("grant_type");
  if (grantType === "authorization_code") return codeGrant(get, dpopHeader, htu);
  if (grantType === "refresh_token") return refreshGrant(get, dpopHeader, htu);
  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
}

/** Verify the DPoP proof presented at the token endpoint and return its key
 *  thumbprint, or a 400 response. Absent proof → undefined (Bearer path). */
async function bindingFromProof(
  dpopHeader: string | undefined,
  htu: string
): Promise<{ jkt?: string } | NextResponse> {
  if (!dpopHeader) return {};
  try {
    const { jkt } = await verifyDpopProof(dpopHeader, { htm: "POST", htu });
    return { jkt };
  } catch (e) {
    if (e instanceof DpopError) {
      return NextResponse.json({ error: "invalid_dpop_proof" }, { status: 400 });
    }
    throw e;
  }
}

async function codeGrant(get: (k: string) => string, dpopHeader: string | undefined, htu: string) {
  const code = get("code");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const codeVerifier = get("code_verifier");
  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  // RFC 7636: 43-128 chars from the unreserved set.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const binding = await bindingFromProof(dpopHeader, htu);
  if (binding instanceof NextResponse) return binding;

  const redeemed = await redeemCode({ code, clientId, redirectUri, codeVerifier });
  if (!redeemed.ok) {
    return NextResponse.json({ error: redeemed.error }, { status: 400 });
  }

  const account = await getAccountDurable(redeemed.userId);
  if (!account) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });

  const token = await issueAccessToken(
    redeemed.userId,
    redeemed.scopes,
    account.user.safeAddress,
    binding.jkt
  );
  const refreshToken = await issueRefreshToken({
    userId: redeemed.userId,
    clientId,
    scopes: redeemed.scopes,
    ...(binding.jkt ? { jkt: binding.jkt } : {}),
  });
  audit("mcp.token_issued", redeemed.userId, { clientId, scopes: redeemed.scopes, dpop: !!binding.jkt });

  return NextResponse.json(
    {
      access_token: token,
      token_type: binding.jkt ? "DPoP" : "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: redeemed.scopes.join(" "),
    },
    { headers: NO_STORE }
  );
}

async function refreshGrant(get: (k: string) => string, dpopHeader: string | undefined, htu: string) {
  const refreshToken = get("refresh_token");
  const clientId = get("client_id");
  if (!refreshToken || !clientId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const rotated = await rotateRefreshToken({ token: refreshToken, clientId });
  if (!rotated.ok) {
    return NextResponse.json({ error: rotated.error }, { status: 400 });
  }

  // A DPoP-bound refresh family MUST be redeemed with a proof of the same key
  // (RFC 9449 §5). Without it, a stolen refresh token is inert.
  if (rotated.jkt) {
    if (!dpopHeader) {
      return NextResponse.json({ error: "invalid_dpop_proof" }, { status: 400 });
    }
    try {
      await verifyDpopProof(dpopHeader, { htm: "POST", htu, expectedJkt: rotated.jkt });
    } catch (e) {
      if (e instanceof DpopError) {
        return NextResponse.json({ error: "invalid_dpop_proof" }, { status: 400 });
      }
      throw e;
    }
  }

  // The account must still exist and be issuable-against — a refresh token
  // must not outlive the account (deletion) it was granted for.
  const account = await getAccountDurable(rotated.userId);
  if (!account) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });

  const token = await issueAccessToken(rotated.userId, rotated.scopes, account.user.safeAddress, rotated.jkt);
  audit("mcp.token_refreshed", rotated.userId, { clientId, scopes: rotated.scopes, dpop: !!rotated.jkt });

  return NextResponse.json(
    {
      access_token: token,
      token_type: rotated.jkt ? "DPoP" : "Bearer",
      expires_in: 3600,
      refresh_token: rotated.refreshToken,
      scope: rotated.scopes.join(" "),
    },
    { headers: NO_STORE }
  );
}
