import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireTenant, ok, notFound } from "@/lib/controlPlane/tenancy";
import { findMandate } from "@/lib/controlPlane/store";
import { mandateLiveness } from "@furlpay/control-plane";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/v1/mandates/:id
//
// TENANCY IS IN THE QUERY, NOT IN A CHECK AFTER THE READ. `findMandate` takes
// the organization and puts it in the filter, so another tenant's mandate is not
// fetched-then-rejected — it is never fetched. The difference matters: a
// fetch-then-check can be defeated by any path that forgets the check, and a
// reviewer has to notice something absent.
//
// AND THE 404 IS THE SAME 404 a genuinely unknown id gets. Answering 403 for
// "exists but not yours" would make every id an existence oracle.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "v1.mandates.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "agents:read");
  if (!tenant.ok) return tenant.res;

  const { id } = await ctx.params;
  const mandate = await findMandate(tenant.tenant.organizationId, id);
  if (!mandate) return notFound("mandate");

  const liveness = mandateLiveness(mandate, Date.now());

  return ok({
    id: mandate.mandateId,
    status: mandate.status,
    live: liveness.live,
    ...(liveness.live ? {} : { notLiveReason: liveness.reason, detail: liveness.detail }),
    principalId: mandate.principalId,
    delegatedTo: mandate.delegatedTo,
    authorityScope: mandate.authorityScope,
    issuedAt: mandate.issuedAt,
    expiresAt: mandate.expiresAt,
    notBefore: mandate.notBefore,
    singleUse: mandate.singleUse ?? false,
    policyVersion: mandate.policyVersion,
    ...(mandate.revokedAt ? { revokedAt: mandate.revokedAt, revokedReason: mandate.revokedReason } : {}),
    // The nonce and the credential token are deliberately absent: the nonce is a
    // replay guard and the token is the signed credential itself. Echoing either
    // hands a caller material they should already hold or must never hold.
  });
}
