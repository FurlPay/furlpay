import { confirmDeliveryOnChain } from "./deliveryProof";
import { notifyOrderChanged } from "./orderEvents";
import { getRampOrder, updateRampOrderStatus, type RampOrder } from "./rampOrder";

// ---------------------------------------------------------------------------
// Orders stuck in an intermediate state, resolved on access.
//
//   PAYMENT_PENDING  > 30 min  → ABANDONED
//   CRYPTO_PENDING   > 1 h     → re-check on-chain; still unconfirmed → MANUAL_REVIEW
//   PROVIDER_PENDING > 24 h    → MANUAL_REVIEW
//
// ABANDONED, not "EXPIRED" or CANCELLED: the FSM's ABANDONED means "unresolved
// past its deadline and no longer waited on — funds may have moved". For a
// Coinbase checkout that is exactly true: Coinbase sends FurlPay no status, so
// FurlPay cannot know whether the customer paid on Coinbase's page. CANCELLED
// would claim nothing moved. Clients show ABANDONED on a no-feed order as
// "check your provider receipt", never as a failure.
//
// Called from GET /api/ramp/orders/:id (and the list), so no cron is needed;
// every change goes through notifyOrderChanged like any other transition.
// ---------------------------------------------------------------------------

export const STALE_AFTER_MS = {
  PAYMENT_PENDING: 30 * 60_000,
  CRYPTO_PENDING: 60 * 60_000,
  PROVIDER_PENDING: 24 * 60 * 60_000,
} as const;

function age(order: RampOrder, now: number): number {
  return now - Date.parse(order.updatedAt);
}

export async function reconcileStaleOrder(order: RampOrder, now = Date.now()): Promise<RampOrder> {
  let next: RampOrder | null = null;

  if (order.status === "PAYMENT_PENDING" && age(order, now) > STALE_AFTER_MS.PAYMENT_PENDING) {
    next = await updateRampOrderStatus(order.orderId, {
      to: "ABANDONED",
      trigger: "system",
      evidence: order.statusFeed
        ? "No payment reported by the provider within 30 minutes."
        : "No provider status feed; not tracked after 30 minutes. Payment may have completed with the provider.",
    });
  } else if (order.status === "CRYPTO_PENDING" && age(order, now) > STALE_AFTER_MS.CRYPTO_PENDING) {
    const check = await confirmDeliveryOnChain(order.orderId);
    if (check.status === "confirmed" || check.status === "mismatch") {
      next = check.order;
    } else {
      next = await updateRampOrderStatus(order.orderId, {
        to: "MANUAL_REVIEW",
        trigger: "system",
        evidence: `Delivery not confirmed on-chain after 1 hour (${check.detail}).`,
      });
    }
  } else if (order.status === "PROVIDER_PENDING" && age(order, now) > STALE_AFTER_MS.PROVIDER_PENDING) {
    next = await updateRampOrderStatus(order.orderId, {
      to: "MANUAL_REVIEW",
      trigger: "system",
      evidence: "Provider payout unresolved after 24 hours.",
    });
  }

  if (next && next.status !== order.status) {
    await notifyOrderChanged(next);
    return next;
  }
  return (await getRampOrder(order.orderId)) ?? order;
}
