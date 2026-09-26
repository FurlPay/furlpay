import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import {
  GRANTABLE_ROLES,
  actorFrom,
  approveRoleGrant,
  listRoleGrants,
  rejectRoleGrant,
  requestRoleGrant,
  revokeRoleGrant,
} from "@/lib/compliance/roleGrants";

export const dynamic = "force-dynamic";

// Privileged-role provisioning — the fix for FP-ROLE-001.
//
// Dual control on a disclosure is worthless if only one person can ever hold the
// role, and that was the state: one seeded account, no way to make a second, so
// `stagedBy !== approverId` blocked every statutory request. This is how a second
// compliance officer comes to exist without one admin being able to mint one
// alone.
//
// ADMIN-GATED, NOT COMPLIANCE-GATED. Officers must not be able to recruit more
// officers — that is a self-expanding privilege. `requireRole(req, "admin")` is
// pinned to the configured founder address, so the entry point is the narrowest
// identity in the system, and the dual-control check inside the library is what
// stops even that identity acting alone.

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"),
    subjectUserId: z.string().trim().min(3).max(128),
    role: z.enum(GRANTABLE_ROLES),
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({ action: z.literal("approve"), grantId: z.string().trim().min(6).max(128) }),
  z.object({
    action: z.literal("reject"),
    grantId: z.string().trim().min(6).max(128),
    reason: z.string().trim().min(5).max(1000),
  }),
  z.object({
    action: z.literal("revoke"),
    grantId: z.string().trim().min(6).max(128),
    reason: z.string().trim().min(5).max(1000),
  }),
]);

// GET — the provisioning log. Grants carry no customer data, only who holds what
// and who signed for it, so the whole record is returned.
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "rbac.grants.list", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({ ok: true, grants: await listRoleGrants() });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;

  // Tight. Privilege changes are rare by nature, and a burst of them is either a
  // scripted attack or a mistake worth slowing down.
  const limited = await rateLimitOr429(
    req,
    "rbac.grants.write",
    { limit: 20, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const body = await validateBody(req, ActionSchema);
  if (body instanceof NextResponse) return body;

  // Built from the VERIFIED session, never from the request body. A client-named
  // actor would make every dual-control check in the library decorative — the
  // requester could simply claim to be someone else on the approval call.
  const actor = actorFrom(auth.claims);

  const result =
    body.action === "request"
      ? await requestRoleGrant({
          subjectUserId: body.subjectUserId,
          role: body.role,
          reason: body.reason,
          requestedBy: actor,
        })
      : body.action === "approve"
        ? await approveRoleGrant(body.grantId, actor)
        : body.action === "reject"
          ? await rejectRoleGrant(body.grantId, actor, body.reason)
          : await revokeRoleGrant(body.grantId, actor, body.reason);

  if (!result.ok) {
    // 409, not 403. These are state and dual-control conflicts — "you already
    // requested this", "the approver must differ" — and a 403 would read as an
    // authentication problem and send an admin off to check their session.
    return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, grant: result.value });
}
