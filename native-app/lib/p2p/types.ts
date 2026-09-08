// ---------------------------------------------------------------------------
// P2P marketplace — the mobile view of the types in
// apps/web/src/lib/services/p2p.ts.
//
// MIRRORS THE REDACTED SHAPES, NOT THE INTERNAL ONES. The server has `P2PAd`
// (with `ownerId` and `paymentMethodIds`) and `publicAd()` (without). What
// crosses the wire to a browsing taker is the second, and this file describes
// exactly that — so a screen cannot reference a field the API does not send and
// then render `undefined` where a maker's identity should be.
//
// The distinction matters most for payment methods. A live order exposes the
// seller's full account details to the buyer who must pay into them; the ad
// list exposes only a type and a label. Modelling both as one type is how an
// account number ends up in a list view.
// ---------------------------------------------------------------------------

export type P2PSide = "buy" | "sell";

export type P2POrderStatus = "pending_payment" | "paid" | "released" | "cancelled" | "appealed";

export type P2PPaymentMethodType = "bank" | "upi" | "sepa" | "faster_payments" | "paypal" | "wise";

/** Payment method as it appears on an AD — type and label only, never an account. */
export interface P2PPublicPaymentMethod {
  id: string;
  type: P2PPaymentMethodType;
  label: string;
}

/**
 * Payment method as it appears inside an ORDER the user is party to.
 *
 * `account` is present here and only here. It is the number the buyer pays
 * into, so the order screen needs it — and it is why `useSecureScreen` is on
 * that screen and why this type is separate from the one above.
 */
export interface P2PFullPaymentMethod extends P2PPublicPaymentMethod {
  holderName: string;
  account: string;
  bankCode?: string;
}

export interface P2PMaker {
  id: string;
  displayName: string;
  /** Approved merchant. Rendered as a badge; never inferred from order count. */
  certified: boolean;
  completedOrders: number;
  /** Null when nobody has rated yet — NOT 0, which reads as "rated badly". */
  rating: number | null;
  ratingCount: number;
  online: boolean;
}

export interface P2PAd {
  id: string;
  side: P2PSide;
  asset: string;
  fiat: string;
  price: number;
  availableAmount: number;
  minFiat: number;
  maxFiat: number;
  terms: string;
  paymentWindowMins: number;
  status: "active" | "closed";
  createdAt: string;
  paymentMethods: P2PPublicPaymentMethod[];
  maker: P2PMaker;
}

export interface P2PAppealEvidence {
  id: string;
  url: string;
  note: string;
  addedAt: string;
}

export interface P2PAppeal {
  id: string;
  openedBy: string;
  reason: string;
  detail: string;
  evidence: P2PAppealEvidence[];
  status: "open" | "resolved" | "cancelled";
  openedAt: string;
  resolvedAt?: string;
  outcome?: "released_to_buyer" | "returned_to_seller";
}

export interface P2POrder {
  id: string;
  /** The reference a user quotes to support. Shown prominently for that reason. */
  sn: string;
  adId: string;
  takerSide: P2PSide;
  asset: string;
  fiat: string;
  price: number;
  amount: number;
  fiatAmount: number;
  status: P2POrderStatus;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  releasedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  appeal?: P2PAppeal;
  ratedBy?: string[];
  /** Which side the CURRENT user is on. Server-derived — never inferred client-side. */
  role: "buyer" | "seller";
  /** Present only for the party who must pay. */
  paymentMethod?: P2PFullPaymentMethod;
}

export interface P2PQuote {
  adId: string;
  asset: string;
  fiat: string;
  price: number;
  amount: number;
  fiatAmount: number;
}

/**
 * Is this order still in play?
 *
 * Used to decide whether to poll. A settled order never changes again, and
 * polling one forever is a battery cost with no possible new information.
 */
export function isOrderLive(status: P2POrderStatus): boolean {
  return status === "pending_payment" || status === "paid" || status === "appealed";
}

/**
 * Whose move is it?
 *
 * The single most important question on the order screen, and the one users get
 * wrong: a buyer who has paid thinks they are waiting on the app when they are
 * waiting on a person. Returning it as data keeps the answer identical
 * everywhere it is shown.
 */
export function whoseTurn(order: P2POrder): "you" | "them" | "nobody" {
  switch (order.status) {
    case "pending_payment":
      return order.role === "buyer" ? "you" : "them";
    case "paid":
      return order.role === "seller" ? "you" : "them";
    case "appealed":
      // An operator holds the escrow. Neither party can move it, and telling
      // either that it is their turn would be false.
      return "nobody";
    default:
      return "nobody";
  }
}

/** Milliseconds until the payment deadline; negative once passed. */
export function timeRemainingMs(order: P2POrder, now: number = Date.now()): number {
  return Date.parse(order.expiresAt) - now;
}
