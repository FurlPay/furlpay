import { NextRequest, NextResponse } from "next/server";
import { recordProductEvent } from "@/lib/analytics/events";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import { claimAndCreditCashback, cashbackSummary } from "@/lib/services/membership";
import { newTx, recordTransaction } from "@/lib/store";
import { log } from "@/lib/log";

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
    // One atomic claim-and-pay (lib/services/membership.ts claimAndCreditCashback):
    // in Postgres the accruals are locked, paid through the keyed financial
    // effect and marked claimed in a single transaction.
    let outcome;
    try {
      outcome = await claimAndCreditCashback(userId);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "Nothing to claim" || msg === "Cashback programme is not active") {
        return NextResponse.json({ ok: false, error: msg }, { status: 409 });
      }
      log.error("cashback claim failed", { userId, error: msg.slice(0, 200) });
      return NextResponse.json({ ok: false, error: "ledger_error" }, { status: 500 });
    }
    if (!outcome.applied) {
      return NextResponse.json({ ok: false, error: "Nothing to claim" }, { status: 409 });
    }
    // Lifecycle fact only; the money is in the ledger (claim_cashback, 0026).
    recordProductEvent({ name: "cashback_claimed", eventId: `${userId}:${Date.now()}`, userId, route: "/api/membership/cashback/claim" });

    recordTransaction(
      userId,
      newTx({
        category: "yield",
        direction: "in",
        title: "Cashback claimed",
        subtitle: `${outcome.accrualCount} accrual${outcome.accrualCount === 1 ? "" : "s"}`,
        amountUsd: outcome.claimedUsd,
        token: "USDC",
        chain: "arbitrum",
        status: "settled",
      }),
    );

    return NextResponse.json({
      ok: true,
      claimedUsd: outcome.claimedUsd,
      accrualCount: outcome.accrualCount,
      summary: cashbackSummary(userId),
    });
  }, { principal: userId });
}
