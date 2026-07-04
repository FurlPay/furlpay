import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { issueGiftCard } from "@/lib/travel/giftcards";

// POST /api/travel/gift-cards — purchase a travel gift card.
// Body: { amountUsd, payToken?, recipientEmail?, message? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body.amountUsd);
  if (!amountUsd || amountUsd < 10) {
    return NextResponse.json({ error: "amountUsd must be at least $10" }, { status: 400 });
  }
  const card = issueGiftCard(amountUsd, body.recipientEmail, body.message);
  return NextResponse.json({
    giftCard: card,
    payToken: body.payToken ?? "USDC",
    delivery: body.recipientEmail ? `Emailed to ${body.recipientEmail}` : "Ready to share",
  });
}
