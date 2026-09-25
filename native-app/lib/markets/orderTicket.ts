// ---------------------------------------------------------------------------
// Order-ticket vocabulary for the native app.
//
// DUPLICATED FROM apps/web/src/lib/markets/orderTicket.ts, deliberately. This app
// shares no code with the server — the same reason lib/evm hand-rolls RLP and
// EIP-1559 — so the alternative is an import that does not resolve.
//
// What matters is that the STRINGS match, because they are the API contract: the
// route's OrderSchema accepts exactly these `type` values, and a mismatch between
// a tab label and the value posted produces a 400 that reads as a broken order
// rather than a broken label. The web copy has a test parsing every entry through
// OrderSchema; this copy is pinned by lib/__tests__/orderTicket.test.ts.
// ---------------------------------------------------------------------------

export type OrderTicketType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

export const ORDER_TICKET_TYPES: { value: OrderTicketType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
  { value: "stop_limit", label: "Stop limit" },
  { value: "trailing_stop", label: "Trailing" },
];

export type OutcomeTone = "filled" | "resting" | "unknown" | "rejected";

/**
 * Turn a provider order status into a sentence that is true.
 *
 * This screen was already better than the web sheet — it distinguished `filled`
 * from `Placed` rather than announcing a fill for everything. What it could not do
 * is tell a RESTING order from an UNCONFIRMED one: both read as "Placed", and
 * those need opposite actions from the user. A resting limit order is working as
 * intended and should be left alone; an unconfirmed submission needs checking
 * before another order is placed, or the position may double.
 */
export function describeOrderOutcome(status: string): { tone: OutcomeTone; title: string; detail: string } {
  switch (status) {
    case "filled":
      return { tone: "filled", title: "Filled", detail: "The order executed." };
    case "partially_filled":
      return {
        tone: "resting",
        title: "Partially filled",
        detail: "Part of the order filled; the rest is still working.",
      };
    case "accepted":
    case "new":
    case "pending_new":
    case "submitted":
      return {
        tone: "resting",
        title: "Resting at the venue",
        detail: "Nothing bought or sold yet — it fills when your price is reached.",
      };
    case "unknown":
      return {
        tone: "unknown",
        title: "Submitted — not confirmed",
        detail: "We could not confirm it reached the venue. Check before placing another.",
      };
    case "rejected":
      return { tone: "rejected", title: "Rejected", detail: "The venue rejected it. Nothing moved." };
    case "canceled":
    case "cancelled":
      return { tone: "rejected", title: "Cancelled", detail: "The order was cancelled." };
    default:
      // Never "filled". An unrecognised status is an unknown, and the safe
      // reading of an unknown is that the money may not have moved.
      return {
        tone: "unknown",
        title: "Submitted",
        detail: `Status "${status}". Check your orders for the outcome.`,
      };
  }
}
