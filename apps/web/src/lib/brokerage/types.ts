// ---------------------------------------------------------------------------
// The brokerage port.
//
// Alpaca is currently the only adapter, but the interface is written against
// what a BROKERAGE does rather than what Alpaca returns, because the coupling
// that actually hurts is not the HTTP client — it is a hundred call sites that
// have learned Alpaca's field names and status vocabulary. Replacing a provider
// then means editing every one of them.
//
// Two decisions in here carry most of the safety:
//
// 1. ORDER STATUS IS A CLOSED SET WITH ONE MEANING PER MEMBER. Providers
//    disagree about vocabulary — Alpaca alone emits `new`, `pending_new`,
//    `accepted`, `partially_filled`, `done_for_day`, `replaced`, `calculated`
//    and more. Passing those through means every reader re-derives "is this
//    order finished?" and one of them gets it wrong. The adapter maps into this
//    set, and anything it cannot map becomes `unknown` rather than a guess.
//
// 2. EVERY QUANTITY IS AUTHORITATIVE OR ABSENT. `filledQty` is what the
//    provider says was filled; there is no default of zero, because "not
//    reported yet" and "filled nothing" produce different accounting. The
//    ledger may only be moved by a number the provider stated.
// ---------------------------------------------------------------------------

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok" | "opg" | "cls";

/**
 * The canonical order lifecycle.
 *
 * TERMINAL states are the ones after which no further fills can arrive. That
 * distinction is not cosmetic: the reconciler treats a terminal order as
 * settled and stops chasing it, so mis-classifying `pending_cancel` as terminal
 * would abandon an order that can still fill.
 */
export type OrderStatus =
  | "created" // exists in our database, not yet sent
  | "submitted" // sent to the provider, no acknowledgement yet
  | "accepted" // provider acknowledged
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired"
  | "pending_cancel"
  | "unknown"; // the provider reported a status we do not model — never guessed

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Legal transitions.
 *
 * Enforced rather than documented because out-of-order webhook delivery is
 * normal, not exceptional: a `fill` and an `accepted` for the same order can
 * arrive in either order over separate connections. Without this table the
 * later-arriving `accepted` would walk a filled order backwards and the
 * position would be re-opened by an event that describes the past.
 */
const TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  created: new Set(["submitted", "rejected", "canceled"]),
  submitted: new Set(["accepted", "partially_filled", "filled", "rejected", "canceled", "expired", "unknown"]),
  accepted: new Set(["partially_filled", "filled", "canceled", "pending_cancel", "expired", "rejected", "unknown"]),
  partially_filled: new Set(["partially_filled", "filled", "canceled", "pending_cancel", "expired", "unknown"]),
  pending_cancel: new Set(["canceled", "filled", "partially_filled", "expired", "unknown"]),
  // Terminal states accept nothing. A "transition" out of one is a bug or a
  // replayed event, and both must be visible rather than applied.
  filled: new Set([]),
  canceled: new Set([]),
  rejected: new Set([]),
  expired: new Set([]),
  unknown: new Set(["accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]),
};

/** May an order move from `from` to `to`? */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return to === "partially_filled"; // successive partials are legal
  return TRANSITIONS[from].has(to);
}

export interface BrokerageAccount {
  /** The provider's account identifier. */
  accountId: string;
  status: string;
  /** Cash available to trade right now, including any margin extension. */
  buyingPower: number | null;
  cash: number | null;
  /** Cash that has completed settlement and may be withdrawn. */
  settledCash: number | null;
  currency: string;
  /** Provider-reported restrictions — trading blocked, account frozen, etc. */
  restrictions: string[];
  tradingBlocked: boolean;
  transfersBlocked: boolean;
}

export interface BrokeragePosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPl: number | null;
}

export interface BrokerageOrder {
  /** OUR identifier, echoed to the provider as its client order id. */
  clientOrderId: string;
  /** The PROVIDER's identifier. Absent until it acknowledges. */
  providerOrderId: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  /** Requested size — exactly one of these is set, mirroring the wire contract. */
  qty: number | null;
  notional: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  /** Authoritative fill state. Null means "the provider has not said". */
  filledQty: number | null;
  filledAvgPrice: number | null;
  submittedAt: string | null;
  filledAt: string | null;
  canceledAt: string | null;
  expiredAt: string | null;
  /** Provider's own words when it refuses an order. Shown to the user as-is —
   *  a rewritten rejection reason loses the detail that explains the refusal. */
  rejectReason: string | null;
  /** Untouched provider payload, for reconciliation and dispute resolution. */
  raw?: unknown;
}

export interface PlaceOrderInput {
  /** Ours, and idempotent: re-sending the same one must not create a second
   *  order at the provider. */
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  qty?: number | null;
  notional?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  /**
   * Trailing-stop distance, for `type: "trailing_stop"`. EXACTLY ONE of the two.
   *
   * `trailPercent` trails by a percentage of the high-water mark; `trailPrice`
   * trails by an absolute amount in the quote currency. Alpaca rejects an order
   * carrying both, so the caller has to choose — expressing that as two optional
   * fields rather than a discriminated union keeps this interface flat like the
   * rest of it, and the check lives in the adapter where the rejection would
   * otherwise come back from the provider as an opaque 422.
   *
   * WHAT A TRAILING STOP IS NOT: it is not a guaranteed exit price. The trail
   * moves the TRIGGER; once triggered the order becomes a market order and fills
   * at whatever is available, so a gap can fill far below the trail. Callers that
   * need a price floor want stop_limit, and should understand it may not fill at
   * all.
   */
  trailPercent?: number | null;
  trailPrice?: number | null;
  extendedHours?: boolean;
}

export interface BrokerageQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** When the venue produced this quote. The freshness check reads it, so a
   *  provider that omits it yields null and the quote is treated as unusable
   *  rather than as current. */
  timestamp: string | null;
}

/**
 * A provider failure that the caller must NOT interpret as "no order exists".
 *
 * This is the single most dangerous condition in an order path: a timeout means
 * the request may have been received and executed. Retrying on the assumption
 * that nothing happened is how one tap becomes two orders. Callers must treat
 * this as "state unknown — go and read it back", never as a failure.
 */
export class BrokerageIndeterminateError extends Error {
  readonly clientOrderId: string;
  constructor(clientOrderId: string, message: string) {
    super(message);
    this.name = "BrokerageIndeterminateError";
    this.clientOrderId = clientOrderId;
  }
}

/** A definite provider refusal. Safe to treat as "no order was created". */
export class BrokerageRejectedError extends Error {
  readonly status: number;
  readonly providerCode: string | null;
  constructor(message: string, status: number, providerCode: string | null = null) {
    super(message);
    this.name = "BrokerageRejectedError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

/**
 * The port every brokerage adapter implements.
 *
 * Read methods return null for "not found" and throw for "could not ask" — the
 * distinction matters to the reconciler, which must not delete a local order
 * because the provider was briefly unreachable.
 */
export interface BrokerageProvider {
  /** Identifies the adapter in logs, ledger provenance and the ops console. */
  readonly name: string;
  /** False for any simulator. Read before anything is presented as a real fill. */
  readonly isLive: boolean;

  getAccount(): Promise<BrokerageAccount>;
  getPositions(): Promise<BrokeragePosition[]>;
  getOrders(opts?: { status?: "open" | "closed" | "all"; limit?: number; after?: string }): Promise<BrokerageOrder[]>;
  getOrder(ref: { clientOrderId?: string; providerOrderId?: string }): Promise<BrokerageOrder | null>;
  placeOrder(input: PlaceOrderInput): Promise<BrokerageOrder>;
  cancelOrder(providerOrderId: string): Promise<void>;
  replaceOrder(
    providerOrderId: string,
    patch: { qty?: number; limitPrice?: number; stopPrice?: number; timeInForce?: TimeInForce }
  ): Promise<BrokerageOrder>;
  getQuote(symbol: string): Promise<BrokerageQuote | null>;
}
