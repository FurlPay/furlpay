import { NextResponse } from "next/server";
import { hasScope, type McpClaims, type Scope } from "./oauth";

// ---------------------------------------------------------------------------
// Which API routes may a connector (MCP) access token touch, and with which
// scope? DEFAULT DENY.
//
// An MCP access token is a session JWT (so the tool layer can reuse the real
// routes — see lib/mcp/tools.ts), which means that WITHOUT this map a token
// granted only wallets:read would work as a full session against
// /api/payments/execute or /api/security/mfa if pointed at them directly,
// bypassing both the consent scopes and the tools' human-approval boundary.
// requireUser() consults this map for every mcp-flagged token: a route absent
// from the map is forbidden to connector tokens, full stop.
//
// The map therefore contains EXACTLY the routes the registered tools call
// (lib/mcp/tools.ts), each with the same scope its tool declares. Adding a
// tool that calls a new route means adding the route here — the tool will
// 403 in an integration test otherwise, which is the point.
// ---------------------------------------------------------------------------

const ROUTE_SCOPES: Record<string, Scope> = {
  // read tools
  "GET /api/overview": "wallets:read",
  "GET /api/wallets": "wallets:read",
  "GET /api/transactions": "transactions:read",
  "GET /api/analytics": "transactions:read",
  "GET /api/compliance": "wallets:read", // address risk screening
  "POST /api/swaps": "wallets:read", // quote only — /api/swaps/execute is NOT mapped
  "GET /api/travel/deals": "travel:read",
  "GET /api/travel/trips": "travel:read",
  // prepare/write tools (all HITL — the routes themselves never settle)
  "POST /api/payments/create": "payments:write",
  "POST /api/payments": "payments:write", // payment request (invoice)
  "POST /api/support/tickets": "profile:read",
};

/** The scope a connector token needs for this route, or null if the route is
 *  not exposed to connector tokens at all. */
export function requiredScopeFor(method: string, pathname: string): Scope | null {
  return ROUTE_SCOPES[`${method.toUpperCase()} ${pathname}`] ?? null;
}

/**
 * The 403 an mcp-flagged token gets on this route, or null when the call is
 * allowed. Pure function of (claims, method, path) so it is unit-testable
 * without a store or a request.
 */
export function mcpDenialFor(claims: McpClaims, method: string, pathname: string): NextResponse | null {
  const scope = requiredScopeFor(method, pathname);
  if (!scope) {
    return NextResponse.json(
      { error: "This endpoint is not available to connector tokens" },
      { status: 403 }
    );
  }
  if (!hasScope(claims, scope)) {
    return NextResponse.json(
      {
        error: `Insufficient scope: this connection was not granted "${scope}". Reconnect FurlPay and grant it.`,
      },
      // RFC 6750 §3.1 — insufficient_scope, so a well-behaved client knows
      // re-authorization (not a retry) is the fix.
      { status: 403, headers: { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"` } }
    );
  }
  return null;
}
