import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { registerClient } from "@/lib/mcp/oauth";

// POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
//
// Public and unauthenticated by necessity: a fresh Claude Code install must be
// able to register before any user has signed in. That is safe because a
// client_id grants NOTHING on its own — every code still requires a human to
// approve at /oauth/authorize, and PKCE binds the code to the registering
// client. The registration itself is rate-limited so it can't be used to flood
// the kv store.

const Schema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url().max(500)).min(1).max(8),
  // Accepted and ignored — we are a public client with PKCE.
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "oauth.register", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Schema);
  if (body instanceof NextResponse) return body;

  const client = await registerClient({
    client_name: body.client_name ?? "MCP Client",
    redirect_uris: body.redirect_uris,
  });
  if ("error" in client) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: client.error }, { status: 400 });
  }

  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201 }
  );
}
