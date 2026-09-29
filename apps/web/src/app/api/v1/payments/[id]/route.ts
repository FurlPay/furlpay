import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireTenant, ok, notFound } from "@/lib/controlPlane/tenancy";
import { findAuthorization } from "@/lib/controlPlane/store";
import { publicAuthorization } from "@/lib/controlPlane/authorize";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/v1/payments/:id — the current state of one authorization.
//
// Tenant-scoped in the query, so another organization's payment is NOT FOUND
// rather than forbidden. See tenancy.ts for why those must be the same answer:
// distinguishing them turns every id into an existence oracle.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "v1.payments.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "payments:read");
  if (!tenant.ok) return tenant.res;

  const { id } = await ctx.params;
  const row = await findAuthorization(tenant.tenant.organizationId, id);
  if (!row) return notFound("payment");

  return ok(publicAuthorization(row));
}
