import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { changePlan, cancelPendingTransition, planFor } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

const Change = z.object({
  plan: z.enum(["Standard", "Pro", "Ultra"]),
  period: z.enum(["monthly", "annual"]).optional(),
});

// POST /api/membership/change — move plan.
//
// Up applies now and is charged now; down is scheduled to the billing boundary
// and charged nothing, because the customer already paid for the period they
// are standing in. The service decides which — the client cannot ask for an
// immediate downgrade.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.change", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Change);
  if (body instanceof NextResponse) return body;

  // An upgrade takes a payment, so a retry after a timeout must not charge
  // twice. Scoped per user like every other money-moving route here.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, `membership.change:${userId}`, async () => {
    try {
      const result = changePlan(userId, body.plan, body.period ?? "monthly");
      return NextResponse.json({
        ok: true,
        effect: result.effect,
        chargeUsd: result.chargeUsd,
        subscription: {
          status: result.subscription.status,
          period: result.subscription.period,
          plan: planFor(result.subscription.planId),
          nextBillingAt: result.subscription.nextBillingAt,
          pending: result.subscription.pendingPlanId
            ? { plan: planFor(result.subscription.pendingPlanId), at: result.subscription.pendingTransitionAt }
            : null,
        },
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
    }
  });
}

// DELETE /api/membership/change — withdraw a scheduled move. The active plan
// simply carries on; nothing is re-charged and no new period starts.
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.change.cancel", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  try {
    const sub = cancelPendingTransition(userId);
    return NextResponse.json({
      ok: true,
      subscription: { status: sub.status, plan: planFor(sub.planId), nextBillingAt: sub.nextBillingAt, pending: null },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
