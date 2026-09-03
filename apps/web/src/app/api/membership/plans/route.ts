import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { MEMBERSHIP_PLANS, MCC_MULTIPLIERS } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

// GET /api/membership/plans — the price list. Public: it is the pricing page's
// data source as well as the app's, and there is nothing account-specific in it.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "membership.plans", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({
    plans: MEMBERSHIP_PLANS,
    categoryMultipliers: Object.entries(MCC_MULTIPLIERS)
      .filter(([mcc]) => mcc !== "default")
      .map(([mcc, v]) => ({ mcc, ...v })),
  });
}
