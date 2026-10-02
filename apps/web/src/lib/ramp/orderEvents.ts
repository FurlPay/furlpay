import { recordRampAudit } from "./rampAudit";
import type { RampOrder } from "./rampOrder";

// ---------------------------------------------------------------------------
// One place that hears "a ramp order changed state". Webhooks, the stale-order
// sweep and on-chain confirmation all call this after a transition, so every
// listener (audit today; partner callbacks) sees every change exactly once per
// transition, whatever caused it.
// ---------------------------------------------------------------------------

export async function notifyOrderChanged(order: RampOrder): Promise<void> {
  const last = order.statusHistory[order.statusHistory.length - 1];
  await recordRampAudit({
    userId: order.userId ?? (order.partnerId ? `partner:${order.partnerId}` : "system"),
    action: order.direction === "onramp" ? "onramp.status.changed" : "offramp.status.changed",
    direction: order.direction,
    orderId: order.orderId,
    providerSelected: order.providerId,
    providerRef: order.providerOrderId,
    metadata: { from: last?.from, to: order.status, trigger: last?.trigger },
  });
}
