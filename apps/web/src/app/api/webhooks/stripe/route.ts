import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { getAccountDurable, newTx, recordTransaction, setSubscriptionTier, getDevelopmentDemoAccount } from "@/lib/store";
import { TIER_BY_PLAN } from "@/lib/entitlements";
import { recordMovement } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { recordRevenue, minor } from "@/lib/revenue/record";
import { withDurableWebhook } from "@/lib/withDurableWebhook";
import { applyStripeDispute, applyStripeRefund, type StripeDisputeLike, type StripeRefundLike } from "@/lib/payments/stripeReversals";

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

  // Durable dedupe (migration 0022) wraps the existing KV guard + effects as an
  // ADDITIONAL layer, engaging only where the Postgres store is provisioned
  // (prod/staging); in dev/test it bypasses and the KV path below is unchanged.
  // Signature verification stays ABOVE this — it is Stripe-specific.
  try {
    return await withDurableWebhook<NextResponse>({
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      rawBody: payload,
      onDuplicate: () => NextResponse.json({ received: true, deduped: true }),
      onMismatch: () => {
        audit("webhook.payload_mismatch", "system", { provider: "stripe", event: event.type });
        return NextResponse.json({ error: "payload_mismatch" }, { status: 400 });
      },
      onUnavailable: () => NextResponse.json({ error: "webhook_store_unavailable" }, { status: 503 }),
      handler: async () => {
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
      // NOTE: this is a customer FUNDING their account. It is pass-through
      // volume, not FurlPay revenue, and is deliberately NOT recorded as a
      // revenue event — booking a $10,000 deposit as $10,000 of income is the
      // exact mistake lib/revenue exists to make unrepresentable. When we
      // start charging a ramp fee, record THAT fee here, never this amount.
      const userId = (pi.metadata?.furlpayUserId as string) || "";
      const target =
        (await getAccountDurable(userId)) ??
        getDevelopmentDemoAccount();
      const amountUsd = (pi.amount_received ?? pi.amount) / 100;

      // The amount is minor units OF THE PI'S CURRENCY. Crediting a EUR or INR
      // intent as if its minor units were US cents would book the wrong sum,
      // so anything but USD is acknowledged and left for manual handling.
      const currency = String(pi.currency ?? "").toLowerCase();
      if (target && currency !== "usd") {
        log.error("stripe payment_intent.succeeded in unsupported currency — not credited", { pi: pi.id, currency });
        audit("webhook.unsupported_currency", target.user.id, { provider: "stripe", pi: pi.id, currency });
      } else if (target) {
        // EXACTLY ONCE (audit P0-1). The effect key is the PaymentIntent — the
        // business fact — not the event id: Stripe can deliver the same PI
        // success under more than one event, and a redelivery after a failed
        // acknowledgement must not post again. The webhook row is marked
        // processed in the SAME transaction as the posting (migration 0025).
        const movement = await recordMovement("in", amountUsd, `Stripe payment ${pi.id}`, target.user.id, {
          effectKey: `stripe:pi:${pi.id}`,
          webhook: { provider: "stripe", eventId: event.id },
        });
        if (movement.applied) recordTransaction(
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

          // Revenue. This is one of the few genuinely REALIZED fees FurlPay
          // earns today: Stripe has taken the customer's money and told us so
          // over a signature-verified webhook, so the evidence is real and the
          // amount is Stripe's own, not something recomputed here.
          //
          // `amount_total` is already in minor units (cents), so no float is
          // involved. There is NO volume: a flat subscription charge is not a
          // take on an underlying flow, and giving it one would corrupt the
          // take-rate denominator for every other engine.
          //
          // Keyed on the session id, so Stripe's at-least-once delivery cannot
          // book the same subscription twice even if the outer webhook guard
          // is bypassed on a redelivery after a crash.
          const amountMinor = session.amount_total;
          const currency = (session.currency ?? "usd").toUpperCase();
          if (amountMinor != null && amountMinor > 0) {
            await recordRevenue({
              source: "subscription_charge",
              status: "realized",
              externalRef: session.id,
              fee: minor(amountMinor, currency),
              userId,
              metadata: { plan, tier, mode: "subscription" },
            }).catch((e) =>
              // Never fail the webhook over reporting: the subscription is
              // already active and Stripe must not be told to retry.
              log.error("subscription revenue not recorded", {
                session: session.id,
                error: (e as Error).message,
              }),
            );
          }
        } else {
          log.warn("stripe subscription checkout without resolvable user/plan", {
            session: session.id,
            userId,
            plan,
          });
        }
      }
    }

    // Refunds and chargebacks (audit P2-7): each is its own balanced, keyed
    // ledger transaction — see lib/payments/stripeReversals.ts. The customer is
    // resolved from the PaymentIntent's own metadata, never from the event body.
    const ack = { provider: "stripe", eventId: event.id };
    const resolveUser = async (piId: string) => {
      const pi = await getStripe().paymentIntents.retrieve(piId);
      const uid = (pi.metadata?.furlpayUserId as string) || "";
      return uid && (await getAccountDurable(uid)) ? uid : null;
    };
    if (event.type === "refund.created" || event.type === "refund.updated") {
      const r = await applyStripeRefund(event.data.object as unknown as StripeRefundLike, resolveUser, ack);
      if (r.reason) log.warn("stripe refund not posted", { event: event.type, reason: r.reason });
    }
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      for (const refund of charge.refunds?.data ?? []) {
        const r = await applyStripeRefund(
          { ...(refund as unknown as StripeRefundLike), payment_intent: refund.payment_intent ?? charge.payment_intent },
          resolveUser,
          ack
        );
        if (r.reason) log.warn("stripe refund not posted", { event: event.type, reason: r.reason });
      }
    }
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      const r = await applyStripeDispute(
        event.data.object as unknown as StripeDisputeLike,
        event.type === "charge.dispute.created" ? "opened" : "closed",
        resolveUser,
        ack
      );
      if (r.reason) log.warn("stripe dispute not posted", { event: event.type, reason: r.reason });
      else audit("webhook.processed", "system", { provider: "stripe", event: event.type });
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
    // Throw so the durable layer marks the event failed and releases it; the
    // outer catch renders the retryable 500 Stripe expects.
    throw e;
  }
      },
    });
  } catch {
    // 5xx → Stripe redelivers; both the KV id and the durable row are released.
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
