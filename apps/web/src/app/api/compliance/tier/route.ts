import { NextRequest, NextResponse } from "next/server";
import { TIERS, gateByTier } from "@furlpay/compliance";
import { requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Advisory tier/limit info for the ACTING user. (Authoritative money-movement
// gating happens server-side in the transfer/payment routes against the same
// kycTier; this endpoint just surfaces it to the UI.) Previously it read the
// seeded demo account, so it returned the wrong tier for real users.

// GET /api/compliance/tier — current tier, limits, and the full tier ladder.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const current = auth.account.user.kycTier;
  return NextResponse.json({
    currentTier: current,
    spec: TIERS[current],
    tiers: Object.values(TIERS),
  });
}

// POST /api/compliance/tier — check whether an amount/feature is allowed.
// body: { amountUsd, feature? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { amountUsd, feature } = await req.json().catch(() => ({}));
  const gate = gateByTier(auth.account.user.kycTier, Number(amountUsd) || 0, feature);
  return NextResponse.json({ gate });
}
