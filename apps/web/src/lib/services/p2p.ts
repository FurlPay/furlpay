import { randomUUID } from "crypto";
import type { Token } from "@/lib/types";

// ---------------------------------------------------------------------------
// P2P / C2C marketplace — maker-taker crypto↔fiat trading with on-platform
// escrow (RedotPay OTC parity: ads, orders, payment methods, appeals, maker
// applications, ratings).
//
// The trade shape: a MAKER posts an ad ("I sell 500 USDT at ₹91.20, pay me by
// UPI"). A TAKER opens an order against it. The crypto leg is escrowed by the
// platform at order creation; the fiat leg settles off-platform between the two
// parties. The taker marks fiat sent, the maker confirms receipt, escrow
// releases. Nothing here touches fiat rails — FurlPay never sees the fiat.
//
// Why escrow-at-creation rather than escrow-at-payment: the window between "I
// opened the order" and "I sent you money" is exactly when a malicious seller
// would move the coins elsewhere. Locking at creation makes that unrepresentable
// — the seller cannot spend what is already held.
//
// MOCK/in-memory like the other service modules (earn, escrow); the state
// machine and the ownership rules are the parts meant to survive the move to
// Postgres.
// ---------------------------------------------------------------------------

/** Terminal + live states. `released` is the only settling state. */
export type P2POrderStatus =
  | "pending_payment" // escrow locked, taker has not paid fiat yet
  | "paid" // taker marked fiat sent, maker must confirm
  | "released" // maker confirmed, crypto delivered — settled
  | "cancelled" // cancelled before payment, escrow returned
  | "appealed"; // dispute open, escrow frozen pending resolution

export type P2PSide = "buy" | "sell";

/** What the ad's owner does with the crypto: a `sell` ad sells crypto for fiat. */
export interface P2PAd {
  id: string;
  ownerId: string;
  side: P2PSide;
  asset: Token;
  fiat: string; // ISO-4217, "INR" | "EUR" | ...
  /** Fiat per 1 unit of asset. */
  price: number;
  /** Total asset amount offered, and how much is still uncommitted. */
  totalAmount: number;
  availableAmount: number;
  minFiat: number;
  maxFiat: number;
  /** Ids of the owner's own payment methods this ad accepts. */
  paymentMethodIds: string[];
  terms: string;
  /** Minutes the taker has to pay before the order may be auto-cancelled. */
  paymentWindowMins: number;
  status: "active" | "closed";
  createdAt: string;
}

export interface P2POrder {
  id: string;
  /** Human-quotable reference — appeals and support tickets cite this. */
  sn: string;
  adId: string;
  makerId: string;
  takerId: string;
  /** The taker's side. A taker who buys crypto pays fiat. */
  takerSide: P2PSide;
  asset: Token;
  fiat: string;
  price: number;
  amount: number; // asset units
  fiatAmount: number;
  /** Which of the seller's payment methods the buyer must pay into. */
  paymentMethodId: string;
  status: P2POrderStatus;
  createdAt: string;
  /** Payment deadline; past this an unpaid order is cancellable by either side. */
  expiresAt: string;
  paidAt?: string;
  releasedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  appeal?: P2PAppeal;
  /** Set once each side has rated — a second rating from the same side is refused. */
  ratedBy?: string[];
}

export interface P2PAppeal {
  id: string;
  openedBy: string;
  reason: string;
  detail: string;
  evidence: { id: string; url: string; note: string; addedAt: string }[];
  status: "open" | "resolved" | "cancelled";
  openedAt: string;
  resolvedAt?: string;
  /** Who the escrow went to when an operator resolved it. */
  outcome?: "released_to_buyer" | "returned_to_seller";
}

/**
 * A maker's fiat payout rail. `account` is the sensitive part: the counterparty
 * in a live order needs it to pay, but a browsing taker must never be able to
 * harvest account numbers from the ad list — see redactPaymentMethod.
 */
export interface P2PPaymentMethod {
  id: string;
  userId: string;
  type: P2PPaymentMethodType;
  label: string;
  holderName: string;
  account: string;
  /** IFSC / SWIFT / sort code, depending on type. */
  bankCode?: string;
  createdAt: string;
}

export type P2PPaymentMethodType = "bank" | "upi" | "sepa" | "faster_payments" | "paypal" | "wise";

export const P2P_PAYMENT_METHOD_TYPES: { type: P2PPaymentMethodType; label: string; needsBankCode: boolean }[] = [
  { type: "bank", label: "Bank transfer", needsBankCode: true },
  { type: "upi", label: "UPI", needsBankCode: false },
  { type: "sepa", label: "SEPA transfer", needsBankCode: true },
  { type: "faster_payments", label: "Faster Payments", needsBankCode: true },
  { type: "paypal", label: "PayPal", needsBankCode: false },
  { type: "wise", label: "Wise", needsBankCode: false },
];

export interface P2PMerchantProfile {
  userId: string;
  displayName: string;
  status: "none" | "pending" | "approved" | "rejected";
  /** Security deposit posted to become a certified maker, in USD. */
  depositUsd: number;
  appliedAt?: string;
  decidedAt?: string;
  /** Completed-order counters, the basis of the public badge. */
  completedOrders: number;
  ratingSum: number;
  ratingCount: number;
  lastSeenAt?: string;
}

interface P2PState {
  ads: Map<string, P2PAd>;
  orders: Map<string, P2POrder>;
  methods: Map<string, P2PPaymentMethod>;
  merchants: Map<string, P2PMerchantProfile>;
  /** userId → asset → units locked in live orders. */
  escrow: Map<string, Map<Token, number>>;
}

const globalForP2P = globalThis as unknown as { __p2p?: P2PState };
const state: P2PState =
  globalForP2P.__p2p ??
  (globalForP2P.__p2p = {
    ads: new Map(),
    orders: new Map(),
    methods: new Map(),
    merchants: new Map(),
    escrow: new Map(),
  });

export const P2P_APPEAL_REASONS = [
  "paid_not_released",
  "not_paid",
  "wrong_amount",
  "payment_rejected_by_bank",
  "counterparty_unresponsive",
  "other",
] as const;

export const P2P_CANCEL_REASONS = [
  "changed_mind",
  "cannot_pay_in_window",
  "counterparty_unresponsive",
  "wrong_payment_method",
  "other",
] as const;

// --- config -----------------------------------------------------------------

/** Ceilings the routes validate against, exposed so the client shows the same. */
export const P2P_LIMITS = {
  maxAdAmount: 1_000_000,
  maxFiatPerOrder: 1_000_000,
  maxPrice: 10_000_000,
  minPaymentWindowMins: 10,
  maxPaymentWindowMins: 240,
  maxOpenOrdersPerUser: 10,
  maxPaymentMethodsPerUser: 20,
  maxEvidencePerAppeal: 10,
} as const;

export function p2pConfig() {
  return {
    assets: ["USDT", "USDC", "ETH", "SOL"] as Token[],
    fiats: ["INR", "EUR", "GBP", "USD", "SGD", "AED"],
    paymentMethodTypes: P2P_PAYMENT_METHOD_TYPES,
    appealReasons: [...P2P_APPEAL_REASONS],
    cancelReasons: [...P2P_CANCEL_REASONS],
    limits: P2P_LIMITS,
  };
}

// --- redaction --------------------------------------------------------------

/**
 * Ad listings and merchant profiles are public surfaces. The full account
 * number is released only to the counterparty of a LIVE order, and only while
 * it is live — a settled order stops being a reason to see someone's bank
 * details.
 */
export function redactPaymentMethod(m: P2PPaymentMethod) {
  return {
    id: m.id,
    type: m.type,
    label: m.label,
    holderName: maskName(m.holderName),
    accountLast4: m.account.slice(-4),
    createdAt: m.createdAt,
  };
}

export function fullPaymentMethod(m: P2PPaymentMethod) {
  return {
    id: m.id,
    type: m.type,
    label: m.label,
    holderName: m.holderName,
    account: m.account,
    bankCode: m.bankCode,
    createdAt: m.createdAt,
  };
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => (p.length <= 1 ? p : p[0] + "*".repeat(Math.min(p.length - 1, 5)))).join(" ");
}

// --- payment methods --------------------------------------------------------

export function listPaymentMethods(userId: string): P2PPaymentMethod[] {
  return [...state.methods.values()]
    .filter((m) => m.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function savePaymentMethod(
  userId: string,
  input: { type: P2PPaymentMethodType; label: string; holderName: string; account: string; bankCode?: string },
): P2PPaymentMethod {
  if (listPaymentMethods(userId).length >= P2P_LIMITS.maxPaymentMethodsPerUser) {
    throw new Error("Payment method limit reached");
  }
  const spec = P2P_PAYMENT_METHOD_TYPES.find((t) => t.type === input.type);
  if (!spec) throw new Error("Unsupported payment method type");
  if (spec.needsBankCode && !input.bankCode) throw new Error("bankCode is required for this method type");

  // Whitelisted construction — never a spread of client JSON (AGENTS.md #4).
  const m: P2PPaymentMethod = {
    id: "pm_" + randomUUID(),
    userId,
    type: input.type,
    label: input.label,
    holderName: input.holderName,
    account: input.account,
    bankCode: spec.needsBankCode ? input.bankCode : undefined,
    createdAt: new Date().toISOString(),
  };
  state.methods.set(m.id, m);
  return m;
}

export function deletePaymentMethod(userId: string, id: string): void {
  const m = state.methods.get(id);
  if (!m || m.userId !== userId) throw new Error("Payment method not found");
  // A method cited by a live order is the buyer's only instruction for where to
  // send money — deleting it mid-trade would strand them.
  const inUse = [...state.orders.values()].some(
    (o) => o.paymentMethodId === id && (o.status === "pending_payment" || o.status === "paid" || o.status === "appealed"),
  );
  if (inUse) throw new Error("Payment method is in use by a live order");
  state.methods.delete(id);
}

// --- escrow -----------------------------------------------------------------

export function escrowedAmount(userId: string, asset: Token): number {
  return state.escrow.get(userId)?.get(asset) ?? 0;
}

function lockEscrow(userId: string, asset: Token, amount: number): void {
  const byAsset = state.escrow.get(userId) ?? new Map<Token, number>();
  byAsset.set(asset, round8((byAsset.get(asset) ?? 0) + amount));
  state.escrow.set(userId, byAsset);
}

function unlockEscrow(userId: string, asset: Token, amount: number): void {
  const byAsset = state.escrow.get(userId);
  if (!byAsset) return;
  byAsset.set(asset, Math.max(0, round8((byAsset.get(asset) ?? 0) - amount)));
}

// --- ads --------------------------------------------------------------------

export function createAd(
  ownerId: string,
  input: {
    side: P2PSide;
    asset: Token;
    fiat: string;
    price: number;
    totalAmount: number;
    minFiat: number;
    maxFiat: number;
    paymentMethodIds: string[];
    terms?: string;
    paymentWindowMins?: number;
  },
): P2PAd {
  if (input.minFiat > input.maxFiat) throw new Error("minFiat cannot exceed maxFiat");
  const orderCeiling = round2(input.totalAmount * input.price);
  if (input.minFiat > orderCeiling) throw new Error("minFiat exceeds the ad's total value");

  // Every cited payment method must actually belong to the ad's owner —
  // otherwise a maker could point buyers at a stranger's bank account.
  const owned = new Set(listPaymentMethods(ownerId).map((m) => m.id));
  for (const id of input.paymentMethodIds) {
    if (!owned.has(id)) throw new Error("Unknown payment method");
  }
  if (input.paymentMethodIds.length === 0) throw new Error("At least one payment method is required");

  const window = input.paymentWindowMins ?? 30;
  if (window < P2P_LIMITS.minPaymentWindowMins || window > P2P_LIMITS.maxPaymentWindowMins) {
    throw new Error("Payment window out of range");
  }

  const ad: P2PAd = {
    id: "ad_" + randomUUID(),
    ownerId,
    side: input.side,
    asset: input.asset,
    fiat: input.fiat,
    price: input.price,
    totalAmount: input.totalAmount,
    availableAmount: input.totalAmount,
    minFiat: input.minFiat,
    maxFiat: input.maxFiat,
    paymentMethodIds: [...input.paymentMethodIds],
    terms: input.terms ?? "",
    paymentWindowMins: window,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  state.ads.set(ad.id, ad);
  return ad;
}

export function editAd(
  ownerId: string,
  id: string,
  patch: Partial<Pick<P2PAd, "price" | "minFiat" | "maxFiat" | "terms" | "paymentWindowMins">>,
): P2PAd {
  const ad = ownedAd(id, ownerId);
  if (ad.status !== "active") throw new Error("Ad is closed");
  // Whitelisted field-by-field, never Object.assign of client JSON.
  if (patch.price !== undefined) ad.price = patch.price;
  if (patch.minFiat !== undefined) ad.minFiat = patch.minFiat;
  if (patch.maxFiat !== undefined) ad.maxFiat = patch.maxFiat;
  if (patch.terms !== undefined) ad.terms = patch.terms;
  if (patch.paymentWindowMins !== undefined) {
    if (
      patch.paymentWindowMins < P2P_LIMITS.minPaymentWindowMins ||
      patch.paymentWindowMins > P2P_LIMITS.maxPaymentWindowMins
    ) {
      throw new Error("Payment window out of range");
    }
    ad.paymentWindowMins = patch.paymentWindowMins;
  }
  if (ad.minFiat > ad.maxFiat) throw new Error("minFiat cannot exceed maxFiat");
  return ad;
}

export function closeAd(ownerId: string, id: string): P2PAd {
  const ad = ownedAd(id, ownerId);
  // Closing is not cancelling: orders already open against the ad run to
  // completion, the ad just stops accepting new ones.
  ad.status = "closed";
  return ad;
}

function ownedAd(id: string, ownerId: string): P2PAd {
  const ad = state.ads.get(id);
  if (!ad || ad.ownerId !== ownerId) throw new Error("Ad not found");
  return ad;
}

export function getAd(id: string): P2PAd | undefined {
  return state.ads.get(id);
}

export interface AdFilter {
  side?: P2PSide;
  asset?: string;
  fiat?: string;
  /** Only ads whose min/max window admits this fiat amount. */
  fiatAmount?: number;
  paymentMethodType?: P2PPaymentMethodType;
  ownerId?: string;
  includeClosed?: boolean;
}

export function listAds(filter: AdFilter = {}): P2PAd[] {
  const methodTypeById = new Map([...state.methods.values()].map((m) => [m.id, m.type] as const));
  return [...state.ads.values()]
    .filter((ad) => {
      if (!filter.includeClosed && ad.status !== "active") return false;
      if (filter.side && ad.side !== filter.side) return false;
      if (filter.asset && ad.asset !== filter.asset) return false;
      if (filter.fiat && ad.fiat !== filter.fiat) return false;
      if (filter.ownerId && ad.ownerId !== filter.ownerId) return false;
      if (filter.fiatAmount !== undefined) {
        if (filter.fiatAmount < ad.minFiat || filter.fiatAmount > ad.maxFiat) return false;
        if (filter.fiatAmount > round2(ad.availableAmount * ad.price)) return false;
      }
      if (filter.paymentMethodType) {
        const has = ad.paymentMethodIds.some((id) => methodTypeById.get(id) === filter.paymentMethodType);
        if (!has) return false;
      }
      return true;
    })
    // Best price first: a taker buying crypto wants the cheapest ask, a taker
    // selling wants the highest bid.
    .sort((a, b) => (a.side === "sell" ? a.price - b.price : b.price - a.price));
}

/** Public ad shape — joins the maker's badge, never leaks account numbers. */
export function publicAd(ad: P2PAd) {
  const merchant = state.merchants.get(ad.ownerId);
  return {
    id: ad.id,
    side: ad.side,
    asset: ad.asset,
    fiat: ad.fiat,
    price: ad.price,
    availableAmount: ad.availableAmount,
    minFiat: ad.minFiat,
    maxFiat: ad.maxFiat,
    terms: ad.terms,
    paymentWindowMins: ad.paymentWindowMins,
    status: ad.status,
    createdAt: ad.createdAt,
    paymentMethods: ad.paymentMethodIds
      .map((id) => state.methods.get(id))
      .filter((m): m is P2PPaymentMethod => Boolean(m))
      .map((m) => ({ id: m.id, type: m.type, label: m.label })),
    maker: publicMerchant(ad.ownerId, merchant),
  };
}

function publicMerchant(userId: string, m: P2PMerchantProfile | undefined) {
  return {
    id: userId,
    displayName: m?.displayName ?? "FurlPay user",
    certified: m?.status === "approved",
    completedOrders: m?.completedOrders ?? 0,
    rating: m && m.ratingCount > 0 ? round2(m.ratingSum / m.ratingCount) : null,
    ratingCount: m?.ratingCount ?? 0,
    online: isOnline(m),
  };
}

const ONLINE_WINDOW_MS = 5 * 60_000;

function isOnline(m: P2PMerchantProfile | undefined): boolean {
  if (!m?.lastSeenAt) return false;
  return Date.now() - Date.parse(m.lastSeenAt) < ONLINE_WINDOW_MS;
}

// --- quoting ----------------------------------------------------------------

/**
 * Price an intended trade against an ad without committing to it — the
 * "calculate" step, so the taker sees exactly what they will pay before the
 * escrow moves. Exactly one of amount/fiatAmount is supplied.
 */
export function quoteOrder(adId: string, input: { amount?: number; fiatAmount?: number }) {
  const ad = state.ads.get(adId);
  if (!ad || ad.status !== "active") throw new Error("Ad not found");

  const amount = input.amount !== undefined ? input.amount : round8((input.fiatAmount ?? 0) / ad.price);
  const fiatAmount = input.fiatAmount !== undefined ? input.fiatAmount : round2((input.amount ?? 0) * ad.price);

  if (amount <= 0 || fiatAmount <= 0) throw new Error("Amount must be positive");
  if (amount > ad.availableAmount) throw new Error("Amount exceeds the ad's available balance");
  if (fiatAmount < ad.minFiat || fiatAmount > ad.maxFiat) throw new Error("Amount is outside the ad's limits");

  return {
    adId: ad.id,
    asset: ad.asset,
    fiat: ad.fiat,
    price: ad.price,
    amount,
    fiatAmount,
    paymentWindowMins: ad.paymentWindowMins,
    /** The taker's side is the mirror of the ad's. */
    takerSide: (ad.side === "sell" ? "buy" : "sell") as P2PSide,
  };
}

// --- orders -----------------------------------------------------------------

export interface CreateOrderResult {
  order: P2POrder;
  /** Whose crypto to lock, and how much — the caller debits the real balance. */
  escrow: { sellerId: string; asset: Token; amount: number };
}

/**
 * Open an order against an ad. Returns the escrow instruction rather than
 * touching balances itself: the route owns the balance debit so the mock and
 * live paths can differ without the state machine knowing.
 */
export function createOrder(
  takerId: string,
  input: { adId: string; amount?: number; fiatAmount?: number; paymentMethodId?: string },
  opts: {
    /**
     * Debit the seller's real balance into escrow. Called SYNCHRONOUSLY after
     * every validation and BEFORE any state is mutated; if it throws, nothing
     * was created, reserved or locked.
     *
     * WHY IT LIVES HERE. The route used to create the order first and debit
     * after, rolling back with an `await import()` in its catch block when the
     * seller could not fund it. For the length of that await an UNFUNDED order
     * existed, visible and releasable — a release in that window credited the
     * buyer from escrow nobody had paid into. Funding inside the same
     * synchronous step as the state change makes that window zero-width.
     */
    fundEscrow?: (sellerId: string, asset: Token, amount: number) => void;
  } = {},
): CreateOrderResult {
  const ad = state.ads.get(input.adId);
  if (!ad || ad.status !== "active") throw new Error("Ad not found");
  if (ad.ownerId === takerId) throw new Error("Cannot trade against your own ad");

  const openCount = listOrders(takerId).filter(
    (o) => o.status === "pending_payment" || o.status === "paid",
  ).length;
  if (openCount >= P2P_LIMITS.maxOpenOrdersPerUser) throw new Error("Too many open orders");

  const q = quoteOrder(ad.id, { amount: input.amount, fiatAmount: input.fiatAmount });

  // The buyer pays into one of the SELLER's methods. On a `sell` ad the maker
  // is the seller; on a `buy` ad the taker is.
  const sellerId = ad.side === "sell" ? ad.ownerId : takerId;
  const buyerId = sellerId === takerId ? ad.ownerId : takerId;

  const payeeMethods = sellerId === ad.ownerId ? ad.paymentMethodIds : listPaymentMethods(takerId).map((m) => m.id);
  const paymentMethodId = input.paymentMethodId ?? payeeMethods[0];
  if (!paymentMethodId || !payeeMethods.includes(paymentMethodId)) {
    throw new Error("A valid payment method is required");
  }

  // Fund first. A throw here leaves the ad, the order book and escrow untouched.
  opts.fundEscrow?.(sellerId, ad.asset, q.amount);

  const now = Date.now();
  const order: P2POrder = {
    id: "p2p_" + randomUUID(),
    sn: orderSn(now),
    adId: ad.id,
    makerId: ad.ownerId,
    takerId,
    takerSide: q.takerSide,
    asset: ad.asset,
    fiat: ad.fiat,
    price: ad.price,
    amount: q.amount,
    fiatAmount: q.fiatAmount,
    paymentMethodId,
    status: "pending_payment",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ad.paymentWindowMins * 60_000).toISOString(),
    ratedBy: [],
  };

  ad.availableAmount = round8(ad.availableAmount - q.amount);
  state.orders.set(order.id, order);
  lockEscrow(sellerId, ad.asset, q.amount);

  void buyerId; // buyer identity is derivable from the order; kept for clarity
  return { order, escrow: { sellerId, asset: ad.asset, amount: q.amount } };
}

function orderSn(now: number): string {
  const d = new Date(now);
  const stamp =
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  // Random suffix, not a counter: a sequential SN leaks daily order volume.
  return `P2P${stamp}${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function getOrder(id: string, userId: string): P2POrder {
  const o = state.orders.get(id);
  // A party to the order only. An order you are not in is indistinguishable
  // from one that does not exist.
  if (!o || (o.makerId !== userId && o.takerId !== userId)) throw new Error("Order not found");
  return o;
}

export function listOrders(userId: string, status?: P2POrderStatus): P2POrder[] {
  return [...state.orders.values()]
    .filter((o) => o.makerId === userId || o.takerId === userId)
    .filter((o) => !status || o.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Which side of a given order this user is on. */
export function roleInOrder(o: P2POrder, userId: string): "buyer" | "seller" {
  const takerIsBuyer = o.takerSide === "buy";
  if (userId === o.takerId) return takerIsBuyer ? "buyer" : "seller";
  return takerIsBuyer ? "seller" : "buyer";
}

export function sellerOf(o: P2POrder): string {
  return roleInOrder(o, o.takerId) === "seller" ? o.takerId : o.makerId;
}

export function buyerOf(o: P2POrder): string {
  return sellerOf(o) === o.takerId ? o.makerId : o.takerId;
}

/** Buyer declares the fiat sent. Only the buyer, only while pending. */
export function markPaid(orderId: string, userId: string): P2POrder {
  const o = getOrder(orderId, userId);
  if (roleInOrder(o, userId) !== "buyer") throw new Error("Only the buyer can confirm payment");
  if (o.status !== "pending_payment") throw new Error(`Order is ${o.status}`);
  // After the window the seller may reclaim the escrow (cancelOrder). A buyer
  // declaring payment then would race that reclaim for the same coins.
  if (Date.now() > Date.parse(o.expiresAt)) throw new Error("Payment window expired");
  o.status = "paid";
  o.paidAt = new Date().toISOString();
  return o;
}

export interface ReleaseResult {
  order: P2POrder;
  /** The crypto leg the caller must settle: seller → buyer. */
  settlement: { sellerId: string; buyerId: string; asset: Token; amount: number };
}

/** Seller confirms fiat received and releases escrow. */
export function releaseOrder(orderId: string, userId: string): ReleaseResult {
  const o = getOrder(orderId, userId);
  if (roleInOrder(o, userId) !== "seller") throw new Error("Only the seller can release");
  // Releasing before the buyer marks paid is allowed (the seller may have seen
  // the money land first) but an appealed order is frozen for the operator.
  if (o.status !== "paid" && o.status !== "pending_payment") throw new Error(`Order is ${o.status}`);

  const seller = sellerOf(o);
  const buyer = buyerOf(o);
  o.status = "released";
  o.releasedAt = new Date().toISOString();
  unlockEscrow(seller, o.asset, o.amount);
  creditCompletion(o.makerId);
  creditCompletion(o.takerId);

  return { order: o, settlement: { sellerId: seller, buyerId: buyer, asset: o.asset, amount: o.amount } };
}

export interface CancelResult {
  order: P2POrder;
  /** Escrow to hand back to the seller. */
  refund: { sellerId: string; asset: Token; amount: number };
}

export function cancelOrder(orderId: string, userId: string, reason: string): CancelResult {
  const o = getOrder(orderId, userId);
  if (o.status === "released" || o.status === "cancelled") throw new Error(`Order is ${o.status}`);
  if (o.status === "appealed") throw new Error("Order is under appeal");
  // Once the buyer says they paid, only an appeal can unwind it — a seller who
  // could unilaterally cancel a paid order would simply keep the fiat.
  if (o.status === "paid" && roleInOrder(o, userId) === "seller") {
    throw new Error("Cannot cancel a paid order — open an appeal instead");
  }
  // Nor an UNPAID one while the buyer's window is open. The buyer may already
  // have sent fiat and not yet tapped "paid"; a seller who could cancel then
  // would keep both the fiat and the returned escrow. Only the buyer may cancel
  // inside the window; the seller may reclaim once it has expired.
  if (
    o.status === "pending_payment" &&
    roleInOrder(o, userId) === "seller" &&
    Date.now() <= Date.parse(o.expiresAt)
  ) {
    throw new Error("The buyer's payment window is still open");
  }

  const seller = sellerOf(o);
  o.status = "cancelled";
  o.cancelledAt = new Date().toISOString();
  o.cancelReason = reason;
  unlockEscrow(seller, o.asset, o.amount);

  // Return the unsold amount to the ad so the maker's inventory is not burned.
  const ad = state.ads.get(o.adId);
  if (ad) ad.availableAmount = round8(ad.availableAmount + o.amount);

  return { order: o, refund: { sellerId: seller, asset: o.asset, amount: o.amount } };
}

export function openAppeal(
  orderId: string,
  userId: string,
  input: { reason: string; detail: string },
): P2POrder {
  const o = getOrder(orderId, userId);
  if (o.status !== "pending_payment" && o.status !== "paid") throw new Error(`Order is ${o.status}`);
  o.appeal = {
    id: "apl_" + randomUUID(),
    openedBy: userId,
    reason: input.reason,
    detail: input.detail,
    evidence: [],
    status: "open",
    openedAt: new Date().toISOString(),
  };
  o.status = "appealed";
  return o;
}

export function addAppealEvidence(
  orderId: string,
  userId: string,
  input: { url: string; note?: string },
): P2POrder {
  const o = getOrder(orderId, userId);
  if (!o.appeal || o.appeal.status !== "open") throw new Error("No open appeal");
  if (o.appeal.evidence.length >= P2P_LIMITS.maxEvidencePerAppeal) throw new Error("Evidence limit reached");
  o.appeal.evidence.push({
    id: "ev_" + randomUUID(),
    url: input.url,
    note: input.note ?? "",
    addedAt: new Date().toISOString(),
  });
  return o;
}

/** Only the party who opened it may withdraw an appeal. */
export function cancelAppeal(orderId: string, userId: string): P2POrder {
  const o = getOrder(orderId, userId);
  if (!o.appeal || o.appeal.status !== "open") throw new Error("No open appeal");
  if (o.appeal.openedBy !== userId) throw new Error("Only the party who opened the appeal can withdraw it");
  o.appeal.status = "cancelled";
  o.appeal.resolvedAt = new Date().toISOString();
  // Back to where it was: paid if the buyer had declared payment.
  o.status = o.paidAt ? "paid" : "pending_payment";
  return o;
}

// --- ratings ----------------------------------------------------------------

export function rateCounterparty(orderId: string, userId: string, stars: number, comment: string): P2POrder {
  const o = getOrder(orderId, userId);
  if (o.status !== "released") throw new Error("Only a completed order can be rated");
  o.ratedBy = o.ratedBy ?? [];
  if (o.ratedBy.includes(userId)) throw new Error("Already rated");
  const other = userId === o.makerId ? o.takerId : o.makerId;
  const m = ensureMerchant(other);
  m.ratingSum += stars;
  m.ratingCount += 1;
  o.ratedBy.push(userId);
  void comment; // stored with the order in the durable backend; not surfaced yet
  return o;
}

export const P2P_QUICK_COMMENTS = [
  "Fast release",
  "Good communication",
  "Patient and helpful",
  "Smooth trade",
  "Slow to respond",
];

// --- merchants --------------------------------------------------------------

function ensureMerchant(userId: string): P2PMerchantProfile {
  let m = state.merchants.get(userId);
  if (!m) {
    m = {
      userId,
      displayName: "FurlPay user",
      status: "none",
      depositUsd: 0,
      completedOrders: 0,
      ratingSum: 0,
      ratingCount: 0,
    };
    state.merchants.set(userId, m);
  }
  return m;
}

function creditCompletion(userId: string): void {
  ensureMerchant(userId).completedOrders += 1;
}

export function getMerchant(userId: string): P2PMerchantProfile {
  return ensureMerchant(userId);
}

/** Public view of any user's maker profile — no counters that aren't public. */
export function merchantProfile(userId: string) {
  return publicMerchant(userId, state.merchants.get(userId));
}

export interface MakerEligibility {
  eligible: boolean;
  reasons: string[];
  requiredDepositUsd: number;
}

const MAKER_MIN_COMPLETED = 5;
const MAKER_DEPOSIT_USD = 500;

export function makerEligibility(userId: string, kycVerified: boolean): MakerEligibility {
  const m = ensureMerchant(userId);
  const reasons: string[] = [];
  if (!kycVerified) reasons.push("kyc_required");
  if (m.completedOrders < MAKER_MIN_COMPLETED) reasons.push("insufficient_completed_orders");
  if (m.status === "approved") reasons.push("already_approved");
  if (m.status === "pending") reasons.push("application_pending");
  return { eligible: reasons.length === 0, reasons, requiredDepositUsd: MAKER_DEPOSIT_USD };
}

export function applyAsMaker(userId: string, displayName: string, depositUsd: number): P2PMerchantProfile {
  const m = ensureMerchant(userId);
  if (m.status === "approved") throw new Error("Already a certified maker");
  if (m.status === "pending") throw new Error("Application already pending");
  if (depositUsd < MAKER_DEPOSIT_USD) throw new Error("Deposit below the required minimum");
  m.displayName = displayName;
  m.depositUsd = depositUsd;
  m.status = "pending";
  m.appliedAt = new Date().toISOString();
  return m;
}

export function reportOnline(userId: string): void {
  ensureMerchant(userId).lastSeenAt = new Date().toISOString();
}

// --- stats ------------------------------------------------------------------

export function orderStats(userId: string) {
  const all = listOrders(userId);
  const done = all.filter((o) => o.status === "released").length;
  const m = ensureMerchant(userId);
  return {
    total: all.length,
    open: all.filter((o) => o.status === "pending_payment" || o.status === "paid").length,
    completed: done,
    cancelled: all.filter((o) => o.status === "cancelled").length,
    appealed: all.filter((o) => o.status === "appealed").length,
    completionRate: all.length > 0 ? round2((done / all.length) * 100) : null,
    rating: m.ratingCount > 0 ? round2(m.ratingSum / m.ratingCount) : null,
  };
}

/** Test seam — the in-memory maps are process-global otherwise. */
export function __resetP2PForTests(): void {
  state.ads.clear();
  state.orders.clear();
  state.methods.clear();
  state.merchants.clear();
  state.escrow.clear();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
