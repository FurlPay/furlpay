import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { redeemGiftCard } from "@/lib/travel/giftcards";

// POST /api/travel/gift-cards/redeem — redeem a gift card code for travel credit.
// Body: { code }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim().toUpperCase();
  const result = redeemGiftCard(code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ redeemed: true, creditedUsd: result.amountUsd, balanceLabel: `${result.amountUsd} USDC travel credit added` });
}
