import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import { claimCashback, creditCashbackToBalance, cashbackSummary } from "@/lib/services/membership";
import { newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/membership/cashback/claim — sweep every unclaimed accrual into one
// USDC credit.
//
// This pays out real value, so it follows the house rule from wallets/transfer:
// the balance ledger behind it is the demo one, and production refuses rather
// than crediting a payout that never settled. Idempotent per user — a retry
// after a timeout replays instead of paying twice.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "Cashback payouts are not enabled on this deployment." },
      { status: 503 },
    );
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "membership.cashback.claim", { limit: 10, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "membership.cashback.claim", async () => {
    let result;
    try {
      result = claimCashback(userId);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
    }

    const credited = creditCashbackToBalance(userId, result.claimedUsd);
    if (!credited) {
      return NextResponse.json({ ok: false, error: "account_unavailable" }, { status: 500 });
    }

    recordTransaction(
      userId,
      newTx({
        category: "yield",
        direction: "in",
        title: "Cashback claimed",
        subtitle: `${result.accrualIds.length} accrual${result.accrualIds.length === 1 ? "" : "s"}`,
        amountUsd: result.claimedUsd,
        token: "USDC",
        chain: "arbitrum",
        status: "settled",
      }),
    );

    return NextResponse.json({
      ok: true,
      claimedUsd: result.claimedUsd,
      accrualCount: result.accrualIds.length,
      summary: cashbackSummary(userId),
    });
  }, { principal: userId });
}
