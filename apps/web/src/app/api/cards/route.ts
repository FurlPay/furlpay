import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/store";
import { PaymentCard } from "@/lib/types";

// GET /api/cards — list cards.
export async function GET() {
  return NextResponse.json({ cards: db.cards });
}

// POST /api/cards — issue a virtual or physical Visa card (Marqeta/Lithic).
// body: { cardType: "virtual" | "physical", kycToken: string }
export async function POST(req: NextRequest) {
  const { cardType, kycToken } = await req.json().catch(() => ({}));

  if (cardType !== "virtual" && cardType !== "physical") {
    return NextResponse.json({ error: "cardType must be 'virtual' or 'physical'" }, { status: 400 });
  }
  // Card issuance requires a completed KYC (a valid kycToken).
  if (!kycToken || db.user.kycStatus !== "verified") {
    return NextResponse.json({ error: "Valid KYC required to issue a card" }, { status: 403 });
  }

  const last4 = String(1000 + Math.floor(Math.random() * 9000));
  const card: PaymentCard = {
    id: "card_" + crypto.randomBytes(5).toString("hex"),
    kind: cardType,
    label: cardType === "physical" ? "Metal Physical" : "New Virtual",
    last4,
    network: "Visa",
    frozen: false,
    gradient: ["#1C0F35", "#E02020"],
    limits: { perPurchase: 2500, daily: 5000, dailySpent: 0 },
    channels: { online: true, offline: cardType === "physical", atm: cardType === "physical" },
    settlementCurrency: "USD",
  };
  db.cards.push(card);

  return NextResponse.json({ cardId: card.id, status: "active", last4 }, { status: 201 });
}

// Card controls (freeze / limits / channels / settlement / priority) live at
// the canonical POST /api/cards/settings endpoint.
