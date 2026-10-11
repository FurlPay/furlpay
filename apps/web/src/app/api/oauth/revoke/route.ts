import { NextRequest, NextResponse } from "next/server";
import { readFormBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { revokeRefreshToken, verifyAccessToken } from "@/lib/mcp/oauth";
import { revokeSession } from "@/lib/session";
import { audit } from "@/lib/audit";

// POST /api/oauth/revoke — RFC 7009 token revocation for the MCP connector.
//
// Two token shapes arrive here:
//   * refresh tokens (rt_…) — opaque kv handles; revocation kills the token
//     AND its rotation family, so a sibling the caller no longer holds dies too.
//   * access tokens (JWTs) — revoked by jti on the durable denylist, the same
//     one requireUser/verifyAccessToken consult on every call.
//
// Per RFC 7009 §2.2 the response is 200 even for a token we don't recognize:
// an attacker probing this endpoint learns nothing about which tokens exist.

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "oauth.revoke", { limit: 30, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const form = await readFormBody(req).catch(() => null);
  const token = typeof form?.get("token") === "string" ? (form.get("token") as string) : "";
  if (!token) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  if (token.startsWith("rt_")) {
    const userId = await revokeRefreshToken(token);
    if (userId) audit("mcp.token_revoked", userId, { kind: "refresh_token" });
  } else {
    // Only connector tokens are revocable here — a browser session cookie
    // pasted into this public endpoint must not become a logout oracle.
    const claims = await verifyAccessToken(token);
    if (claims?.jti) {
      await revokeSession(claims.jti);
      audit("mcp.token_revoked", claims.sub, { jti: claims.jti });
    }
  }

  return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
}
