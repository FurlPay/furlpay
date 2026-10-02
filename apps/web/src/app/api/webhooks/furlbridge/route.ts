import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { kvDel, kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { verifyFurlBridgeWebhook, WebhookSignatureError } from "@/lib/ramp/webhookVerify";
import { recordRampAudit } from "@/lib/ramp/rampAudit";
import { TransitionError, canTransition } from "@/lib/money/lifecycle";
import {
  getRampOrder,
  getRampOrderByProviderRef,
  recordProviderStatus,
  setProviderOrderId,
  updateRampOrderStatus,
  type RampOrder,
} from "@/lib/ramp/rampOrder";
import { furlbridgePath, remainingSteps } from "@/lib/ramp/furlbridgeStatus";
import { confirmDeliveryOnChain } from "@/lib/ramp/deliveryProof";
import { notifyOrderChanged } from "@/lib/ramp/orderEvents";

export const dynamic = "force-dynamic";

// POST /api/webhooks/furlbridge — order events from FurlBridge (Transak).
//
// 1. Verify: Transak's documented HS256 JWT in the body's `data` field, keyed
//    with the Partner Access Token (lib/ramp/webhookVerify.ts). 401 if not.
// 2. De-duplicate on (order, event, status) in two stages: a short "processing"
//    claim (2 min) while working, replaced by a 90-day "done" marker only after
//    success. A crash mid-processing therefore cannot leave a claim that
//    swallows every retry; a retry that lands while another delivery is still
//    working gets 503 (retry later), not a false "duplicate".
// 3. Find the order: by Transak's order id, else by `partnerOrderId` (our
//    orderId, set in the widget URL) on the first event — then index it.
//    Unknown order → 200 and an audit line: it may belong to another
//    environment, and a retry would not make it ours.
// 4. Walk the hosted_checkout states the status implies (furlbridgeStatus.ts).
//    Every step is checked by the FSM with its evidence; nothing reaches
//    COMPLETED without FurlPay's own on-chain check (deliveryProof.ts).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "webhook.furlbridge", { limit: 100, windowMs: 60_000 });
  if (limited) return limited;

  const rawBody = await req.text();
  if (rawBody.length > 100_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let event;
  try {
    event = verifyFurlBridgeWebhook(rawBody);
  } catch (e) {
    const msg = e instanceof WebhookSignatureError ? e.message : "verification error";
    await recordRampAudit({ userId: "system", action: "webhook.rejected", direction: "onramp", error: msg });
    return NextResponse.json({ error: "signature_invalid" }, { status: 401 });
  }

  const claimKey = `ramp:webhook:furlbridge:${event.dedupeKey}`;
  if (!(await kvSetNx(claimKey, "processing", 120))) {
    const state = await kvGet<string>(claimKey);
    if (state === "processing") {
      return NextResponse.json({ error: "in_progress" }, { status: 503, headers: { "retry-after": "30" } });
    }
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    let order: RampOrder | null = await getRampOrderByProviderRef("furlbridge", event.orderId);
    if (!order && event.partnerOrderId) {
      const candidate = await getRampOrder(event.partnerOrderId);
      if (candidate && candidate.providerId === "furlbridge") {
        order = await setProviderOrderId(candidate.orderId, event.orderId);
      }
    }

    const direction = event.webhookData.isBuyOrSell === "SELL" ? "offramp" : "onramp";
    await recordRampAudit({
      userId: order?.userId ?? (order?.partnerId ? `partner:${order.partnerId}` : "system"),
      action: "webhook.received",
      direction,
      orderId: order?.orderId ?? event.partnerOrderId,
      providerRef: event.orderId,
      providerSelected: "furlbridge",
      metadata: { eventType: event.eventType, status: event.status, matched: !!order },
    });

    if (!order) {
      await kvSet(claimKey, "done", 90 * 24 * 3600);
      console.warn(`[webhook/furlbridge] no order for ${event.orderId}; acknowledged without effect`);
      return NextResponse.json({ received: true, matched: false });
    }

    const before = order.status;
    const cryptoAmount =
      typeof event.webhookData.cryptoAmount === "number" || typeof event.webhookData.cryptoAmount === "string"
        ? String(event.webhookData.cryptoAmount)
        : undefined;

    const path = furlbridgePath(event.status);
    let moved = false;
    // A late event for an abandoned order: route it to a person first, then
    // walk whatever the event still justifies from MANUAL_REVIEW.
    if (order.status === "ABANDONED" && path.some((s) => s !== "FAILED" && s !== "CANCELLED")) {
      order = await updateRampOrderStatus(order.orderId, {
        to: "MANUAL_REVIEW",
        trigger: "webhook",
        providerStatus: event.status,
        evidence: `Late provider event after abandonment: Transak ${event.eventType} (${event.status})`,
      });
      moved = true;
    }
    for (const to of remainingSteps(order.status, path)) {
      // A step the current state cannot take is skipped, not fatal: from
      // MANUAL_REVIEW the path's PAYMENT_PENDING is behind us. The FSM still
      // checks every step that IS taken, with its evidence.
      if (!canTransition(order.flowKind, order.status, to)) continue;
      try {
        order = await updateRampOrderStatus(order.orderId, {
          to,
          trigger: "webhook",
          providerStatus: event.status,
          evidence: `Transak ${event.eventType} (${event.status})`,
          refs: { providerRef: event.orderId, chainTxHash: event.transactionHash },
          txHash: event.transactionHash,
          cryptoAmount,
        });
        moved = true;
      } catch (e) {
        // Missing evidence (e.g. COMPLETED without a tx hash) stops the walk
        // where the evidence runs out. That is the FSM working, not an error.
        if (e instanceof TransitionError) break;
        throw e;
      }
    }
    if (!moved) order = await recordProviderStatus(order.orderId, event.status);

    if (order.status === "CRYPTO_PENDING") {
      const check = await confirmDeliveryOnChain(order.orderId);
      if (check.status === "confirmed" || check.status === "mismatch") order = check.order;
    }

    if (order.status !== before) await notifyOrderChanged(order);
    // Done: the 90-day marker outlives any provider retry schedule.
    await kvSet(claimKey, "done", 90 * 24 * 3600);
    return NextResponse.json({ received: true, status: order.status });
  } catch (e) {
    // Release the claim so the provider's retry is processed.
    await kvDel(claimKey).catch(() => {});
    console.error("[webhook/furlbridge] processing failed:", (e as Error).message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
