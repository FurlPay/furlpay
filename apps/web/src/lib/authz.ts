import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifySession, type Role, type SessionClaims } from "@/lib/session";
import { getAccountDurable, type UserAccount } from "@/lib/store";
import { isAccountDeleted } from "@/lib/accountDeletion";
import type { McpClaims } from "@/lib/mcp/oauth";
import { mcpDenialFor } from "@/lib/mcp/routeScopes";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Route-level authentication + authorization helpers.
//
// Middleware only gates "has a valid session" — it cannot know which role a
// route needs. Routes that act on a user call requireUser(); routes that are
// privileged (compliance console, refunds, admin) call requireRole().
// ---------------------------------------------------------------------------

export type AuthResult =
  | { ok: true; claims: SessionClaims; account: UserAccount }
  | { ok: false; res: NextResponse };

// The single account allowed to hold the admin role. Override via
// FURLPAY_ADMIN_EMAIL; defaults to the seeded founder/demo account so local
// dev and the verify scripts keep working without extra env.
export const FOUNDER_ADMIN_EMAIL =
  (process.env.FURLPAY_ADMIN_EMAIL ?? "ashutosh@furlpay.app").trim().toLowerCase();

function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
}

function normalizedEmail(email: string | undefined | null): string {
  return (email ?? "").trim().toLowerCase();
}

/** Resolve the acting user from the session cookie. 401 when absent/stale. */
export async function requireUser(req: NextRequest): Promise<AuthResult> {
  // durable: also consult the cross-instance revocation denylist — a token
  // revoked by logout/account-lock on another lambda must die here too.
  const claims = await verifySession(tokenFromRequest(req), { durable: true });
  if (!claims?.sub) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // A connector (MCP) access token is scoped, not a full session: it may only
  // reach the routes its consented scopes map to (default deny — see
  // lib/mcp/routeScopes.ts). Without this, a read-only connector token used
  // directly against the API would move money and rewrite MFA settings.
  if ((claims as McpClaims).mcp === true) {
    const denial = mcpDenialFor(claims as McpClaims, req.method, req.nextUrl.pathname);
    if (denial) {
      audit("mcp.scope_denied", claims.sub, {
        method: req.method,
        path: req.nextUrl.pathname,
        scopes: (claims as McpClaims).scopes ?? [],
      });
      return { ok: false, res: denial };
    }
  }
  // Deleted accounts stop authenticating everywhere, immediately. Checked
  // BEFORE the account lookup because getAccountDurable() serves a warm
  // in-memory copy on an instance that hasn't re-read Postgres yet — without
  // this, a session on such an instance would outlive the deletion.
  // revokeSession() cannot cover this: it is per-jti and per-instance.
  if (await isAccountDeleted(claims.sub)) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Account deleted" }, { status: 401 }),
    };
  }
  // Hydrates from Postgres on first touch per instance, so a session minted
  // on another instance resolves here too.
  const account = await getAccountDurable(claims.sub);
  if (!account) {
    // Session outlived the account record (instance restart in the demo store,
    // deleted user in production). Force a re-login rather than acting on the
    // wrong data.
    return { ok: false, res: NextResponse.json({ error: "Session expired — sign in again" }, { status: 401 }) };
  }
  if (account.user.security.accountLocked) {
    return { ok: false, res: NextResponse.json({ error: "Account locked" }, { status: 423 }) };
  }
  return { ok: true, claims, account };
}

/** requireUser + role check. Roles come from the user record (source of
 *  truth), not just the token, so a role change takes effect immediately. */
export async function requireRole(req: NextRequest, role: Role): Promise<AuthResult> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth;
  if (role === "admin" && auth.claims.guest && isProductionDeployment()) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!auth.account.user.roles.includes(role)) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (role === "admin" && normalizedEmail(auth.account.user.email) !== FOUNDER_ADMIN_EMAIL) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return auth;
}
