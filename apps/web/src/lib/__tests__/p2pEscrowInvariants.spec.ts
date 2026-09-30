// ---------------------------------------------------------------------------
// P2P escrow invariants, attacked through the real routes.
//
// p2pMarketplace.spec.ts pins the state machine one call at a time. These
// cases try to BREAK escrow: concurrent releases, release racing cancel,
// oversubscribing an ad, funding failures, and the seller-cancel scam. The
// property checked throughout is conservation — the asset held by seller +
// buyer + escrow never exceeds what existed before the trade.
//
// SCOPE, stated so a green run is not over-read: the P2P store is process
// memory. Within one process the service transitions are synchronous, which is
// what these tests exercise. Across serverless instances there is NO shared
// state and NO lock — that is a production blocker recorded in
// docs/audit/PRODUCTION_GAP_AUDIT.md, and nothing here claims otherwise.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, type UserAccount } from "@/lib/store";
import {
  __resetP2PForTests,
  createAd,
  createOrder,
  cancelOrder,
  escrowedAmount,
  listOrders,
  markPaid,
  savePaymentMethod,
} from "@/lib/services/p2p";
import { POST as createOrderPOST } from "@/app/api/p2p/orders/route";
import { POST as releasePOST } from "@/app/api/p2p/orders/[id]/release/route";
import { POST as cancelPOST } from "@/app/api/p2p/orders/[id]/cancel/route";

async function party(usdt: number) {
  const { account } = findOrCreateUserByIdentity({ email: `p2p-${randomUUID()}@furlpay.test`, name: "P2P Party" });
  account.tokenBalances = usdt > 0 ? [{ token: "USDT", chain: "arbitrum", amount: usdt, usdValue: usdt }] : [];
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { account, token, id: account.user.id };
}

function usdt(a: UserAccount): number {
  return a.tokenBalances.find((b) => b.token === "USDT")?.amount ?? 0;
}

function post(path: string, token: string, body: unknown = {}) {
  return new NextRequest(`https://furlpay.com/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function sellAdBy(makerId: string, totalAmount = 1000) {
  const pm = savePaymentMethod(makerId, { type: "upi", label: "UPI", holderName: "Maker", account: "maker@okbank" });
  return createAd(makerId, {
    side: "sell",
    asset: "USDT",
    fiat: "INR",
    price: 91.2,
    totalAmount,
    minFiat: 1000,
    maxFiat: 91_200,
    paymentMethodIds: [pm.id],
  });
}

async function openOrder(taker: { token: string }, adId: string, amount: number) {
  const res = await createOrderPOST(post("/p2p/orders", taker.token, { adId, amount }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => __resetP2PForTests());
afterEach(() => vi.useRealTimers());

describe("funding is atomic with order creation", () => {
  it("an unfundable order leaves no order, no reservation and no escrow", async () => {
    const maker = await party(0); // cannot fund anything
    const taker = await party(0);
    const ad = sellAdBy(maker.id);

    const r = await openOrder(taker, ad.id, 100);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("seller_insufficient_balance");
    expect(listOrders(taker.id)).toHaveLength(0);
    expect(listOrders(maker.id)).toHaveLength(0);
    expect(ad.availableAmount).toBe(1000);
    expect(escrowedAmount(maker.id, "USDT")).toBe(0);
  });

  it("the service mutates nothing when fundEscrow throws", () => {
    const ad = sellAdBy("svc-maker");
    expect(() =>
      createOrder("svc-taker", { adId: ad.id, amount: 100 }, {
        fundEscrow: () => {
          throw new Error("boom");
        },
      })
    ).toThrow("boom");
    expect(ad.availableAmount).toBe(1000);
    expect(escrowedAmount("svc-maker", "USDT")).toBe(0);
    expect(listOrders("svc-taker")).toHaveLength(0);
  });
});

describe("no double release, no release-and-refund", () => {
  it("ten concurrent releases settle exactly once", async () => {
    const maker = await party(500);
    const taker = await party(0);
    const ad = sellAdBy(maker.id);
    const { body } = await openOrder(taker, ad.id, 100);
    const id = body.order.id;
    expect(usdt(maker.account)).toBe(400);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => releasePOST(post(`/p2p/orders/${id}/release`, maker.token), params(id)))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(usdt(taker.account)).toBe(100);
    expect(usdt(maker.account)).toBe(400);
    expect(escrowedAmount(maker.id, "USDT")).toBe(0);
  });

  it("release racing cancel: exactly one wins and value is conserved", async () => {
    const maker = await party(500);
    const taker = await party(0);
    const ad = sellAdBy(maker.id);
    const { body } = await openOrder(taker, ad.id, 100);
    const id = body.order.id;

    const [rel, can] = await Promise.all([
      releasePOST(post(`/p2p/orders/${id}/release`, maker.token), params(id)),
      cancelPOST(post(`/p2p/orders/${id}/cancel`, taker.token, { reason: "changed_mind" }), params(id)),
    ]);
    expect([rel.status, can.status].filter((s) => s === 200)).toHaveLength(1);
    // Whichever won, the 100 USDT exists exactly once.
    expect(usdt(maker.account) + usdt(taker.account) + escrowedAmount(maker.id, "USDT")).toBe(500);
  });
});

describe("an ad cannot be oversold", () => {
  it("concurrent takers never reserve more than the ad holds", async () => {
    const maker = await party(10_000);
    const ad = sellAdBy(maker.id, 300); // 300 USDT on offer
    const takers = await Promise.all(Array.from({ length: 6 }, () => party(0)));

    const results = await Promise.all(takers.map((t) => openOrder(t, ad.id, 100)));
    const filled = results.filter((r) => r.status === 201).length;
    expect(filled).toBeLessThanOrEqual(3);
    expect(ad.availableAmount).toBeGreaterThanOrEqual(0);
    expect(escrowedAmount(maker.id, "USDT")).toBe(filled * 100);
    expect(usdt(maker.account)).toBe(10_000 - filled * 100);
  });
});

describe("the payment window", () => {
  function inWindow() {
    const ad = sellAdBy("win-maker");
    return createOrder("win-taker", { adId: ad.id, amount: 100 }).order;
  }

  it("the seller cannot cancel an unpaid order while the buyer's window is open", () => {
    const order = inWindow();
    expect(() => cancelOrder(order.id, "win-maker", "changed_mind")).toThrow(/window is still open/);
  });

  it("the seller may reclaim once the window has expired", () => {
    const order = inWindow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(order.expiresAt) + 1);
    const { refund } = cancelOrder(order.id, "win-maker", "buyer_timeout");
    expect(refund.amount).toBe(100);
  });

  it("the buyer cannot declare payment after the window", () => {
    const order = inWindow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(order.expiresAt) + 1);
    expect(() => markPaid(order.id, "win-taker")).toThrow(/window expired/);
  });

  it("the buyer can still cancel inside the window", () => {
    const order = inWindow();
    expect(cancelOrder(order.id, "win-taker", "changed_mind").order.status).toBe("cancelled");
  });
});
