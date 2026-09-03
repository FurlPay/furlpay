import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { subscriptionHistory } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

// GET /api/membership/history — every plan change on the account, newest first.
// This is what a billing dispute is settled from, so it records what happened
// and what was charged, not just the current state.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.history", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const events = subscriptionHistory(userId).map((e) => ({
    id: e.id,
    at: e.at,
    type: e.type,
    from: e.fromPlanId,
    to: e.toPlanId,
    amountUsd: e.amountUsd,
  }));
  return NextResponse.json({ events, count: events.length });
}
