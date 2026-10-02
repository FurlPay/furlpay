import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const verifyUsdcPayment = vi.fn();
vi.mock("@/lib/travel/settlementProof", async (orig) => ({
  ...(await orig<typeof import("@/lib/travel/settlementProof")>()),
  verifyUsdcPayment,
}));

const { kvDel, kvGet, kvSet, kvSetNx } = await import("@/lib/kv");
const { createRampOrder, getRampOrder, updateRampOrderStatus } = await import("@/lib/ramp/rampOrder");
const { reconcileStaleOrder } = await import("@/lib/ramp/staleOrders");
const { signSession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");

type Order = NonNullable<Awaited<ReturnType<typeof getRampOrder>>>;
const WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";

async function orderAt(status: "PAYMENT_PENDING" | "CRYPTO_PENDING", minutesAgo: number, over: Partial<Order> = {}) {
  const o = await createRampOrder({
    providerId: "furlgateway",
    direction: "onramp",
    flowKind: "hosted_checkout",
    statusFeed: false,
    userId: `u_${randomUUID()}`,
    fiatCurrency: "USD",
    fiatAmountMinor: 5000,
    cryptoAsset: "USDC",
    cryptoAmount: "49.5",
    chain: "base",
    destinationAddress: WALLET,
  });
  await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
  if (status === "CRYPTO_PENDING") {
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_CONFIRMED", trigger: "webhook", refs: { providerRef: "p" } });
    await updateRampOrderStatus(o.orderId, { to: "CRYPTO_PENDING", trigger: "webhook", refs: { chainTxHash: `0x${"b".repeat(64)}` } });
  }
  const stored = (await kvGet<Order>(`ramp:order:${o.orderId}`))!;
  const aged = { ...stored, ...over, updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() };
  await kvSet(`ramp:order:${o.orderId}`, aged);
  return aged;
}

beforeEach(() => verifyUsdcPayment.mockReset());

describe("stale orders resolve on access", () => {
  it("an unpaid checkout older than 30 minutes is ABANDONED, never CANCELLED", async () => {
    const o = await orderAt("PAYMENT_PENDING", 31);
    const r = await reconcileStaleOrder(o);
    expect(r.status).toBe("ABANDONED");
    // No status feed: the record says payment may still have happened.
    expect(r.statusHistory.at(-1)?.evidence).toMatch(/may have completed with the provider/);
  });

  it("a recent checkout is left alone", async () => {
    const o = await orderAt("PAYMENT_PENDING", 5);
    expect((await reconcileStaleOrder(o)).status).toBe("PAYMENT_PENDING");
  });

  it("delivery unconfirmed after an hour goes to a person, after one more on-chain check", async () => {
    const o = await orderAt("CRYPTO_PENDING", 61);
    verifyUsdcPayment.mockResolvedValue({ ok: false, reason: "tx_not_found", detail: "not indexed" });
    const r = await reconcileStaleOrder(o);
    expect(verifyUsdcPayment).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("MANUAL_REVIEW");
  });

  it("…or completes, if the late check verifies", async () => {
    const o = await orderAt("CRYPTO_PENDING", 61);
    verifyUsdcPayment.mockResolvedValue({ ok: true, txHash: "0x", network: "base", paidAtomic: "49500000", confirmations: 10, requiredConfirmations: 6 });
    expect((await reconcileStaleOrder(o)).status).toBe("COMPLETED");
  });
});

describe("GET /api/ramp/orders/:id", () => {
  async function bearerFor(userId?: string) {
    const { account } = findOrCreateUserByIdentity({ email: `ord-${randomUUID()}@furlpay.test`, name: "Ord" });
    const token = await signSession({ sub: userId ?? account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
    return { userId: account.user.id, auth: `Bearer ${token}` };
  }

  it("returns the order to its owner and 404 to anyone else", async () => {
    const owner = await bearerFor();
    const other = await bearerFor();
    const o = await createRampOrder({
      providerId: "furlgateway", direction: "onramp", flowKind: "hosted_checkout", statusFeed: false,
      userId: owner.userId, fiatCurrency: "USD", fiatAmountMinor: 100, cryptoAsset: "USDC", chain: "base",
    });
    const { GET } = await import("@/app/api/ramp/orders/[orderId]/route");
    const get = (auth: string) =>
      GET(new NextRequest(`http://localhost/api/ramp/orders/${o.orderId}`, { headers: { authorization: auth } }), {
        params: Promise.resolve({ orderId: o.orderId }),
      });
    const mine = await get(owner.auth);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ orderId: o.orderId, status: "CREATED", statusFeed: false });
    expect((await get(other.auth)).status).toBe(404);
  });
});

describe("webhook idempotency", () => {
  const KEY = "partner-access-token-test";
  const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = (claims: object) => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const p = b64url(Buffer.from(JSON.stringify(claims)));
    return `${h}.${p}.${b64url(createHmac("sha256", KEY).update(`${h}.${p}`).digest())}`;
  };

  it("a failed processing attempt releases its claim, so the provider's retry is processed", async () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const o = await createRampOrder({
      providerId: "furlbridge", direction: "onramp", flowKind: "hosted_checkout", statusFeed: true,
      userId: `u_${randomUUID()}`, fiatCurrency: "USD", fiatAmountMinor: 100, cryptoAsset: "USDC", chain: "base",
    });
    await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
    const body = JSON.stringify({
      data: jwt({
        webhookData: { id: `trk_${randomUUID()}`, status: "PENDING_DELIVERY_FROM_TRANSAK", partnerOrderId: o.orderId },
        eventID: "ORDER_PROCESSING",
        createdAt: new Date().toISOString(),
      }),
    });
    const { POST } = await import("@/app/api/webhooks/furlbridge/route");
    const send = () => POST(new NextRequest("http://localhost/api/webhooks/furlbridge", { method: "POST", body }));

    // Hold the order's lock so processing fails.
    await kvSetNx(`ramp:lock:${o.orderId}`, 1, 30);
    expect((await send()).status).toBe(500);
    await kvDel(`ramp:lock:${o.orderId}`);

    const retry = await send();
    expect(await retry.json()).toMatchObject({ received: true, status: "PAYMENT_CONFIRMED" });
    // And a genuine redelivery after success is a duplicate.
    expect(await (await send()).json()).toEqual({ received: true, duplicate: true });
  }, 15_000);
});
