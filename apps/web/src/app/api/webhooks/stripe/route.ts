import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { getAccountDurable, newTx, recordTransaction, setSubscriptionTier, getDevelopmentDemoAccount } from "@/lib/store";
import { TIER_BY_PLAN } from "@/lib/entitlements";
import { recordMovement } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

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

  // Idempotency: Stripe delivers at-least-once. Claim the id, process, and
  // only mark processed on success — a failed handler releases the id and
  // returns 5xx so Stripe's redelivery is retried instead of lost.
  if (!(await tryBegin(event.id))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      // Credit the account named in the PaymentIntent's metadata. Checkout
      // sets metadata.furlpayUserId when creating the intent; an unmatched
      // event is acknowledged but NOT credited (crediting the demo account
      // for a stranger's payment would corrupt balances).
      const userId = (pi.metadata?.furlpayUserId as string) || "";
      const target =
        (await getAccountDurable(userId)) ??
        getDevelopmentDemoAccount();
      const amountUsd = (pi.amount_received ?? pi.amount) / 100;

      if (target) {
        recordMovement("in", amountUsd, `Stripe payment ${pi.id}`, target.user.id);
        recordTransaction(
          target.user.id,
          newTx({
            category: "ramp",
            direction: "in",
            title: "Stablecoin payment",
            subtitle: `Stripe · ${pi.id}`,
            amountUsd,
            token: "USDC",
            status: "settled",
          })
        );
        audit("webhook.processed", target.user.id, { provider: "stripe", event: event.type, pi: pi.id });
      } else {
        log.warn("stripe payment_intent.succeeded without resolvable user", { pi: pi.id, userId });
      }
    }

    // Subscription lifecycle (extension Pro/Developer plans — playbook §4).
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const userId = (session.metadata?.furlpayUserId as string) || "";
        const plan = (session.metadata?.plan as string) || "";
        const tier = TIER_BY_PLAN[plan];
        if ((await getAccountDurable(userId)) && tier) {
          setSubscriptionTier(userId, tier);
          audit("billing.subscription_started", userId, { plan, session: session.id });
        } else {
          log.warn("stripe subscription checkout without resolvable user/plan", {
            session: session.id,
            userId,
            plan,
          });
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = (sub.metadata?.furlpayUserId as string) || "";
      if (await getAccountDurable(userId)) {
        setSubscriptionTier(userId, "Standard");
        audit("billing.subscription_ended", userId, { subscription: sub.id });
      }
    }

    await markProcessed(event.id);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    await markFailed(event.id);
    audit("webhook.failed", "system", { provider: "stripe", event: event.type, error: (e as Error).message });
    log.error("stripe webhook handler failed", { event: event.type, error: (e as Error).message });
    // 5xx → Stripe redelivers; the released id lets the retry process it.
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
