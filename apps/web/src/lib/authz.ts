import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifySession, type Role, type SessionClaims } from "@/lib/session";
import { getAccountDurable, type UserAccount } from "@/lib/store";
import { isAccountDeleted } from "@/lib/accountDeletion";
import type { McpClaims } from "@/lib/mcp/oauth";
import { mcpDenialFor } from "@/lib/mcp/routeScopes";
import { audit } from "@/lib/audit";
import { EPOCH_OUTDATED, REVOCATION_HEADER, epochMatches } from "@/lib/sessionEpoch";

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
  // Session epoch: a credential change bumps the account's epoch, which kills
  // every token minted under the old one — on every device, at once. Checked
  // here rather than in verifySession() because it needs the ACCOUNT, and this
  // is the single place every authenticated route already resolves it.
  //
  // The header tells a client this is a revocation and not a transient failure,
  // so it can clear its token and re-authenticate instead of retrying a request
  // that will never succeed.
  if (!epochMatches(claims.sepoch, account)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Session ended — sign in again" },
        { status: 401, headers: { [REVOCATION_HEADER]: EPOCH_OUTDATED } }
      ),
    };
  }
  return { ok: true, claims, account };
}

/**
 * The acting user, for routes that also have a legitimate ANONYMOUS path.
 *
 * Some endpoints are deliberately usable without a session — funding an account
 * by account number, registering a demo agent key — and previously resolved the
 * caller with a bare `verifySession(cookie)`. That pattern silently skipped
 * every protection requireUser() applies: the cross-instance revocation
 * denylist, MCP connector scope enforcement, the deleted-account tombstone, and
 * the account lock. A revoked session was treated as a valid one.
 *
 * The distinction that matters is between "no credential" and "a bad
 * credential". No credential is anonymous, and the route decides what that
 * means. A credential that is present but revoked, expired, deleted, locked or
 * out of scope is REJECTED — never quietly downgraded to anonymous, because a
 * caller who presented a dead credential must not be served as though they had
 * presented none.
 */
export type OptionalAuth =
  | { kind: "user"; claims: SessionClaims; account: UserAccount }
  | { kind: "anonymous" }
  | { kind: "rejected"; res: NextResponse };

export async function optionalUser(req: NextRequest): Promise<OptionalAuth> {
  // No credential offered at all — the only case the route may treat as guest.
  if (!tokenFromRequest(req)) return { kind: "anonymous" };
  // A credential WAS offered, so it gets the full treatment.
  const auth = await requireUser(req);
  return auth.ok
    ? { kind: "user", claims: auth.claims, account: auth.account }
    : { kind: "rejected", res: auth.res };
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
