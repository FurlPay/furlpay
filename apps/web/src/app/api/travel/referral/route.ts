import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { referralStats } from "@/lib/travel/referrals";

// GET /api/travel/referral — the user's referral link + stats.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.referral", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json(referralStats());
}
