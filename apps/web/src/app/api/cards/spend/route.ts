import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTx, recordTransaction } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";

// POST /api/cards/spend — simulate a card authorization through the policy
// engine, against the SESSION user's card.
// body: { cardId, amountUsd, merchant, mcc?, destinationAddress? }
//
// amountUsd is bounded and strictly positive: it is added straight onto
// `card.limits.dailySpent` below, so an unvalidated negative would REDUCE the
// spent counter and hand the caller unlimited daily headroom (and write a
// negative-amount transaction into history).
const SpendSchema = z.object({
  cardId: z.string().min(1).max(64),
  amountUsd: z.number().positive().max(1_000_000),
  merchant: z.string().max(200).optional(),
  mcc: z.string().max(8).optional(),
  destinationAddress: z.string().max(128).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, SpendSchema);
  if (body instanceof Response) return body as never;
  const { cardId, amountUsd, merchant, mcc, destinationAddress } = body;

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
