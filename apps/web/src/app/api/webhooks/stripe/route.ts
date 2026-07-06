import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { markProcessed } from "@/lib/webhookGuard";
import { newTx, recordTransaction } from "@/lib/store";

// POST /api/webhooks/stripe — Stripe Crypto payment/settlement events.
// Verifies the stripe-signature header via constructEvent (HMAC-SHA256 over the
// raw body) before trusting the payload. Runs on the Node.js runtime so the
// synchronous crypto used by constructEvent is available.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Fail closed: the placeholder fallback is public (in-repo), so verifying
  // against it in production would let anyone forge signed events. Require a
  // real secret in production — mirrors the guard in lib/session.ts.
  if (!secret || secret === "whsec_placeholder") {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }
  }

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // In dev only (production is guarded above) fall back to the placeholder.
    event = getStripe().webhooks.constructEvent(payload, sig, secret || "whsec_placeholder");
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err.message}` },
      { status: 400 }
    );
  }

  // Idempotency: Stripe delivers at-least-once; ignore redeliveries.
  if (!markProcessed(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    // Trigger local bank routing / credit the Furlpay Safe account balance.
    recordTransaction(
      newTx({
        category: "ramp",
        direction: "in",
        title: "Stablecoin payment",
        subtitle: `Stripe · ${pi.id}`,
        amountUsd: (pi.amount_received ?? pi.amount) / 100,
        token: "USDC",
        status: "settled",
      })
    );
  }

  return NextResponse.json({ received: true, type: event.type });
}
