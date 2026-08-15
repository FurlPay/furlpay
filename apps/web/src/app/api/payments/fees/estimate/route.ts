import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { estimateFees } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/fees/estimate?amount=150&sourceChain=base — public fee
// quote: Furlpay's 0.5% + Arbitrum gas, side by side with the 3.5% card
// interchange it replaces.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "payments.fees.estimate", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const amount = Number(req.nextUrl.searchParams.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  const sourceChain = req.nextUrl.searchParams.get("sourceChain") || "arbitrum";
  return NextResponse.json(await estimateFees(amount, sourceChain));
}
