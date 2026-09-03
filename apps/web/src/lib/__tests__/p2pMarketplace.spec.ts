import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetP2PForTests,
  savePaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  createAd,
  editAd,
  closeAd,
  listAds,
  publicAd,
  quoteOrder,
  createOrder,
  getOrder,
  markPaid,
  releaseOrder,
  cancelOrder,
  openAppeal,
  addAppealEvidence,
  cancelAppeal,
  rateCounterparty,
  escrowedAmount,
  roleInOrder,
  sellerOf,
  buyerOf,
  merchantProfile,
  makerEligibility,
  applyAsMaker,
  redactPaymentMethod,
} from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";

// The P2P marketplace is an adversarial surface: the two parties want opposite
// things at every step. These specs pin the rules that stop one side taking
// both legs of the trade.

const MAKER = "user-maker";
const TAKER = "user-taker";
const STRANGER = "user-stranger";

function makerMethod() {
  return savePaymentMethod(MAKER, {
    type: "upi",
    label: "Primary UPI",
    holderName: "Asha Kumar",
    account: "asha@okbank",
  });
}

/** A standard sell-crypto-for-INR ad owned by MAKER. */
function sellAd() {
  const pm = makerMethod();
  return createAd(MAKER, {
    side: "sell",
    asset: "USDT",
    fiat: "INR",
    price: 91.2,
    totalAmount: 1000,
    minFiat: 1000,
    maxFiat: 91_200,
    paymentMethodIds: [pm.id],
  });
}

beforeEach(() => {
  __resetP2PForTests();
});

describe("payment methods", () => {
  it("requires a bank code only for the types that need one", () => {
    expect(() =>
      savePaymentMethod(MAKER, { type: "bank", label: "HDFC", holderName: "A K", account: "12345678" }),
    ).toThrow(/bankCode/);
    expect(savePaymentMethod(MAKER, { type: "upi", label: "UPI", holderName: "A K", account: "a@ok" })).toBeTruthy();
  });

  it("never exposes a full account number in the redacted shape", () => {
    const m = savePaymentMethod(MAKER, {
      type: "upi",
      label: "UPI",
      holderName: "Asha Kumar",
      account: "asha@okbank",
    });
    const r = redactPaymentMethod(m);
    expect(JSON.stringify(r)).not.toContain("asha@okbank");
    expect(r.accountLast4).toBe("bank");
    expect(r.holderName).not.toBe("Asha Kumar");
  });

  it("refuses to delete a method a live order depends on", () => {
    const ad = sellAd();
    createOrder(TAKER, { adId: ad.id, fiatAmount: 9120 });
    const pmId = ad.paymentMethodIds[0];
    expect(() => deletePaymentMethod(MAKER, pmId)).toThrow(/in use/);
  });

  it("will not let one user delete another user's method", () => {
    const m = makerMethod();
    expect(() => deletePaymentMethod(STRANGER, m.id)).toThrow(/not found/);
    expect(listPaymentMethods(MAKER)).toHaveLength(1);
  });
});

describe("ads", () => {
  it("refuses an ad citing a payment method the owner does not own", () => {
    const foreign = savePaymentMethod(STRANGER, {
      type: "upi",
      label: "theirs",
      holderName: "X Y",
      account: "x@ok",
    });
    expect(() =>
      createAd(MAKER, {
        side: "sell",
        asset: "USDT",
        fiat: "INR",
        price: 91,
        totalAmount: 100,
        minFiat: 100,
        maxFiat: 9100,
        paymentMethodIds: [foreign.id],
      }),
    ).toThrow(/Unknown payment method/);
  });

  it("keeps account numbers out of the public ad shape", () => {
    const ad = sellAd();
    expect(JSON.stringify(publicAd(ad))).not.toContain("asha@okbank");
  });

  it("only the owner can edit or close", () => {
    const ad = sellAd();
    expect(() => editAd(STRANGER, ad.id, { price: 1 })).toThrow(/not found/);
    expect(() => closeAd(STRANGER, ad.id)).toThrow(/not found/);
    expect(editAd(MAKER, ad.id, { price: 90 }).price).toBe(90);
  });

  it("rejects an inverted price band", () => {
    const pm = makerMethod();
    expect(() =>
      createAd(MAKER, {
        side: "sell",
        asset: "USDT",
        fiat: "INR",
        price: 91,
        totalAmount: 100,
        minFiat: 9000,
        maxFiat: 100,
        paymentMethodIds: [pm.id],
      }),
    ).toThrow(/minFiat/);
  });

  it("hides closed ads from the book but keeps them addressable", () => {
    const ad = sellAd();
    closeAd(MAKER, ad.id);
    expect(listAds()).toHaveLength(0);
    expect(listAds({ includeClosed: true })).toHaveLength(1);
  });

  it("filters by an amount the ad can actually fill", () => {
    sellAd(); // min 1000, max 91_200 INR
    expect(listAds({ fiatAmount: 500 })).toHaveLength(0);
    expect(listAds({ fiatAmount: 5000 })).toHaveLength(1);
  });
});

describe("quoting", () => {
  it("derives the asset amount from a fiat amount and back", () => {
    const ad = sellAd();
    const byFiat = quoteOrder(ad.id, { fiatAmount: 9120 });
    expect(byFiat.amount).toBe(100);
    const byAmount = quoteOrder(ad.id, { amount: 100 });
    expect(byAmount.fiatAmount).toBe(9120);
  });

  it("refuses an amount outside the ad's limits", () => {
    const ad = sellAd();
    expect(() => quoteOrder(ad.id, { fiatAmount: 10 })).toThrow(/limits/);
  });

  it("gives the taker the mirror side of the ad", () => {
    const ad = sellAd();
    expect(quoteOrder(ad.id, { amount: 100 }).takerSide).toBe("buy");
  });
});

describe("order lifecycle", () => {
  it("locks escrow against the seller at creation and reserves ad inventory", () => {
    const ad = sellAd();
    const { order, escrow } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(escrow.sellerId).toBe(MAKER);
    expect(escrow.amount).toBe(100);
    expect(escrowedAmount(MAKER, "USDT")).toBe(100);
    expect(ad.availableAmount).toBe(900);
    expect(order.status).toBe("pending_payment");
  });

  it("assigns buyer and seller from the ad side, not from who opened it", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(sellerOf(order)).toBe(MAKER);
    expect(buyerOf(order)).toBe(TAKER);
    expect(roleInOrder(order, TAKER)).toBe("buyer");
    expect(roleInOrder(order, MAKER)).toBe("seller");
  });

  it("refuses self-dealing", () => {
    const ad = sellAd();
    expect(() => createOrder(MAKER, { adId: ad.id, amount: 100 })).toThrow(/your own ad/);
  });

  it("hides an order from anyone who is not a party to it", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(() => getOrder(order.id, STRANGER)).toThrow(/not found/);
    expect(getOrder(order.id, MAKER).id).toBe(order.id);
  });

  it("runs the happy path to released and frees the escrow", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    markPaid(order.id, TAKER);
    expect(getOrder(order.id, TAKER).status).toBe("paid");
    const { settlement } = releaseOrder(order.id, MAKER);
    expect(settlement).toMatchObject({ sellerId: MAKER, buyerId: TAKER, amount: 100 });
    expect(getOrder(order.id, TAKER).status).toBe("released");
    expect(escrowedAmount(MAKER, "USDT")).toBe(0);
  });

  it("lets only the buyer declare payment", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(() => markPaid(order.id, MAKER)).toThrow(/Only the buyer/);
  });

  it("lets only the seller release", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    markPaid(order.id, TAKER);
    expect(() => releaseOrder(order.id, TAKER)).toThrow(/Only the seller/);
  });

  it("stops the seller cancelling out of an order the buyer has paid", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    markPaid(order.id, TAKER);
    // The whole point of escrow: once fiat is claimed sent, the seller cannot
    // unilaterally take the crypto leg back.
    expect(() => cancelOrder(order.id, MAKER, "changed_mind")).toThrow(/appeal/);
  });

  it("returns escrow and ad inventory on cancel", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(ad.availableAmount).toBe(900);
    const { refund } = cancelOrder(order.id, TAKER, "changed_mind");
    expect(refund).toMatchObject({ sellerId: MAKER, amount: 100 });
    expect(escrowedAmount(MAKER, "USDT")).toBe(0);
    expect(ad.availableAmount).toBe(1000);
  });

  it("cannot release or cancel twice", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    releaseOrder(order.id, MAKER);
    expect(() => releaseOrder(order.id, MAKER)).toThrow(/released/);
    expect(() => cancelOrder(order.id, TAKER, "changed_mind")).toThrow(/released/);
  });
});

describe("appeals", () => {
  it("freezes the order and blocks cancellation while open", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    markPaid(order.id, TAKER);
    openAppeal(order.id, TAKER, { reason: "paid_not_released", detail: "sent 2h ago" });
    expect(getOrder(order.id, TAKER).status).toBe("appealed");
    expect(() => cancelOrder(order.id, MAKER, "changed_mind")).toThrow(/under appeal/);
    expect(() => releaseOrder(order.id, MAKER)).toThrow(/appealed/);
  });

  it("only the opener may withdraw, and the order returns to its prior state", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    markPaid(order.id, TAKER);
    openAppeal(order.id, TAKER, { reason: "paid_not_released", detail: "x" });
    expect(() => cancelAppeal(order.id, MAKER)).toThrow(/who opened/);
    expect(cancelAppeal(order.id, TAKER).status).toBe("paid");
  });

  it("accepts evidence only while an appeal is open", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(() => addAppealEvidence(order.id, TAKER, { url: "https://x/1.png" })).toThrow(/No open appeal/);
    openAppeal(order.id, TAKER, { reason: "paid_not_released", detail: "x" });
    expect(addAppealEvidence(order.id, TAKER, { url: "https://x/1.png" }).appeal!.evidence).toHaveLength(1);
  });
});

describe("reputation", () => {
  it("rates only a completed order, and only once per side", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    expect(() => rateCounterparty(order.id, TAKER, 5, "")).toThrow(/completed/);
    releaseOrder(order.id, MAKER);
    rateCounterparty(order.id, TAKER, 5, "fast");
    expect(() => rateCounterparty(order.id, TAKER, 5, "again")).toThrow(/Already rated/);
    expect(merchantProfile(MAKER).rating).toBe(5);
  });

  it("gates maker certification on KYC and a trading record", () => {
    expect(makerEligibility(MAKER, false).reasons).toContain("kyc_required");
    expect(makerEligibility(MAKER, true).reasons).toContain("insufficient_completed_orders");
    expect(() => applyAsMaker(MAKER, "Asha", 100)).toThrow(/Deposit below/);
  });
});

describe("order view privacy", () => {
  it("reveals the full account only to the buyer of a live order", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });

    const buyerView = orderView(order, TAKER);
    expect(JSON.stringify(buyerView)).toContain("asha@okbank");

    // The seller already knows their own rail; the order view still redacts it,
    // so a compromised session cannot read it back out of an order.
    const sellerView = orderView(order, MAKER);
    expect(JSON.stringify(sellerView)).not.toContain("asha@okbank");
  });

  it("stops revealing the account once the order is no longer live", () => {
    const ad = sellAd();
    const { order } = createOrder(TAKER, { adId: ad.id, amount: 100 });
    releaseOrder(order.id, MAKER);
    expect(JSON.stringify(orderView(order, TAKER))).not.toContain("asha@okbank");
  });
});
