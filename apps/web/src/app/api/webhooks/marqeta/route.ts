import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { listAccounts, newTx, recordTransaction, type UserAccount } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { tryBegin, markProcessed, markFailed, endpointSecret } from "@/lib/webhookGuard";
import { log } from "@/lib/log";

// POST /api/webhooks/marqeta — real-time card swipe authorization request.
// Marqeta JIT-funding: we must approve/decline within the authorization window
// after running the off-chain policy engine (velocity/sanctions/MCC/limit).

/** Resolve which user's account a card belongs to. */
function accountForCard(cardId: string): { account: UserAccount; card: UserAccount["cards"][number] } | undefined {
  for (const account of listAccounts()) {
    const card = account.cards.find((c) => c.id === cardId);
    if (card) return { account, card };
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = endpointSecret(process.env.FURLPAY_ENDPOINT_SECRET, "whsec_sandbox_marqeta");
  if (!secret) {
    return NextResponse.json({ error: "webhook_secret_unconfigured" }, { status: 503 });
  }

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!tryBegin(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    // 3D Secure authentication request (e-commerce step-up).
    if (event.type === "threedsecure.authentication.request") {
      const { cardId, amountUsd, three_ds_requestor_url } = event.data;
      const owned = accountForCard(cardId);
      const card = owned?.card;
      // Step-up (challenge) for higher-value online spend; frictionless below $50.
      const challenge = !card || card.frozen || (amountUsd ?? 0) >= 50;
      markProcessed(event.id);
      return NextResponse.json({
        three_ds_authentication: {
          result: card && !card.frozen ? (challenge ? "challenge" : "frictionless") : "rejected",
          three_ds_requestor_url: three_ds_requestor_url ?? null,
          acs_url: challenge ? "https://acs.furlpay.app/challenge" : null,
        },
      });
    }

    if (event.type === "authorization.request" || event.type === "card.transaction.authorized") {
      const { cardId, amountUsd, merchant, mcc } = event.data;
      const owned = accountForCard(cardId);
      if (!owned) {
        markProcessed(event.id);
        return NextResponse.json({ jit_funding: { approved: false, reason: "unknown card" } });
      }
      const { account, card } = owned;
      const decision = evaluateSpend({ card, amountUsd, mcc, transactions: account.transactions });
      if (decision.approved) card.limits.dailySpent += amountUsd;

      recordTransaction(
        account.user.id,
        newTx({
          category: "card",
          direction: "out",
          title: merchant,
          subtitle: `${card.label} · ${card.network}`,
          amountUsd,
          cardId,
          status: decision.approved ? "settled" : "declined",
        })
      );

      markProcessed(event.id);
      return NextResponse.json({
        jit_funding: { approved: decision.approved, amount: amountUsd },
        decision,
      });
    }

    markProcessed(event.id);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    markFailed(event.id);
    log.error("marqeta webhook handler failed", { event: event.type, error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
