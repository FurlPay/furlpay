// ---------------------------------------------------------------------------
// Order-ticket vocabulary, shared by the web sheet and the native app.
//
// WHY A SHARED MODULE RATHER THAN LITERALS IN THE COMPONENT. Two clients post to
// the same route, and the strings are the API contract: a mismatch between the
// tabs a user sees and the `type` values the route accepts produces a 400 that
// looks like a bug in the order rather than in the label. Keeping the list and the
// outcome copy in one place also means the honest-status wording below cannot
// drift between web and mobile.
// ---------------------------------------------------------------------------

/** The order types the backend accepts. Mirrors OrderSchema in lib/schemas.ts. */
export type OrderTicketType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

export const ORDER_TICKET_TYPES: { value: OrderTicketType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
  { value: "stop_limit", label: "Stop limit" },
  { value: "trailing_stop", label: "Trailing" },
];

export type OutcomeTone = "filled" | "resting" | "unknown" | "rejected";

export interface OrderOutcomeCopy {
  tone: OutcomeTone;
  title: string;
  detail: (side: "buy" | "sell", amountLabel: string, symbol: string) => string;
}

/**
 * Turn a provider order status into something true to show a person.
 *
 * THE BUG THIS REPLACES. The trade sheet previously set a boolean from a 200 and
 * rendered "Order filled". A 200 from /api/investing/order does not mean filled:
 *
 *   * a limit or stop order rests at the venue and comes back `accepted`/`new` —
 *     nothing has been bought, and saying "filled" invites the user to spend
 *     money they still have;
 *   * a market order can come back `partially_filled`;
 *   * an indeterminate submission returns HTTP 202 with `status: "unknown"` —
 *     the order MAY exist, and the correct advice is to check rather than retry.
 *     Reporting either "filled" or "failed" there is a guess, and both readings
 *     lead the user to do the wrong thing.
 *
 * So the status is mapped rather than assumed, and anything unrecognised is
 * described as submitted-and-unconfirmed instead of being optimistically rounded
 * up to success.
 */
export function describeOrderOutcome(status: string): OrderOutcomeCopy {
  switch (status) {
    case "filled":
      return {
        tone: "filled",
        title: "Order filled",
        detail: (side, amount, symbol) =>
          `${side === "buy" ? "Bought" : "Sold"} ${amount} of ${symbol}.`,
      };
    case "partially_filled":
      return {
        tone: "resting",
        title: "Partially filled",
        detail: (_side, _amount, symbol) =>
          `Part of your ${symbol} order has filled; the rest is still working.`,
      };
    case "accepted":
    case "new":
    case "pending_new":
    case "submitted":
      return {
        tone: "resting",
        title: "Order placed",
        detail: (_side, _amount, symbol) =>
          `Your ${symbol} order is resting at the venue. Nothing has been bought or sold yet — it fills when your price is reached.`,
      };
    case "unknown":
      return {
        tone: "unknown",
        title: "Submitted — not confirmed",
        detail: (_side, _amount, symbol) =>
          `We could not confirm whether the ${symbol} order reached the venue. It may have been accepted. Check its status before placing another.`,
      };
    case "rejected":
      return {
        tone: "rejected",
        title: "Order rejected",
        detail: (_side, _amount, symbol) => `The venue rejected the ${symbol} order. Nothing was bought or sold.`,
      };
    case "canceled":
    case "cancelled":
      return {
        tone: "rejected",
        title: "Order cancelled",
        detail: (_side, _amount, symbol) => `The ${symbol} order was cancelled.`,
      };
    default:
      // Deliberately not "filled". An unrecognised status is an unknown, and the
      // safe reading of an unknown is that the money may not have moved.
      return {
        tone: "unknown",
        title: "Order submitted",
        detail: (_side, _amount, symbol) =>
          `Your ${symbol} order was submitted with status "${status}". Check your orders for the outcome.`,
      };
  }
}
