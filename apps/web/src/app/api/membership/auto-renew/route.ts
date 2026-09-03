import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { setAutoRenew, planFor } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

const Toggle = z.object({ enabled: z.boolean() });

// PATCH /api/membership/auto-renew — turn renewal on or off.
//
// Turning it OFF schedules the drop to the free plan rather than just clearing
// a flag, so the customer is shown the date they lose their benefits instead of
// discovering it at the boundary. Turning it back on withdraws that.
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.autorenew", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Toggle);
  if (body instanceof NextResponse) return body;

  try {
    const sub = setAutoRenew(userId, body.enabled);
    return NextResponse.json({
      ok: true,
      subscription: {
        status: sub.status,
        autoRenew: sub.autoRenew,
        plan: planFor(sub.planId),
        nextBillingAt: sub.nextBillingAt,
        pending: sub.pendingPlanId ? { plan: planFor(sub.pendingPlanId), at: sub.pendingTransitionAt } : null,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
