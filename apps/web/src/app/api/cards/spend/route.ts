import { NextRequest, NextResponse } from "next/server";
import { newTx, recordTransaction } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { requireUser } from "@/lib/authz";

// POST /api/cards/spend — simulate a card authorization through the policy
// engine, against the SESSION user's card.
// body: { cardId, amountUsd, merchant, mcc?, destinationAddress? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const { cardId, amountUsd, merchant, mcc, destinationAddress } = await req.json();
  const card = auth.account.cards.find((c) => c.id === cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const decision = evaluateSpend({
    card,
    amountUsd,
    mcc,
    destinationAddress,
    transactions: auth.account.transactions,
  });

  const tx = newTx({
    category: "card",
    direction: "out",
    title: merchant || "Card purchase",
    subtitle: `${card.label} · ${card.network}`,
    amountUsd,
    cardId,
    status: decision.approved ? "settled" : "declined",
  });
  recordTransaction(auth.account.user.id, tx);

  if (decision.approved) {
    card.limits.dailySpent += amountUsd;
  }

  return NextResponse.json({ decision, transaction: tx });
}
