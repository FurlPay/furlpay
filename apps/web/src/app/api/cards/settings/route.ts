import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";

// POST /api/cards/settings — real-time card controls (Marqeta-style).
// body: { cardId, freeze?, limits?: { daily?, perPurchase? }, channels?, priority?, settlementCurrency? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const card = db.cards.find((c) => c.id === body.cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  if (typeof body.freeze === "boolean") card.frozen = body.freeze;
  if (body.limits) card.limits = { ...card.limits, ...body.limits };
  if (body.channels) card.channels = { ...card.channels, ...body.channels };
  if (body.settlementCurrency) card.settlementCurrency = body.settlementCurrency;
  // `priority` = asset spend order (which stablecoin to liquidate first).
  if (Array.isArray(body.priority)) (card as any).assetPriority = body.priority;

  return NextResponse.json({ success: true, card });
}
