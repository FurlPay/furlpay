import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const verifyUsdcPayment = vi.fn();
vi.mock("@/lib/travel/settlementProof", async (orig) => ({
  ...(await orig<typeof import("@/lib/travel/settlementProof")>()),
  verifyUsdcPayment,
}));

const {
  createRampOrder,
  getRampOrder,
  getRampOrderByProviderRef,
  listUserOrders,
  setProviderOrderId,
  updateRampOrderStatus,
  RampOrderError,
} = await import("@/lib/ramp/rampOrder");
const { TransitionError } = await import("@/lib/money/lifecycle");
const { furlbridgePath, remainingSteps } = await import("@/lib/ramp/furlbridgeStatus");
const { confirmDeliveryOnChain, usdcAtomic } = await import("@/lib/ramp/deliveryProof");

const WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";

function newOrder(over: Partial<Parameters<typeof createRampOrder>[0]> = {}) {
  return createRampOrder({
    providerId: "furlbridge",
    direction: "onramp",
    flowKind: "hosted_checkout",
    statusFeed: true,
    userId: `u_${randomUUID()}`,
    fiatCurrency: "USD",
    fiatAmountMinor: 10_000,
    cryptoAsset: "USDC",
    chain: "base",
    destinationAddress: WALLET,
    ...over,
  });
}

beforeEach(() => verifyUsdcPayment.mockReset());

describe("ramp order store", () => {
  it("creates CREATED with an owner, indexes it, and lists newest first", async () => {
    const userId = `u_${randomUUID()}`;
    const a = await newOrder({ userId });
    await new Promise((r) => setTimeout(r, 5));
    const b = await newOrder({ userId });
    expect(a.status).toBe("CREATED");
    expect(a.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await listUserOrders(userId)).map((o) => o.orderId)).toEqual([b.orderId, a.orderId]);
  });

  it("refuses an order with no owner", async () => {
    await expect(newOrder({ userId: undefined, partnerId: undefined })).rejects.toBeInstanceOf(RampOrderError);
  });

  it("indexes the provider's order id once, for webhook lookup", async () => {
    const o = await newOrder();
    const ref = `trk_${randomUUID()}`;
    await setProviderOrderId(o.orderId, ref);
    expect((await getRampOrderByProviderRef("furlbridge", ref))?.orderId).toBe(o.orderId);
    await expect(setProviderOrderId(o.orderId, "another")).rejects.toThrow(/already has provider id/);
  });
});

describe("transitions are the FSM's, with evidence", () => {
  it("records a legal move with its history", async () => {
    const o = await newOrder();
    const u = await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system", evidence: "checkout" });
    expect(u.status).toBe("PAYMENT_PENDING");
    expect(u.statusHistory).toEqual([expect.objectContaining({ from: "CREATED", to: "PAYMENT_PENDING", trigger: "system" })]);
  });

  it("refuses an illegal jump and writes nothing", async () => {
    const o = await newOrder();
    await expect(updateRampOrderStatus(o.orderId, { to: "COMPLETED", trigger: "webhook" })).rejects.toBeInstanceOf(TransitionError);
    expect((await getRampOrder(o.orderId))?.status).toBe("CREATED");
  });

  it("refuses PAYMENT_CONFIRMED without the provider's reference", async () => {
    const o = await newOrder();
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    await expect(updateRampOrderStatus(o.orderId, { to: "PAYMENT_CONFIRMED", trigger: "webhook" })).rejects.toThrow(/providerRef/);
  });

  it("serialises concurrent updates (no lost history)", async () => {
    const o = await newOrder();
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    // Without the lock, whichever read-modify-write lands second erases the
    // other's change.
    const trk = `trk_${randomUUID()}`;
    await Promise.all([
      updateRampOrderStatus(o.orderId, { to: "PAYMENT_CONFIRMED", trigger: "webhook", refs: { providerRef: "r1" } }),
      setProviderOrderId(o.orderId, trk),
    ]);
    const final = await getRampOrder(o.orderId);
    expect(final?.status).toBe("PAYMENT_CONFIRMED");
    expect(final?.providerOrderId).toBe(trk);
    expect(final?.statusHistory.map((h) => h.to)).toEqual(["PAYMENT_PENDING", "PAYMENT_CONFIRMED"]);
  });
});

describe("Transak status → hosted path", () => {
  it("walks forward only", () => {
    expect(furlbridgePath("COMPLETED")).toEqual(["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "CRYPTO_PENDING"]);
    expect(remainingSteps("PAYMENT_CONFIRMED", furlbridgePath("AWAITING_PAYMENT_FROM_USER"))).toEqual(["PAYMENT_PENDING"]);
    expect(remainingSteps("PAYMENT_CONFIRMED", furlbridgePath("COMPLETED"))).toEqual(["CRYPTO_PENDING"]);
  });
  it("never trusts a user's own 'I paid' or an unknown status", () => {
    expect(furlbridgePath("PAYMENT_DONE_MARKED_BY_USER")).toEqual([]);
    expect(furlbridgePath("SOMETHING_NEW")).toEqual([]);
  });
  it("sends a provider-side refund to a person, not to REFUNDED", () => {
    expect(furlbridgePath("REFUNDED")).toEqual(["MANUAL_REVIEW"]);
  });
});

describe("hosted completion is proven on-chain by FurlPay", () => {
  it("parses USDC amounts to atomic units strictly", () => {
    expect(usdcAtomic("99.5")).toBe("99500000");
    expect(usdcAtomic("1")).toBe("1000000");
    expect(usdcAtomic("1e-7")).toBeNull();
    expect(usdcAtomic("1.1234567")).toBeNull();
  });

  async function atCryptoPending() {
    const o = await newOrder();
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_CONFIRMED", trigger: "webhook", refs: { providerRef: "trk_1" } });
    return updateRampOrderStatus(o.orderId, {
      to: "CRYPTO_PENDING",
      trigger: "webhook",
      refs: { chainTxHash: `0x${"a".repeat(64)}` },
      cryptoAmount: "99.5",
    });
  }

  it("completes only after the transfer verifies", async () => {
    const o = await atCryptoPending();
    verifyUsdcPayment.mockResolvedValue({ ok: true, txHash: "0x", network: "base", paidAtomic: "99500000", confirmations: 12, requiredConfirmations: 6 });
    const r = await confirmDeliveryOnChain(o.orderId);
    expect(r.status).toBe("confirmed");
    expect(verifyUsdcPayment).toHaveBeenCalledWith(expect.objectContaining({ expectedTo: WALLET, expectedAtomic: "99500000", network: "base" }));
    expect((await getRampOrder(o.orderId))?.status).toBe("COMPLETED");
  });

  it("stays pending while confirmations are short", async () => {
    const o = await atCryptoPending();
    verifyUsdcPayment.mockResolvedValue({ ok: false, reason: "insufficient_confirmations", detail: "2/6" });
    expect((await confirmDeliveryOnChain(o.orderId)).status).toBe("pending");
    expect((await getRampOrder(o.orderId))?.status).toBe("CRYPTO_PENDING");
  });

  it("sends a provider/chain disagreement to manual review", async () => {
    const o = await atCryptoPending();
    verifyUsdcPayment.mockResolvedValue({ ok: false, reason: "no_matching_transfer", detail: "nothing to that wallet" });
    expect((await confirmDeliveryOnChain(o.orderId)).status).toBe("mismatch");
    expect((await getRampOrder(o.orderId))?.status).toBe("MANUAL_REVIEW");
  });
});

describe("FurlBridge webhook advances the order", () => {
  const KEY = "partner-access-token-test";
  const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = (claims: object) => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const p = b64url(Buffer.from(JSON.stringify(claims)));
    return `${h}.${p}.${b64url(createHmac("sha256", KEY).update(`${h}.${p}`).digest())}`;
  };
  async function send(wd: Record<string, unknown>, eventID: string) {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const { POST } = await import("@/app/api/webhooks/furlbridge/route");
    const body = JSON.stringify({ data: jwt({ webhookData: wd, eventID, createdAt: new Date().toISOString() }) });
    return POST(new NextRequest("http://localhost/api/webhooks/furlbridge", { method: "POST", body }));
  }

  it("finds the order by partnerOrderId, indexes Transak's id, and moves it", async () => {
    const o = await newOrder();
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    const trk = `trk_${randomUUID()}`;
    const res = await send({ id: trk, status: "PENDING_DELIVERY_FROM_TRANSAK", partnerOrderId: o.orderId }, "ORDER_PROCESSING");
    expect(res.status).toBe(200);
    const after = await getRampOrder(o.orderId);
    expect(after?.status).toBe("PAYMENT_CONFIRMED");
    expect(after?.providerOrderId).toBe(trk);

    // A late, older event never moves it back.
    await send({ id: trk, status: "AWAITING_PAYMENT_FROM_USER" }, "ORDER_CREATED");
    expect((await getRampOrder(o.orderId))?.status).toBe("PAYMENT_CONFIRMED");
  });

  it("COMPLETED without a tx hash stops where the evidence runs out", async () => {
    const o = await newOrder();
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    await send({ id: `trk_${randomUUID()}`, status: "COMPLETED", partnerOrderId: o.orderId, cryptoAmount: 99.5 }, "ORDER_COMPLETED");
    expect((await getRampOrder(o.orderId))?.status).toBe("PAYMENT_CONFIRMED");
  });

  it("an order from another environment is acknowledged and changes nothing", async () => {
    const res = await send({ id: `trk_${randomUUID()}`, status: "COMPLETED", partnerOrderId: randomUUID() }, "ORDER_COMPLETED");
    expect(await res.json()).toEqual({ received: true, matched: false });
  });
});
