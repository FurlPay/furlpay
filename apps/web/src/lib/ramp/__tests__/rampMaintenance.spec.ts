import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { kvGet, kvZRangeByScore } from "@/lib/kv";
import { createRampOrder, getRampOrder, updateRampOrderStatus, SWEEP_INDEX } from "@/lib/ramp/rampOrder";
import { sweepStaleOrders } from "@/lib/ramp/staleOrders";
import { setPartnerWebhook } from "@/lib/ramp/partnerConfig";
import { deliverPartnerWebhook, processPartnerRetries, MAX_ATTEMPTS, RETRY_BACKOFF_S } from "@/lib/ramp/partnerWebhooks";

// The ramp-maintenance cron's two jobs: resolve stale orders nobody reads, and
// retry failed partner callbacks with backoff.

beforeEach(() => {
  process.env.FURLPAY_PARTNER_WEBHOOK_KEY = randomBytes(32).toString("base64");
});

async function pendingOrder(over: { partnerId?: string } = {}) {
  const o = await createRampOrder({
    providerId: "furlgateway", direction: "onramp", flowKind: "hosted_checkout", statusFeed: false,
    ...(over.partnerId ? { partnerId: over.partnerId } : { userId: `u_${randomUUID()}` }),
    fiatCurrency: "USD", fiatAmountMinor: 100, cryptoAsset: "USDC", chain: "base",
  });
  return updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
}

describe("sweep index", () => {
  it("holds only states the sweep can resolve", async () => {
    const o = await pendingOrder();
    const indexed = async () => (await kvZRangeByScore(SWEEP_INDEX, "-inf", "+inf")).includes(o.orderId);
    expect(await indexed()).toBe(true);
    await updateRampOrderStatus(o.orderId, { to: "COMPLIANCE_REVIEW", trigger: "system" });
    expect(await indexed()).toBe(false);
  });

  it("resolves an idle unpaid checkout without anyone reading it", async () => {
    const o = await pendingOrder();
    const r = await sweepStaleOrders(Date.now() + 31 * 60_000);
    expect(r.errors).toBe(0);
    expect((await getRampOrder(o.orderId))?.status).toBe("ABANDONED");
  });

  it("leaves a fresh checkout alone", async () => {
    const o = await pendingOrder();
    await sweepStaleOrders(Date.now() + 5 * 60_000);
    expect((await getRampOrder(o.orderId))?.status).toBe("PAYMENT_PENDING");
  });
});

describe("partner callback retries", () => {
  function recorder(statuses: number[]) {
    const calls: Record<string, string>[] = [];
    const transport = (async (_u: URL, _a: string, opts: { headers: Record<string, string> }) => {
      calls.push(opts.headers);
      return new Response("", { status: statuses.shift() ?? 200 });
    }) as never;
    return { calls, transport };
  }

  it("a failed delivery is queued and retried with backoff and a fresh attempt number", async () => {
    const partnerId = `m_${randomUUID()}`;
    await setPartnerWebhook(partnerId, "https://93.184.215.14/hook");
    const order = (await pendingOrder({ partnerId }))!;
    const { calls, transport } = recorder([503, 200]);
    const t0 = Date.now();

    expect(await deliverPartnerWebhook(order, transport, 1, t0)).toEqual({ delivered: false, reason: "http_503" });
    // Not due yet.
    expect((await processPartnerRetries(t0 + 30_000, 100, transport)).attempted).toBe(0);
    // Due after the first backoff.
    const run = await processPartnerRetries(t0 + RETRY_BACKOFF_S[0] * 1000 + 1, 100, transport);
    expect(run).toMatchObject({ attempted: 1, delivered: 1 });
    expect(calls.map((h) => h["x-furlpay-attempt"])).toEqual(["1", "2"]);
    // Delivered: nothing left queued.
    expect((await processPartnerRetries(t0 + 10 * 3_600_000, 100, transport)).attempted).toBe(0);
  });

  it("drops a retry once the order has moved on", async () => {
    const partnerId = `m_${randomUUID()}`;
    await setPartnerWebhook(partnerId, "https://93.184.215.14/hook");
    const order = (await pendingOrder({ partnerId }))!;
    const { transport } = recorder([500]);
    const t0 = Date.now();
    await deliverPartnerWebhook(order, transport, 1, t0);
    await updateRampOrderStatus(order.orderId, { to: "ABANDONED", trigger: "system" });
    const run = await processPartnerRetries(t0 + RETRY_BACKOFF_S[0] * 1000 + 1, 100, transport);
    expect(run).toMatchObject({ attempted: 0, dropped: 1 });
  });

  it("stops after the last attempt", async () => {
    const partnerId = `m_${randomUUID()}`;
    await setPartnerWebhook(partnerId, "https://93.184.215.14/hook");
    const order = (await pendingOrder({ partnerId }))!;
    const { transport } = recorder([500]);
    await deliverPartnerWebhook(order, transport, MAX_ATTEMPTS, Date.now());
    const run = await processPartnerRetries(Date.now() + 2 * 86_400_000, 100, transport);
    expect(run.attempted).toBe(0);
  });

  it("does not retry configuration problems", async () => {
    const partnerId = `m_${randomUUID()}`;
    const order = (await pendingOrder({ partnerId }))!;
    const r = await deliverPartnerWebhook(order, recorder([]).transport, 1, Date.now());
    expect(r).toEqual({ delivered: false, reason: "no_webhook_configured" });
    expect(await kvGet(`ramp:partner:retry:${order.orderId}:${order.status}`)).toBeNull();
  });
});

