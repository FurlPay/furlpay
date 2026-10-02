import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { demoOnlyUnavailable } from "@/lib/demoGate";
export const dynamic = "force-dynamic";
import { issueGiftCard } from "@/lib/travel/giftcards";
import { validateBody } from "@/lib/validate";

const GiftCardBody = z.object({
  amountUsd: z.coerce.number().positive().min(10).max(5_000),
  payToken: z.string().trim().min(2).max(16).optional(),
  recipientEmail: z.string().trim().email().max(200).optional(),
  message: z.string().trim().max(500).optional(),
});

// POST /api/travel/gift-cards — purchase a travel gift card.
// Body: { amountUsd, payToken?, recipientEmail?, message? }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.gift.cards", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  // Development only: this "purchase" takes no payment, sends no email (yet
  // says "Emailed to …") and keeps the card in per-instance memory. Refused in
  // production until purchase, delivery and storage are real.
  const gate = demoOnlyUnavailable("Travel gift cards", "Gift cards cannot be paid for or delivered yet.");
  if (gate) return gate;

  const body = await validateBody(req, GiftCardBody);
  if (body instanceof NextResponse) return body;

  const card = issueGiftCard(body.amountUsd, body.recipientEmail, body.message);
  return NextResponse.json({
    giftCard: card,
    payToken: body.payToken ?? "USDC",
    delivery: body.recipientEmail ? `Emailed to ${body.recipientEmail}` : "Ready to share",
  });
}
