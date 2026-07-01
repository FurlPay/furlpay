import { NextRequest, NextResponse } from "next/server";
import { TIERS, gateByTier } from "@furlpay/compliance";
import { db } from "@/lib/store";

// GET /api/compliance/tier — current tier, limits, and the full tier ladder.
export async function GET() {
  const current = db.user.kycTier;
  return NextResponse.json({
    currentTier: current,
    spec: TIERS[current],
    tiers: Object.values(TIERS),
  });
}

// POST /api/compliance/tier — check whether an amount/feature is allowed.
// body: { amountUsd, feature? }
export async function POST(req: NextRequest) {
  const { amountUsd, feature } = await req.json().catch(() => ({}));
  const gate = gateByTier(db.user.kycTier, Number(amountUsd) || 0, feature);
  return NextResponse.json({ gate });
}
