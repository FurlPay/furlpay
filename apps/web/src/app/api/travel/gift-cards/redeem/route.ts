import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { redeemGiftCard } from "@/lib/travel/giftcards";

// POST /api/travel/gift-cards/redeem — redeem a gift card code for travel credit.
// Body: { code }
//
// Development only. The store is per-instance memory, any well-formed unknown
// code "redeems" as a $50 sample, and no account is ever credited, yet the
// response says "USDC travel credit added". In production that is a balance
// change that did not happen, so it is refused until gift cards are paid for,
// persisted and redeemed into the ledger.
const Body = z.object({ code: z.string().trim().min(1).max(32) });

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "giftcards.redeem", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;
  const gate = demoOnlyUnavailable("Gift card redemption", "Gift cards are not paid for, stored or credited to an account yet.");
  if (gate) return gate;
  const body = await validateBody(req, Body, { maxBytes: 1024 });
  if (body instanceof NextResponse) return body;
  const result = redeemGiftCard(body.code.toUpperCase());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ redeemed: true, creditedUsd: result.amountUsd, balanceLabel: `${result.amountUsd} USDC travel credit added` });
}
