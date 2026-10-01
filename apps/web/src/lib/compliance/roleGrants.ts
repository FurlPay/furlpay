import { randomUUID, createHash } from "crypto";
import { kvGet, kvSet, kvSetNx, kvDel } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/ops/events";
import { noteSensitiveAccess } from "@/lib/ops/dataAccessAnomaly";
import type { Role } from "@/lib/session";
import { isBootstrapAdminEmail } from "@/lib/adminIdentity";

// ---------------------------------------------------------------------------
// Dual-controlled provisioning for privileged roles.
//
// WHY THIS EXISTS (FP-ROLE-001).
//
// The Sovereign Authority Gate refuses a disclosure unless the approver differs
// from the officer who staged it. That control was correct and completely
// inert: exactly one seeded account could hold `compliance_officer`, and no code
// path granted it to anyone else. So `stagedBy !== approverId` could never be
// satisfied and EVERY statutory disclosure was blocked.
//
// Failing closed is the right direction, but a control that makes the legitimate
// workflow impossible is the thing that gets switched off at 2am during a real
// emergency request. The fix is not to weaken dual control — it is to make a
// second officer possible to create, safely.
//
// THE SHAPE OF THE FIX.
//
// Granting the role is itself dual-controlled, for the same reason disclosing a
// dossier is: otherwise one compromised admin mints themselves a colleague and
// satisfies two-person integrity alone.
//
//     Admin A  ──requests──>  grant (pending)
//     Admin B  ──approves──>  grant (active)      A ≠ B, enforced
//     Either   ──revokes───>  grant (revoked)     takes effect immediately
//
// GRANTS ARE AUTHORITATIVE FOR PRIVILEGED ROLES.
//
// `user.roles` is a seed field on an account record. If it stayed the source of
// truth, revocation would mean rewriting account rows and a stale replica would
// keep authorizing — "stale roles cannot authorize actions" would be a comment
// rather than a property. So `effectivePrivilegedRoles()` intersects the seeded
// list with live grants, and authz consults that. Revoking is one write and it
// is effective on the next request everywhere.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM.
//
// It cannot prove two accounts are two humans. It refuses the trivial bypasses —
// same user, same session — and records what it saw so the rest is answerable
// from the trail. Anything beyond that is organizational policy, not code, and
// is marked as such rather than faked.
// ---------------------------------------------------------------------------

/**
 * Roles whose possession is governed by a grant.
 *
 * `admin` is deliberately ABSENT. It is already pinned to a single configured
 * founder address in `requireRole`, and routing it through a store that the
 * founder would need admin to reach is a bootstrap deadlock — the first admin
 * has to come from configuration. `compliance_officer` is the role that needs to
 * multiply, and it is the one that reaches customer dossiers.
 */
export const GRANTABLE_ROLES = ["compliance_officer"] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export function isGrantableRole(role: string): role is GrantableRole {
  return (GRANTABLE_ROLES as readonly string[]).includes(role);
}

export const GRANT_STATUSES = ["pending", "active", "revoked", "rejected"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/**
 * Who performed a step, and under what credential.
 *
 * `sessionHash` is a SHA-256 of the session's `jti`, never the jti itself: this
 * record is read by the ops console, and a live session identifier in a
 * human-readable audit row is a credential sitting in a log. The hash is enough
 * to prove two steps came from DIFFERENT sessions, which is the only question
 * dual control asks of it.
 */
export interface GrantActor {
  userId: string;
  sessionHash: string;
  /** OIDC auth_time — when this actor last actually proved who they were. */
  authTime?: number;
  at: string;
}

export interface RoleGrant {
  id: string;
  subjectUserId: string;
  role: GrantableRole;
  status: GrantStatus;
  reason: string;
  requestedBy: GrantActor;
  approvedBy?: GrantActor;
  revokedBy?: GrantActor;
  revocationReason?: string;
  rejectedBy?: GrantActor;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

const grantKey = (id: string) => `rbac:grant:${id}`;
/** One ACTIVE-or-PENDING grant per (subject, role). Also the concurrency lock. */
const slotKey = (subject: string, role: string) => `rbac:slot:${subject}:${role}`;
const INDEX_KEY = "rbac:grant:index";

function hashSession(jti: string | undefined): string {
  return createHash("sha256").update(jti ?? "no-jti").digest("hex").slice(0, 32);
}

export function actorFrom(claims: { sub: string; jti?: string; auth_time?: number }): GrantActor {
  return {
    userId: claims.sub,
    sessionHash: hashSession(claims.jti),
    authTime: claims.auth_time,
    at: new Date().toISOString(),
  };
}

export async function getRoleGrant(id: string): Promise<RoleGrant | null> {
  return kvGet<RoleGrant>(grantKey(id));
}

async function saveGrant(grant: RoleGrant): Promise<void> {
  await kvSet(grantKey(grant.id), grant);
  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  if (!ids.includes(grant.id)) {
    await kvSet(INDEX_KEY, [grant.id, ...ids].slice(0, 2000));
  }
}

export async function listRoleGrants(): Promise<RoleGrant[]> {
  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  const out: RoleGrant[] = [];
  for (const id of ids) {
    const g = await getRoleGrant(id);
    if (g) out.push(g);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type GrantResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Step 1 — an admin requests the role for someone.
 *
 * The slot key is claimed with set-if-absent, which is what makes this safe
 * under concurrency: two admins racing to request the same role for the same
 * person produce ONE pending grant, not two that could then be approved
 * separately into a duplicate.
 */
export async function requestRoleGrant(input: {
  subjectUserId: string;
  role: GrantableRole;
  reason: string;
  requestedBy: GrantActor;
}): Promise<GrantResult<RoleGrant>> {
  if (!isGrantableRole(input.role)) {
    return { ok: false, reason: "That role is not grantable through this workflow." };
  }
  if (!input.reason || input.reason.trim().length < 10) {
    return { ok: false, reason: "A substantive reason is required for a privileged role grant." };
  }

  // SELF-SERVICE IS THE WHOLE ATTACK. An admin requesting the role FOR THEMSELVES
  // and a colleague rubber-stamping it is a weaker control than intended, but an
  // admin who could both request and approve their own would be no control at
  // all. Requesting for yourself is refused outright so the second signature can
  // never be the only thing standing between one identity and the dossier.
  if (input.subjectUserId === input.requestedBy.userId) {
    return {
      ok: false,
      reason: "You cannot request a privileged role for your own account.",
    };
  }

  const id = `grant_${randomUUID()}`;
  const claimed = await kvSetNx(slotKey(input.subjectUserId, input.role), id, 60 * 60 * 24 * 365);
  if (!claimed) {
    return {
      ok: false,
      reason: "That user already has an active or pending grant for this role.",
    };
  }

  const now = new Date().toISOString();
  const grant: RoleGrant = {
    id,
    subjectUserId: input.subjectUserId,
    role: input.role,
    status: "pending",
    reason: input.reason.trim(),
    requestedBy: input.requestedBy,
    createdAt: now,
    updatedAt: now,
  };

  await saveGrant(grant);
  // An admin building themselves a quorum does it by making several grants in a
  // row. Each is individually legitimate; the run is the signal.
  await noteSensitiveAccess({
    kind: "role_change",
    actorId: input.requestedBy.userId,
    resourceRef: id,
  });
  audit("rbac.grant_requested", input.requestedBy.userId, {
    grantId: id,
    subject: input.subjectUserId,
    role: input.role,
  });
  return { ok: true, value: grant };
}

/**
 * Step 2 — a DIFFERENT admin approves.
 *
 * Three separate identities are compared, and each rejection is a distinct
 * bypass that would otherwise work:
 *
 *   approver === requester   one admin provisioning their own colleague
 *   approver === subject     the recipient waving through their own promotion
 *   same session             one browser tab satisfying both halves, which is
 *                            what "two accounts" looks like when one person
 *                            holds both passwords
 */
export async function approveRoleGrant(
  grantId: string,
  approver: GrantActor
): Promise<GrantResult<RoleGrant>> {
  const grant = await getRoleGrant(grantId);
  if (!grant) return { ok: false, reason: "Grant not found." };
  if (grant.status !== "pending") {
    return { ok: false, reason: `Cannot approve a grant in status '${grant.status}'.` };
  }

  if (approver.userId === grant.requestedBy.userId) {
    await recordSecurityEvent({
      rail: "transfers",
      kind: "rbac_self_approval_blocked",
      severity: "high",
      detail: `${approver.userId} attempted to approve their own role-grant request ${grantId}`,
      actor: approver.userId,
    }).catch(() => {});
    return { ok: false, reason: "Dual control: the approver must differ from the requester." };
  }
  if (approver.userId === grant.subjectUserId) {
    return { ok: false, reason: "Dual control: the recipient cannot approve their own grant." };
  }
  if (approver.sessionHash === grant.requestedBy.sessionHash) {
    // Same signed session on both halves. Two distinct user ids cannot share a
    // jti, so this fires when one browser drives both — the cheapest form of
    // the same-person bypass, and the only one code can see.
    return { ok: false, reason: "Dual control: both approvals came from the same session." };
  }

  // ATOMIC TRANSITION. Two approvers clicking at once would otherwise both read
  // `pending`, both pass the checks and both write `active` — harmless for the
  // status but it would record the second approver over the first and emit two
  // audit events for one grant. The set-if-absent decides a single winner.
  const won = await kvSetNx(`${grantKey(grantId)}:approving`, approver.userId, 60);
  if (!won) return { ok: false, reason: "Another approval is already in progress." };

  const fresh = await getRoleGrant(grantId);
  if (!fresh || fresh.status !== "pending") {
    await kvDel(`${grantKey(grantId)}:approving`);
    return { ok: false, reason: "Grant is no longer pending." };
  }

  fresh.status = "active";
  fresh.approvedBy = approver;
  fresh.updatedAt = new Date().toISOString();
  await saveGrant(fresh);
  await kvDel(`${grantKey(grantId)}:approving`);

  audit("rbac.grant_approved", approver.userId, {
    grantId,
    subject: fresh.subjectUserId,
    role: fresh.role,
    requestedBy: fresh.requestedBy.userId,
  });
  await recordSecurityEvent({
    rail: "transfers",
    kind: "rbac_grant_activated",
    severity: "high",
    detail:
      `Role '${fresh.role}' granted to ${fresh.subjectUserId} ` +
      `(requested by ${fresh.requestedBy.userId}, approved by ${approver.userId})`,
    actor: approver.userId,
  }).catch(() => {});

  return { ok: true, value: fresh };
}

/** Refuse a pending grant. Frees the slot so a corrected request can be made. */
export async function rejectRoleGrant(
  grantId: string,
  actor: GrantActor,
  reason: string
): Promise<GrantResult<RoleGrant>> {
  const grant = await getRoleGrant(grantId);
  if (!grant) return { ok: false, reason: "Grant not found." };
  if (grant.status !== "pending") {
    return { ok: false, reason: `Cannot reject a grant in status '${grant.status}'.` };
  }

  grant.status = "rejected";
  grant.rejectedBy = actor;
  grant.rejectionReason = reason;
  grant.updatedAt = new Date().toISOString();
  await saveGrant(grant);
  await kvDel(slotKey(grant.subjectUserId, grant.role));

  audit("rbac.grant_rejected", actor.userId, { grantId, subject: grant.subjectUserId, reason });
  return { ok: true, value: grant };
}

/**
 * Revoke an active grant. Single-actor ON PURPOSE.
 *
 * Granting privilege needs two people; REMOVING it must not, or an incident
 * response waits for a second signature while a compromised officer still holds
 * the role. Asymmetry is the correct shape: the dangerous direction is gaining
 * access, not losing it.
 */
export async function revokeRoleGrant(
  grantId: string,
  actor: GrantActor,
  reason: string
): Promise<GrantResult<RoleGrant>> {
  const grant = await getRoleGrant(grantId);
  if (!grant) return { ok: false, reason: "Grant not found." };
  if (grant.status !== "active" && grant.status !== "pending") {
    return { ok: false, reason: `Cannot revoke a grant in status '${grant.status}'.` };
  }

  grant.status = "revoked";
  grant.revokedBy = actor;
  grant.revocationReason = reason;
  grant.updatedAt = new Date().toISOString();
  await saveGrant(grant);
  // Free the slot so the person can be re-granted later through the full
  // workflow. The revoked record stays in the index as the audit trail.
  await kvDel(slotKey(grant.subjectUserId, grant.role));

  audit("rbac.grant_revoked", actor.userId, {
    grantId,
    subject: grant.subjectUserId,
    role: grant.role,
    reason,
  });
  await recordSecurityEvent({
    rail: "transfers",
    kind: "rbac_grant_revoked",
    severity: "high",
    detail: `Role '${grant.role}' revoked from ${grant.subjectUserId} by ${actor.userId}: ${reason}`,
    actor: actor.userId,
  }).catch(() => {});

  return { ok: true, value: grant };
}

/**
 * Does this user hold an ACTIVE grant for this role right now?
 *
 * Reads the slot pointer then the grant, rather than scanning the index: the
 * index is unbounded-ish and this runs on every privileged request.
 */
export async function hasActiveGrant(userId: string, role: GrantableRole): Promise<boolean> {
  const id = await kvGet<string>(slotKey(userId, role));
  if (!id) return false;
  const grant = await getRoleGrant(id);
  return grant?.status === "active" && grant.subjectUserId === userId && grant.role === role;
}

/**
 * The bootstrap account.
 *
 * Grants are authoritative, which creates a chicken-and-egg problem: with an
 * empty grant store nobody holds `compliance_officer`, so nobody can be the
 * second signature that creates the first one. The configured founder address
 * is the seed of trust that breaks it — the same address `requireRole` already
 * pins `admin` to, so this widens nothing that was not already trusted.
 *
 * Read from the environment on every call rather than cached, so rotating it
 * takes effect on the next request rather than the next deploy.
 */
function isBootstrap(email: string | null | undefined): boolean {
  // No production fallback: when FURLPAY_ADMIN_EMAIL is unset in production,
  // nobody is the bootstrap founder (lib/adminIdentity.ts).
  return isBootstrapAdminEmail(email);
}

/**
 * Which privileged roles this account may actually exercise.
 *
 * `user.roles` is a SEED, not an authority. A role survives into the returned
 * set only if the account is the bootstrap founder or a live grant backs it —
 * so revoking a grant stops authorizing on the next request, everywhere, with
 * one write and no account-row rewrite to replicate.
 *
 * Non-grantable roles pass through untouched: `admin` is pinned by configuration
 * in `requireRole`, and `user` is not a privilege.
 */
export async function effectiveRoles(account: {
  user: { id: string; email: string; roles: Role[] };
}): Promise<Role[]> {
  const bootstrap = isBootstrap(account.user.email);
  const out: Role[] = [];

  for (const role of account.user.roles) {
    if (!isGrantableRole(role)) {
      out.push(role);
      continue;
    }
    if (bootstrap) {
      out.push(role);
      continue;
    }
    if (await hasActiveGrant(account.user.id, role)) out.push(role);
  }

  // A grant can also ADD a role the seed never carried — which is the entire
  // point of provisioning a second officer.
  for (const role of GRANTABLE_ROLES) {
    if (out.includes(role)) continue;
    if (await hasActiveGrant(account.user.id, role)) out.push(role);
  }

  return out;
}
