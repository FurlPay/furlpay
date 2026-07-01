import { NextRequest, NextResponse } from "next/server";
import { db, newTx, recordTransaction } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";

// POST /api/cards/spend — simulate a card authorization through the policy engine.
// body: { cardId, amountUsd, merchant, mcc?, destinationAddress? }
export async function POST(req: NextRequest) {
  const { cardId, amountUsd, merchant, mcc, destinationAddress } = await req.json();
  const card = db.cards.find((c) => c.id === cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const decision = evaluateSpend({ card, amountUsd, mcc, destinationAddress });

  const tx = newTx({
    category: "card",
    direction: "out",
    title: merchant || "Card purchase",
    subtitle: `${card.label} · ${card.network}`,
    amountUsd,
    cardId,
    status: decision.approved ? "settled" : "declined",
  });
  recordTransaction(tx);

  if (decision.approved) {
    card.limits.dailySpent += amountUsd;
  }

  return NextResponse.json({ decision, transaction: tx });
}
