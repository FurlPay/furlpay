import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { referralStats } from "@/lib/travel/referrals";

// GET /api/travel/referral — the user's referral link + stats.
export async function GET() {
  return NextResponse.json(referralStats());
}
