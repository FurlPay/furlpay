import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser, type AuthResult } from "@/lib/authz";
import { canonicalEmail, isPlausibleEmail } from "@/lib/identity";

// ---------------------------------------------------------------------------
// Settlement recovery approvers (finding FP-SET-09).
//
// Critical incidents need two DISTINCT approvers, and only one account can
// hold the admin role (FURLPAY_ADMIN_EMAIL). The existing second-identity
// mechanism, a compliance_officer role grant, needs two admins to issue
// (requester != approver), so it cannot bootstrap a second approver either.
//
// SETTLEMENT_RECOVERY_APPROVER_EMAILS names, explicitly and in configuration,
// the accounts that may cast a recovery approval and nothing else:
//   - read breaker state (they must see the incident and its evidence);
//   - POST {action:"approve"} to /api/ops/settlement-safety.
// They cannot halt, mitigate, or reach any other admin route. Every other
// safeguard still applies to them: a real (non-guest) signed-in session, a
// fresh step-up claimed atomically per approval, distinctness from the
// mitigator and from other approvers (approveRecovery), and the server-side
// health/reconciliation checks.
//
// Same trust root as FURLPAY_ADMIN_EMAIL: an environment variable only the
// deployment owner can set. Unset means no extra approvers, and critical
// recovery stays fail-closed with a single admin, which is the safe default.
// ---------------------------------------------------------------------------

/** At most this many approvers: this is a short list of named humans, not a role. */
export const MAX_RECOVERY_APPROVERS = 5;

/** The configured approver emails, canonicalised. Malformed entries are
 *  dropped, never trusted; more than the cap is treated as misconfiguration
 *  and yields NO approvers (fail closed) rather than an arbitrary prefix. */
export function recoveryApproverEmails(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.SETTLEMENT_RECOVERY_APPROVER_EMAILS ?? "").trim();
  if (!raw) return [];
  const list = [...new Set(raw.split(",").map((e) => canonicalEmail(e)).filter((e) => e && isPlausibleEmail(e)))];
  return list.length > MAX_RECOVERY_APPROVERS ? [] : list;
}

export function isRecoveryApproverEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  return recoveryApproverEmails(env).includes(canonicalEmail(email));
}

/** requireUser + membership in the approver list. Guests never qualify. */
export async function requireRecoveryApprover(req: NextRequest): Promise<AuthResult> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth;
  if (auth.claims.guest || !isRecoveryApproverEmail(auth.account.user.email)) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return auth;
}
