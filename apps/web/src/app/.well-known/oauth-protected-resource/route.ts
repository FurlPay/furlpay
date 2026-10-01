import { publicOrigin } from "@/lib/publicOrigin";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { SCOPES } from "@/lib/mcp/oauth";

// RFC 9728 — Protected Resource Metadata. The 401 from /api/mcp points here in
// its WWW-Authenticate header; this is how an MCP client discovers which
// authorization server to run OAuth against.
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: `${origin}/docs/mcp`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
