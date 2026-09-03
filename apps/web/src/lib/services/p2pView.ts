import {
  roleInOrder,
  sellerOf,
  buyerOf,
  merchantProfile,
  redactPaymentMethod,
  fullPaymentMethod,
  listPaymentMethods,
} from "@/lib/services/p2p";
import type { P2POrder } from "@/lib/services/p2p";

// ---------------------------------------------------------------------------
// Order serialisation for the two parties.
//
// The one privacy decision that matters here: the seller's full account number
// is released ONLY to the buyer, and ONLY while the order is live. Before the
// order exists there is no reason to see it; after it settles there is no
// longer one. Everyone else — including the seller's own view of their order —
// gets the redacted form.
// ---------------------------------------------------------------------------

const LIVE_STATES = new Set(["pending_payment", "paid", "appealed"]);

export function orderView(o: P2POrder, viewerId: string) {
  const role = roleInOrder(o, viewerId);
  const sellerId = sellerOf(o);
  const buyerId = buyerOf(o);
  const counterpartyId = viewerId === o.makerId ? o.takerId : o.makerId;

  // The payment instruction belongs to whoever is receiving the fiat.
  const method = listPaymentMethods(sellerId).find((m) => m.id === o.paymentMethodId);
  const revealAccount = role === "buyer" && LIVE_STATES.has(o.status);

  return {
    id: o.id,
    sn: o.sn,
    adId: o.adId,
    role,
    asset: o.asset,
    fiat: o.fiat,
    price: o.price,
    amount: o.amount,
    fiatAmount: o.fiatAmount,
    status: o.status,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt,
    releasedAt: o.releasedAt,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    isSeller: viewerId === sellerId,
    isBuyer: viewerId === buyerId,
    counterparty: merchantProfile(counterpartyId),
    paymentMethod: method ? (revealAccount ? fullPaymentMethod(method) : redactPaymentMethod(method)) : null,
    appeal: o.appeal
      ? {
          id: o.appeal.id,
          reason: o.appeal.reason,
          detail: o.appeal.detail,
          status: o.appeal.status,
          openedAt: o.appeal.openedAt,
          openedByMe: o.appeal.openedBy === viewerId,
          evidence: o.appeal.evidence,
          outcome: o.appeal.outcome,
        }
      : null,
    ratedByMe: (o.ratedBy ?? []).includes(viewerId),
  };
}
