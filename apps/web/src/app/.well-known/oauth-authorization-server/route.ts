import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { SCOPES } from "@/lib/mcp/oauth";

// RFC 8414 — Authorization Server Metadata.
//
// `code_challenge_methods_supported: ["S256"]` is not decoration: an MCP client
// that sees no PKCE support will fall back to a plain authorization-code flow,
// and a public client without PKCE can have its code stolen. We advertise S256
// only and enforce S256 only.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], // public client + PKCE
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
