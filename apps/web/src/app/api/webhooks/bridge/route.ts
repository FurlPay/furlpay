import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { evaluateStablecoin } from "@furlpay/compliance";
import { db, newTx, recordTransaction } from "@/lib/store";
import { markProcessed, resolveVersion } from "@/lib/webhookGuard";

// POST /api/webhooks/bridge — Bridge.xyz stablecoin deposit / payout state changes.
// Verifies the furlpay-signature header before trusting the payload.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.FURLPAY_ENDPOINT_SECRET || "whsec_sandbox_bridge";

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Idempotency: ignore redelivered events (Stripe-style at-least-once delivery).
  const version = resolveVersion(req.headers.get("furlpay-version"));
  if (!markProcessed(event.id)) {
    return NextResponse.json({ received: true, deduped: true, version });
  }

  if (event.type === "deposit.settled") {
    const { token, amountUsd } = event.data;
    // Apply MiCA/GENIUS routing to inbound deposits.
    const policy = evaluateStablecoin(token, db.user.region as any);
    const finalToken = policy.allowed ? token : policy.routedTo!;
    recordTransaction(
      newTx({
        category: "ramp",
        direction: "in",
        title: `Deposit ${finalToken}`,
        subtitle: policy.allowed ? `Bridge · ${token}` : `Bridge · ${policy.reason}`,
        amountUsd,
        token: finalToken,
        status: "settled",
      })
    );
    return NextResponse.json({ received: true, routed: !policy.allowed, policy });
  }

  return NextResponse.json({ received: true, type: event.type });
}
