import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { debitAccount } from "@/lib/services/account";

export const dynamic = "force-dynamic";

const SpendSchema = z.object({
  amountUsd: z.number().positive().max(1_000_000),
  memo: z.string().min(1).max(200),
  purpose: z.enum(["booking", "payout", "card", "transfer"]).optional(),
});

// POST /api/account/spend — spend from the FurlPay account balance (the second
// half of the funding loop). Session-gated. A booking or payout draws down the
// balance that was funded via x402. Returns the new balance or 402 if short.
export async function POST(req: NextRequest) {
  const parsed = parse(SpendSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { amountUsd, memo, purpose } = parsed.data;

  const subtitleByPurpose: Record<string, string> = {
    booking: "Travel booking · Arbitrum One",
    payout: "Creator payout · Arbitrum One",
    card: "Card top-up · Arbitrum One",
    transfer: "Transfer · Arbitrum One",
  };

  const result = debitAccount(amountUsd, memo, purpose ? subtitleByPurpose[purpose] : undefined);
  if (!result.ok) {
    return NextResponse.json(
      { spent: false, error: result.error, balanceUsd: result.balanceUsd.toFixed(2) },
      { status: result.error === "insufficient_balance" ? 402 : 400 }
    );
  }
  return NextResponse.json({ spent: true, amountUsd: amountUsd.toFixed(2), balanceUsd: result.balanceUsd.toFixed(2) });
}
