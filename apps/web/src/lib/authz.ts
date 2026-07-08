import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type Role, type SessionClaims } from "@/lib/session";
import { getAccount, type UserAccount } from "@/lib/store";

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

/** Resolve the acting user from the session cookie. 401 when absent/stale. */
export async function requireUser(req: NextRequest): Promise<AuthResult> {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!claims?.sub) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const account = getAccount(claims.sub);
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
  if (!auth.account.user.roles.includes(role)) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return auth;
}
