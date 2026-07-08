import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { listPendingChallenges } from "@/lib/services/cardAuthChallenges";

// GET /api/cards/challenges — the signed-in user's pending 3DS2 OOB
// transaction-approval challenges (what the mobile app polls / deep-links to).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const challenges = await listPendingChallenges(auth.account.user.id);
  return NextResponse.json({
    challenges: challenges.map((c) => ({
      id: c.id,
      amountUsd: c.amountUsd,
      currency: c.currency,
      merchant: c.merchant,
      cardId: c.cardId,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
    })),
  });
}
