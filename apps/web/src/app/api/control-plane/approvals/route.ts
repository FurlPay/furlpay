import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireHumanTenant, ok, problem } from "@/lib/controlPlane/tenancy";
import { pendingApprovalQueue } from "@/lib/controlPlane/approvals";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/control-plane/approvals — the payments waiting on a human.
//
// SESSION-AUTHENTICATED, NOT API-KEY. This is the queue a person works from on
// the web dashboard, the phone or the watch. An agent has no business reading
// which of its payments a human is about to look at, and the decide route next
// to this one must never accept an API key at all.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "cp.approvals.list", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireHumanTenant(req);
  if (!tenant.ok) return tenant.res;

  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 50;

  const queue = await pendingApprovalQueue(tenant.tenant.organizationId, limit);
  if (!queue) {
    return problem(503, "control_plane_unavailable", { message: "The approval queue could not be read." });
  }
  return ok({ approvals: queue, environment: tenant.tenant.environment });
}
