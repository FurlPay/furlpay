import type { TxState } from "@/lib/money/lifecycle";

// ---------------------------------------------------------------------------
// FurlBridge (Transak) order status → the FurlPay states it justifies.
//
// Transak statuses (docs.transak.com, order status tracking):
//   AWAITING_PAYMENT_FROM_USER, PAYMENT_DONE_MARKED_BY_USER, PROCESSING,
//   PENDING_DELIVERY_FROM_TRANSAK, ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK,
//   COMPLETED, CANCELLED, FAILED, REFUNDED, EXPIRED
//
// Each maps to the PATH of hosted_checkout states it implies, because webhooks
// can be skipped or arrive out of order: an order still at PAYMENT_PENDING
// that receives COMPLETED walks PAYMENT_CONFIRMED → CRYPTO_PENDING, each step
// checked by the FSM with its evidence.
//
// DELIBERATELY CONSERVATIVE:
//   - PAYMENT_DONE_MARKED_BY_USER is the user's claim, PROCESSING is ambiguous
//     about whether funds arrived: both are recorded, neither moves state.
//   - COMPLETED goes no further than CRYPTO_PENDING. "Delivered" is Transak's
//     statement; CRYPTO_CONFIRMED is set only after FurlPay verifies the
//     delivery tx on-chain (lib/ramp/deliveryProof.ts).
//   - REFUNDED is a provider-side refund with no FurlPay ledger leg: it goes to
//     MANUAL_REVIEW so a person reconciles it, never to a FurlPay REFUNDED.
//   - An unknown status is recorded and moves nothing.
// ---------------------------------------------------------------------------

export function furlbridgePath(providerStatus: string): readonly TxState[] {
  switch (providerStatus.toUpperCase()) {
    case "AWAITING_PAYMENT_FROM_USER":
      return ["PAYMENT_PENDING"];
    case "PENDING_DELIVERY_FROM_TRANSAK":
      return ["PAYMENT_PENDING", "PAYMENT_CONFIRMED"];
    case "ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK":
      return ["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "COMPLIANCE_REVIEW"];
    case "COMPLETED":
      return ["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "CRYPTO_PENDING"];
    case "CANCELLED":
      return ["CANCELLED"];
    case "FAILED":
    case "EXPIRED":
      return ["FAILED"];
    case "REFUNDED":
      return ["MANUAL_REVIEW"];
    default:
      return [];
  }
}

/**
 * The steps still to take from `current` along `path`. Steps at or before the
 * current state are already done (redelivery or an out-of-order older event)
 * and are dropped, so a stale "AWAITING_PAYMENT" never moves an order back.
 */
export function remainingSteps(current: TxState, path: readonly TxState[]): TxState[] {
  const at = path.indexOf(current);
  return at === -1 ? [...path] : path.slice(at + 1);
}
