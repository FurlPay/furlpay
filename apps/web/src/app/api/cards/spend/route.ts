import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTx, recordTransaction } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { notifyTransaction } from "@/lib/notify";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { cardIssuerOr503 } from "@/lib/cardIssuer";

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
  // No issuer is contracted: this route cannot produce a real card
  // credential or authorization. See lib/cardIssuer.ts.
  const unavailable = cardIssuerOr503("Card authorization");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // AGENTS.md rule 2. This route had NO per-route budget while every other
  // money-moving route has one: it increments `card.limits.dailySpent` and
  // writes transaction history, so the middleware baseline (150/min/IP, shared
  // across every endpoint) was the only thing bounding it. A card authorization
  // is a rarer act than a page load and gets a much tighter budget.
  const limited = await rateLimitOr429(
    req,
    "cards.spend",
    { limit: 20, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

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

  // Fire-and-forget on purpose: the authorization decision has been made and
  // recorded; a notification failure must neither slow nor fail it. Declines
  // carry the policy engine's reasons verbatim — the user reads the same
  // words the engine wrote when it refused.
  void notifyTransaction(auth.account, {
    kind: decision.approved ? "card_approved" : "card_declined",
    amountUsd,
    counterparty: merchant || "Card purchase",
    cardLabel: `${card.label} · ${card.network}`,
    mcc: mcc ? String(mcc) : undefined,
    reasons: decision.approved ? undefined : decision.reasons,
    dateIso: new Date().toISOString(),
  });

  return NextResponse.json({ decision, transaction: tx });
}
