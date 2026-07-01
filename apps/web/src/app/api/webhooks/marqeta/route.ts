import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { db } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { newTx, recordTransaction } from "@/lib/store";
import { markProcessed } from "@/lib/webhookGuard";

// POST /api/webhooks/marqeta — real-time card swipe authorization request.
// Marqeta JIT-funding: we must approve/decline within the authorization window
// after running the off-chain policy engine (velocity/sanctions/MCC/limit).
export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.FURLPAY_ENDPOINT_SECRET || "whsec_sandbox_marqeta";

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!markProcessed(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  // 3D Secure authentication request (e-commerce step-up).
  if (event.type === "threedsecure.authentication.request") {
    const { cardId, amountUsd, three_ds_requestor_url } = event.data;
    const card = db.cards.find((c) => c.id === cardId);
    // Step-up (challenge) for higher-value online spend; frictionless below $50.
    const challenge = !card || card.frozen || (amountUsd ?? 0) >= 50;
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
    const card = db.cards.find((c) => c.id === cardId);
    if (!card) {
      return NextResponse.json({ jit_funding: { approved: false, reason: "unknown card" } });
    }
    const decision = evaluateSpend({ card, amountUsd, mcc });
    if (decision.approved) card.limits.dailySpent += amountUsd;

    recordTransaction(
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

    return NextResponse.json({
      jit_funding: { approved: decision.approved, amount: amountUsd },
      decision,
    });
  }

  return NextResponse.json({ received: true, type: event.type });
}
