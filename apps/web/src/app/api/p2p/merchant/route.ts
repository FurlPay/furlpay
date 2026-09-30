import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getMerchant, makerEligibility, merchantProfile } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

// GET /api/p2p/merchant — the caller's own maker profile plus whether they can
// apply to be certified. Pass ?userId= to read another user's PUBLIC badge
// (rating, completed orders, online) — never their deposit or application state.
export async function GET(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.merchant.get", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const other = req.nextUrl.searchParams.get("userId");
  if (other && other !== userId) {
    return NextResponse.json({ merchant: merchantProfile(other) });
  }

  const m = getMerchant(userId);
  return NextResponse.json({
    merchant: {
      ...merchantProfile(userId),
      status: m.status,
      depositUsd: m.depositUsd,
      appliedAt: m.appliedAt,
      decidedAt: m.decidedAt,
    },
    eligibility: makerEligibility(userId, auth.account.user.kycStatus === "verified"),
  });
}
