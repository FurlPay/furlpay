import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { verifyAccessToken, type McpClaims } from "@/lib/mcp/oauth";
import { serializeResult, toolByName, visibleTools, type ToolContext } from "@/lib/mcp/tools";
import { hasScope } from "@/lib/mcp/oauth";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// POST /api/mcp — the FurlPay remote MCP connector (Streamable HTTP).
//
// Streamable HTTP, not stand-alone SSE: each JSON-RPC request is a plain HTTP
// POST that returns a JSON response. No long-lived socket, so this runs on
// serverless without a connection to keep warm (legacy SSE transport is
// deprecated and would be rejected at directory review anyway).
//
// Unauthenticated requests get 401 + WWW-Authenticate pointing at the protected-
// resource metadata, which is how an MCP client discovers where to run OAuth.
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const rpcOk = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });

const rpcErr = (id: unknown, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });

function unauthorized(req: NextRequest): NextResponse {
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="FurlPay", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    }
  );
}

export async function POST(req: NextRequest) {
  const claims = await verifyAccessToken(bearer(req));
  if (!claims) return unauthorized(req);

  // Per-token budget. Money tools are additionally capped by the routes they
  // call (which keep their own limits) — this only stops a runaway agent loop.
  const limited = await rateLimitOr429(req, `mcp.${claims.sub}`, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
  if (!body || Array.isArray(body)) {
    // Batching is out of spec for this transport version; reject rather than
    // half-support it.
    return rpcErr(null, -32600, "Invalid Request");
  }

  const { id, method, params } = body;
  const origin = new URL(req.url).origin;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "furlpay", title: "FurlPay", version: "1.0.0" },
        instructions:
          "FurlPay is the user's stablecoin money account. Read tools answer questions about balances, transactions, spending and travel. Money-moving tools NEVER settle: they return an approval link the human must open and confirm with a passkey. Always screen an unfamiliar destination address with get_wallet_risk before preparing a payment, and show the user the full address — never an abbreviation.",
      });

    case "notifications/initialized":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return rpcOk(id, {});

    case "tools/list":
      return rpcOk(id, {
        tools: visibleTools(claims).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });

    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const tool = toolByName(name);
      if (!tool) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      if (!hasScope(claims, tool.scope)) {
        // Scope failure is a tool ERROR, not a protocol error: the model should
        // see it and tell the user to re-connect with the needed permission.
        return rpcOk(id, {
          isError: true,
          content: [
            {
              type: "text",
              text: `This connection doesn't have permission to use ${name} (requires the "${tool.scope}" scope). Reconnect FurlPay and grant it.`,
            },
          ],
        });
      }

      const ctx: ToolContext = { claims, origin, api: apiCaller(req, claims) };
      try {
        const result = await tool.run(args, ctx);
        return rpcOk(id, { content: [{ type: "text", text: serializeResult(result) }] });
      } catch (e) {
        const message = (e as Error).message || "Tool call failed";
        log.error("mcp tool failed", { tool: name, userId: claims.sub, error: message });
        return rpcOk(id, { isError: true, content: [{ type: "text", text: message }] });
      }
    }

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

/** MCP clients probe with GET; we have no server-initiated stream to offer. */
export async function GET(req: NextRequest) {
  const claims = await verifyAccessToken(bearer(req));
  if (!claims) return unauthorized(req);
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

function bearer(req: NextRequest): string | undefined {
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
}

/**
 * Call our own API as the authenticated user.
 *
 * The connector deliberately reuses the SAME routes the web and mobile apps use
 * — every Zod schema, rate limit, ownership check and audit event applies
 * unchanged. A connector-specific data path would be a second, less-tested way
 * to touch money.
 */
function apiCaller(req: NextRequest, claims: McpClaims): ToolContext["api"] {
  const origin = new URL(req.url).origin;
  const token = bearer(req)!;
  return async (method, path, body) => {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Furlpay-Client": "mcp-connector/1.0.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) ||
        `Request failed (${res.status})`;
      throw new Error(msg);
    }
    void claims;
    return data;
  };
}
