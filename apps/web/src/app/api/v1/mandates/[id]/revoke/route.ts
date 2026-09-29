import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { requireTenant, ok, notFound, problem } from "@/lib/controlPlane/tenancy";
import { findMandate, revokeMandateRow } from "@/lib/controlPlane/store";
import { revokeSubject } from "@/lib/controlPlane/revocationAdapter";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/mandates/:id/revoke
//
// REVOCATION IS TWO WRITES, AND THE ORDER IS THE POINT. The mandate row is
// marked REVOKED (so a later read of the mandate itself is honest), and a row is
// added to `cp_revocations` (so the live revocation engine sees it on the very
// next authorization, including for a mandate already loaded into somebody's
// in-flight request).
//
// The revocation-engine write happens SECOND and is the one that must not fail
// silently: the status column is what a human reads, the revocation table is
// what the money path reads. If the second write fails the call reports failure,
// because a mandate that looks revoked in the UI and authorizes payments is the
// worst of the available outcomes.
//
// IDEMPOTENT BY CONSTRUCTION. Revoking an already-revoked mandate is a success,
// not a conflict — a client retrying after a timeout must not be told something
// went wrong when the thing it wanted is true.
// ---------------------------------------------------------------------------

const Body = z.object({ reason: z.string().min(1).max(500) }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Tighter than the read limit: revocation is an incident control and a
  // flood of them is either a bug or an attempt to obscure one.
  const limited = await rateLimitOr429(req, "v1.mandates.revoke", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "agents:manage");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  const { id } = await ctx.params;

  // Tenant-scoped: another organization's mandate is simply not found, so this
  // route cannot be used to revoke a competitor's authority.
  const mandate = await findMandate(tenant.tenant.organizationId, id);
  if (!mandate) return notFound("mandate");

  await revokeMandateRow({
    organizationId: tenant.tenant.organizationId,
    mandateId: id,
    reason: body.reason,
  });

  const recorded = await revokeSubject({
    organizationId: tenant.tenant.organizationId,
    kind: "mandate",
    subjectId: id,
    reason: body.reason,
    revokedBy: tenant.tenant.userId,
  });
  if (!recorded) {
    return problem(503, "revocation_not_recorded", {
      message:
        "The mandate status was updated but the revocation was not recorded, so the authorization " +
        "path may still honour it. Retry.",
    });
  }

  audit("agent.key_revoked", tenant.tenant.userId, {
    controlPlane: "mandate.revoked",
    mandateId: id,
    organizationId: tenant.tenant.organizationId,
    reason: body.reason,
  });

  return ok({ id, status: "REVOKED", revokedAt: new Date().toISOString(), reason: body.reason });
}
