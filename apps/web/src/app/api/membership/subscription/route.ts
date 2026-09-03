import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getSubscription, planFor } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

// GET /api/membership/subscription — the caller's plan, and anything scheduled
// against it. The pending block is the point: a customer who asked to downgrade
// needs to see exactly what they keep and until when.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.subscription", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const sub = getSubscription(userId);
  return NextResponse.json({
    subscription: {
      status: sub.status,
      period: sub.period,
      autoRenew: sub.autoRenew,
      startedAt: sub.startedAt,
      nextBillingAt: sub.nextBillingAt,
      plan: planFor(sub.planId),
      pending: sub.pendingPlanId
        ? {
            plan: planFor(sub.pendingPlanId),
            at: sub.pendingTransitionAt,
            // "You asked for this" vs "your renewal failed" are very different
            // messages, so the client is told which it is.
            reason: sub.pendingReason,
          }
        : null,
    },
  });
}
