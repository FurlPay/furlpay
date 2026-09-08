import * as Crypto from "expo-crypto";
import { api } from "@/lib/api";
import { track, bucketUsd } from "@/lib/analytics";
import type { P2PAd, P2POrder, P2PQuote, P2PSide } from "./types";

// ---------------------------------------------------------------------------
// The P2P client.
//
// Thin over /api/p2p, which already holds the escrow, the state machine and
// every authorisation rule. Nothing here decides anything: the client asks and
// renders, and every refusal comes from the server.
//
// THE ONE PIECE OF REAL LOGIC IS IDEMPOTENCY ON ORDER CREATION, and it is not
// optional. Opening an order LOCKS the seller's crypto into escrow. A phone on
// mobile data that times out after the server committed — the single most
// common failure on this path — would, on a naive retry, lock the escrow twice
// against one intent. The server supports `Idempotency-Key` for exactly this
// (apps/web/src/app/api/p2p/orders/route.ts), and the key is generated ONCE per
// user intent and reused across retries. Generating it per REQUEST would make
// the header decorative.
// ---------------------------------------------------------------------------

export interface AdFilter {
  side?: P2PSide;
  asset?: string;
  fiat?: string;
  fiatAmount?: number;
  paymentMethodType?: string;
}

export async function fetchAds(filter: AdFilter = {}): Promise<P2PAd[]> {
  const params = new URLSearchParams();
  if (filter.side) params.set("side", filter.side);
  if (filter.asset) params.set("asset", filter.asset);
  if (filter.fiat) params.set("fiat", filter.fiat);
  if (filter.fiatAmount !== undefined) params.set("fiatAmount", String(filter.fiatAmount));
  if (filter.paymentMethodType) params.set("paymentMethodType", filter.paymentMethodType);

  const qs = params.toString();
  const res = await api<{ ads: P2PAd[]; count: number }>(`/p2p/ads${qs ? `?${qs}` : ""}`);

  track("p2p_ads_browsed", {
    side: filter.side ?? "any",
    asset: filter.asset ?? "any",
    fiat: filter.fiat ?? "any",
    results: res.count,
  });
  return res.ads;
}

export async function fetchAd(id: string): Promise<P2PAd> {
  const res = await api<{ ad: P2PAd }>(`/p2p/ads/${encodeURIComponent(id)}`);
  return res.ad;
}

/**
 * Price a trade without committing.
 *
 * Exactly one of amount/fiatAmount, matching the server's refinement. Sending
 * both is rejected there rather than silently honouring one, because the two
 * can disagree and the user would be quoted a trade they did not ask for.
 */
export async function quote(adId: string, input: { amount?: number } | { fiatAmount?: number }): Promise<P2PQuote> {
  const res = await api<{ ok: boolean; quote: P2PQuote; error?: string }>("/p2p/quote", {
    method: "POST",
    body: { adId, ...input },
  });
  if (!res.ok) throw new Error(res.error ?? "Could not price this trade.");
  return res.quote;
}

/**
 * A key for one user INTENT, not one request.
 *
 * Created when the user taps "open order" and reused for every retry of that
 * tap. See the header — this is what stops a timeout from double-locking a
 * seller's escrow.
 */
export function newOrderIntentKey(): string {
  return Crypto.randomUUID();
}

export async function createOrder(input: {
  adId: string;
  amount?: number;
  fiatAmount?: number;
  paymentMethodId?: string;
  /** From newOrderIntentKey(). MUST be stable across retries of one intent. */
  idempotencyKey: string;
  /** For the analytics bucket only; never sent. */
  approxUsd?: number;
}): Promise<P2POrder> {
  const { idempotencyKey, approxUsd, ...body } = input;

  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>("/p2p/orders", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (!res.ok) throw new Error(res.error ?? "Could not open this order.");

  track("p2p_order_created", {
    side: res.order.takerSide,
    asset: res.order.asset,
    fiat: res.order.fiat,
    bucket: bucketUsd(approxUsd ?? 0),
  });
  return res.order;
}

export async function fetchOrders(status?: string): Promise<P2POrder[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await api<{ orders: P2POrder[] }>(`/p2p/orders${qs}`);
  return res.orders;
}

export async function fetchOrder(id: string): Promise<P2POrder> {
  const res = await api<{ order: P2POrder }>(`/p2p/orders/${encodeURIComponent(id)}`);
  return res.order;
}

/** Buyer states that fiat has been sent. Does NOT move escrow. */
export async function markPaid(orderId: string): Promise<P2POrder> {
  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>(
    `/p2p/orders/${encodeURIComponent(orderId)}/pay`,
    { method: "POST", body: {} },
  );
  if (!res.ok) throw new Error(res.error ?? "Could not mark this order as paid.");
  track("p2p_order_state", { state: "paid" });
  return res.order;
}

/**
 * Seller confirms fiat received; escrow is released to the buyer.
 *
 * IRREVERSIBLE, and idempotent for the same reason order creation is: a
 * timeout on the response of a release must not be able to release twice — or,
 * worse, leave the caller unsure whether it released at all and re-asking.
 */
export async function releaseOrder(orderId: string, idempotencyKey: string): Promise<P2POrder> {
  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>(
    `/p2p/orders/${encodeURIComponent(orderId)}/release`,
    { method: "POST", body: {}, headers: { "Idempotency-Key": idempotencyKey } },
  );
  if (!res.ok) throw new Error(res.error ?? "Could not release this order.");
  track("p2p_order_state", { state: "released" });
  return res.order;
}

export async function cancelOrder(orderId: string, reason: string): Promise<P2POrder> {
  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>(
    `/p2p/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST", body: { reason } },
  );
  if (!res.ok) throw new Error(res.error ?? "Could not cancel this order.");
  track("p2p_order_state", { state: "cancelled" });
  return res.order;
}

export async function openAppeal(orderId: string, reason: string, detail: string): Promise<P2POrder> {
  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>(
    `/p2p/orders/${encodeURIComponent(orderId)}/appeal`,
    { method: "POST", body: { reason, detail } },
  );
  if (!res.ok) throw new Error(res.error ?? "Could not open an appeal.");
  track("p2p_appeal_opened", { reason });
  return res.order;
}

export async function rateCounterparty(orderId: string, stars: number, comment: string): Promise<P2POrder> {
  const res = await api<{ ok: boolean; order: P2POrder; error?: string }>(
    `/p2p/orders/${encodeURIComponent(orderId)}/rate`,
    { method: "POST", body: { stars, comment } },
  );
  if (!res.ok) throw new Error(res.error ?? "Could not submit your rating.");
  return res.order;
}

export interface P2PConfig {
  assets: string[];
  fiats: string[];
  paymentMethodTypes: Array<{ type: string; label: string; needsBankCode: boolean }>;
  appealReasons: Array<{ id: string; label: string }>;
  cancelReasons: Array<{ id: string; label: string }>;
  limits: Record<string, number>;
}

/**
 * The marketplace's own description of itself.
 *
 * Fetched rather than hardcoded so a new fiat corridor or payment rail is a
 * server change, not an app release. A client with a stale asset list would
 * offer trades the escrow cannot hold.
 */
export async function fetchConfig(): Promise<P2PConfig> {
  return api<P2PConfig>("/p2p/config");
}

/**
 * Tell the server this user is present.
 *
 * Drives the "online" dot on a maker's ads. Best-effort and never awaited on a
 * render path: a failed heartbeat means a dot is missing, which is not worth an
 * error to anyone.
 */
export async function heartbeat(): Promise<void> {
  await api("/p2p/heartbeat", { method: "POST", body: {} }).catch(() => {});
}
