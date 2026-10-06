import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { debitAccount } from "@/lib/services/account";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";

export const dynamic = "force-dynamic";

const SpendSchema = z.object({
  amountUsd: z.number().positive().max(1_000_000),
  memo: z.string().min(1).max(200),
  purpose: z.enum(["booking", "payout", "card", "transfer"]).optional(),
});

// POST /api/account/spend — spend from the FurlPay account balance (the second
// half of the funding loop). The debit is applied to the SESSION user's
// balance — never a caller-chosen account. Returns the new balance or 402 if short.
//
// NOT LIVE (ACCOUNT_SPEND_LIVE, `unimplemented`). The debit reached a REAL ledger
// balance and was booked as "Card top-up · Arbitrum One" / "Creator payout ·
// Arbitrum One", while no rail delivered anything — a user's money destroyed
// behind a fabricated on-chain label. It also had no idempotency, so a retried
// request debited twice. Production now answers 503; elsewhere the debit is a
// labelled simulation, and an Idempotency-Key replays instead of re-debiting.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  if (capabilityMode("ACCOUNT_SPEND_LIVE") === null) {
    return capabilityUnavailable("ACCOUNT_SPEND_LIVE", "Spending from the account balance");
  }

  const limited = await rateLimitOr429(req, "account.spend", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = parse(SpendSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { amountUsd, memo, purpose } = parsed.data;

  // Only reachable in simulation (ACCOUNT_SPEND_LIVE cannot be on), so the
  // label says so rather than naming a chain nothing was sent on.
  const subtitleByPurpose: Record<string, string> = {
    booking: "Simulated travel booking · no funds delivered",
    payout: "Simulated payout · no funds delivered",
    card: "Simulated card top-up · no funds delivered",
    transfer: "Simulated transfer · no funds delivered",
  };

  // A debit needs a caller-chosen key: it becomes the financial effect key, so
  // a retried request can never debit twice (audit P0-1). No key, no debit.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ spent: false, error: "idempotency_key_required" }, { status: 400 });
  }

  return withIdempotency(
    idempotencyKey,
    "account.spend",
    async () => {
      const result = await debitAccount(
        auth.account.user.id,
        amountUsd,
        memo,
        purpose ? subtitleByPurpose[purpose] : undefined,
        `account-spend:${auth.account.user.id}:${idempotencyKey}`
      );
      if (!result.ok) {
        return NextResponse.json(
          { spent: false, error: result.error, balanceUsd: result.balanceUsd.toFixed(2) },
          { status: result.error === "insufficient_balance" ? 402 : 400 }
        );
      }
      return NextResponse.json({ spent: true, simulated: true, amountUsd: amountUsd.toFixed(2), balanceUsd: result.balanceUsd.toFixed(2) });
    },
    { principal: auth.account.user.id, request: parsed.data }
  );
}
