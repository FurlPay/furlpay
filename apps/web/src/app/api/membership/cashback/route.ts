import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { cashbackSummary, cashbackHistory, MCC_MULTIPLIERS } from "@/lib/services/membership";

export const dynamic = "force-dynamic";

// GET /api/membership/cashback — the cashback widget's data: this period's
// earnings against the cap, what is claimable, and the accrual ledger.
//
// A `deactivated` programme (fraud block) still returns the history. The block
// stops earning and claiming; it is not a reason to hide what someone already
// earned, and hiding it only generates a support ticket.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.cashback", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const summary = cashbackSummary(userId);
  const history = cashbackHistory(userId)
    .slice(0, 100)
    .map((a) => ({
      id: a.id,
      merchant: a.merchant,
      category: (MCC_MULTIPLIERS[a.mcc] ?? MCC_MULTIPLIERS.default).label,
      spendUsd: a.spendUsd,
      rate: a.rate,
      amountUsd: a.amountUsd,
      accruedAt: a.accruedAt,
      claimedAt: a.claimedAt,
    }));

  return NextResponse.json({ summary, history });
}
