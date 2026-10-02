import { describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { kvGet, kvSetNx } from "@/lib/kv";
import { createRampOrder, getRampOrder, updateRampOrderStatus } from "@/lib/ramp/rampOrder";
import { rampGuard, type RampAuth } from "@/lib/ramp/rampGuard";
import { verifyFurlBridgeWebhook } from "@/lib/ramp/webhookVerify";
import type { User } from "@/lib/store";

// Regression tests for the findings of the 2026-10-02 audit that held up
// against the code (PRODUCTION_READINESS_FINAL §19). Each failed before its fix.

const KEY = "partner-access-token-test";
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function jwt(claims: object) {
  const h = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = b64url(Buffer.from(JSON.stringify(claims)));
  return `${h}.${p}.${b64url(createHmac("sha256", KEY).update(`${h}.${p}`).digest())}`;
}
function body(wd: Record<string, unknown>, eventID: string) {
  return JSON.stringify({ data: jwt({ webhookData: wd, eventID, createdAt: new Date().toISOString() }) });
}
async function send(raw: string) {
  process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
  const { POST } = await import("@/app/api/webhooks/furlbridge/route");
  return POST(new NextRequest("http://localhost/api/webhooks/furlbridge", { method: "POST", body: raw }));
}
async function bridgeOrder() {
  const o = await createRampOrder({
    providerId: "furlbridge", direction: "onramp", flowKind: "hosted_checkout", statusFeed: true,
    userId: `u_${randomUUID()}`, fiatCurrency: "USD", fiatAmountMinor: 100, cryptoAsset: "USDC", chain: "base",
  });
  await updateRampOrderStatus(o.orderId, { to: "PAYMENT_PENDING", trigger: "system" });
  return o;
}

describe("C4: a late provider event after ABANDONED reaches a person", () => {
  it("moves ABANDONED -> MANUAL_REVIEW -> PAYMENT_CONFIRMED instead of being dropped", async () => {
    const o = await bridgeOrder();
    await updateRampOrderStatus(o.orderId, { to: "ABANDONED", trigger: "system" });
    const res = await send(body({ id: `trk_${randomUUID()}`, status: "PENDING_DELIVERY_FROM_TRANSAK", partnerOrderId: o.orderId }, "ORDER_PROCESSING"));
    expect(res.status).toBe(200);
    const after = await getRampOrder(o.orderId);
    expect(after?.statusHistory.map((h) => h.to)).toEqual(["PAYMENT_PENDING", "ABANDONED", "MANUAL_REVIEW", "PAYMENT_CONFIRMED"]);
  });

  it("a late failure for an abandoned order changes nothing", async () => {
    const o = await bridgeOrder();
    await updateRampOrderStatus(o.orderId, { to: "ABANDONED", trigger: "system" });
    await send(body({ id: `trk_${randomUUID()}`, status: "FAILED", partnerOrderId: o.orderId }, "ORDER_FAILED"));
    expect((await getRampOrder(o.orderId))?.status).toBe("ABANDONED");
  });
});

describe("H2: a crash mid-processing cannot swallow the provider's retries", () => {
  it("an in-flight claim answers 503 (retry later), not 'duplicate'", async () => {
    const o = await bridgeOrder();
    const trk = `trk_${randomUUID()}`;
    // Simulate a delivery that claimed the event and then died.
    await kvSetNx(`ramp:webhook:furlbridge:${trk}:ORDER_PROCESSING:PENDING_DELIVERY_FROM_TRANSAK`, "processing", 120);
    const res = await send(body({ id: trk, status: "PENDING_DELIVERY_FROM_TRANSAK", partnerOrderId: o.orderId }, "ORDER_PROCESSING"));
    expect(res.status).toBe(503);
    expect((await getRampOrder(o.orderId))?.status).toBe("PAYMENT_PENDING");
  });

  it("success leaves a long-lived 'done' marker", async () => {
    const o = await bridgeOrder();
    const trk = `trk_${randomUUID()}`;
    const raw = body({ id: trk, status: "PENDING_DELIVERY_FROM_TRANSAK", partnerOrderId: o.orderId }, "ORDER_PROCESSING");
    await send(raw);
    expect(await kvGet(`ramp:webhook:furlbridge:${trk}:ORDER_PROCESSING:PENDING_DELIVERY_FROM_TRANSAK`)).toBe("done");
    expect(await (await send(raw)).json()).toEqual({ received: true, duplicate: true });
  });
});

describe("H5: ids from a signed payload are still checked before use as keys", () => {
  it("refuses a malformed Transak id or partnerOrderId", () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    expect(() => verifyFurlBridgeWebhook(body({ id: "a:b:c", status: "COMPLETED" }, "ORDER_COMPLETED"))).toThrow(/malformed order id/);
    expect(() => verifyFurlBridgeWebhook(body({ id: "trk_1", status: "COMPLETED", partnerOrderId: "x:y" }, "ORDER_COMPLETED"))).toThrow(/partnerOrderId/);
  });
});

describe("C3: velocity is reserved atomically", () => {
  it("ten concurrent requests: exactly five pass the per-minute cap", async () => {
    const auth: RampAuth = { type: "partner", partnerId: `p_${randomUUID()}`, keyId: "k", partnerName: "Shop" };
    const req = () => new NextRequest("http://localhost/api/onramp/session", { method: "POST" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rampGuard({ req: req(), auth, direction: "onramp", flowType: "hosted", amountUsd: 10 }))
    );
    expect(results.filter((r) => r.pass)).toHaveLength(5);
  });
});

describe("velocity 'review' is no longer ignored", () => {
  const user = (): User => ({ id: `u_${randomUUID()}`, kycTier: 3 }) as User;
  const req = () => new NextRequest("http://localhost/api/offramp", { method: "POST" });

  it("server-initiated: over the daily volume needs a step-up even below $5,000 per transaction", async () => {
    const u = user();
    const auth: RampAuth = { type: "user", user: u, jti: randomUUID() };
    // $4,000 + $4,000 crosses the $5,000 daily cap.
    expect((await rampGuard({ req: req(), auth, direction: "offramp", flowType: "server-initiated", amountUsd: 4_000 })).pass).toBe(true);
    const second = await rampGuard({ req: req(), auth, direction: "offramp", flowType: "server-initiated", amountUsd: 4_000 });
    expect(second.pass).toBe(false);
    expect(second.pass === false && (await second.response.json()).error).toBe("step_up_required");
  });

  it("hosted: flagged for the provider, not blocked", async () => {
    const auth: RampAuth = { type: "user", user: user(), jti: randomUUID() };
    await rampGuard({ req: req(), auth, direction: "onramp", flowType: "hosted", amountUsd: 4_000 });
    const second = await rampGuard({ req: req(), auth, direction: "onramp", flowType: "hosted", amountUsd: 4_000 });
    expect(second.pass && second.meta.flags).toContain("velocity_review");
  });
});
