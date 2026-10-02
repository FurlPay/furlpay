import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// Partner sessions need a configured hosted provider to create an order; the
// Coinbase module reads its credentials at import, so it is stood in for here.
const coinbaseOnrampUrl = vi.fn(async () => ({ provider: "coinbase" as const, url: "https://pay.coinbase.com/buy/select-asset?sessionToken=t", feeNote: "", expiresNote: "" }));
vi.mock("@/lib/services/coinbaseRamp", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/coinbaseRamp")>()),
  coinbaseRampBackend: "coinbase",
  coinbaseOnrampUrl,
}));

const { createApiKey, revokeApiKey } = await import("@/lib/apiKeys");
const { authenticateRampRequest, optionalRampAuth } = await import("@/lib/ramp/partnerAuth");
const { setRampEnabled, setPartnerWebhook, getPartnerConfig, publicPartnerConfig, PartnerWebhookKeyUnavailable } = await import("@/lib/ramp/partnerConfig");
const { deliverPartnerWebhook, signPartnerPayload } = await import("@/lib/ramp/partnerWebhooks");
const { getRampOrder } = await import("@/lib/ramp/rampOrder");

const ORIGIN = "https://shop.example";
const WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";

async function partnerKey(opts: { origins?: string[]; enabled?: boolean } = {}) {
  const partnerId = `m_${randomUUID()}`;
  const k = await createApiKey({
    userId: partnerId,
    name: "Shop checkout",
    prefix: "pk",
    environment: "test",
    scopes: ["payments:read"],
    originAllowlist: opts.origins ?? ["shop.example"],
  });
  if (opts.enabled ?? true) await setRampEnabled(partnerId, true, "ops_admin", "contract signed for test");
  return { partnerId, key: k.secret, keyId: k.record.keyId };
}

const req = (path: string, key?: string, origin = ORIGIN, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(origin ? { origin } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const saved = process.env.FURLPAY_PARTNER_WEBHOOK_KEY;
beforeEach(() => {
  process.env.FURLPAY_PARTNER_WEBHOOK_KEY = randomBytes(32).toString("base64");
});
afterEach(() => {
  if (saved === undefined) delete process.env.FURLPAY_PARTNER_WEBHOOK_KEY;
  else process.env.FURLPAY_PARTNER_WEBHOOK_KEY = saved;
});

describe("authenticateRampRequest", () => {
  it("is pinned to the shared helpers (the manifest validator relies on it)", () => {
    const src = readFileSync(join(__dirname, "..", "partnerAuth.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/await requireUser\(req\)/);
    expect(src).toMatch(/await requireApiKey\(req,/);
  });

  it("no credential at all is a 401", async () => {
    const r = await authenticateRampRequest(req("/api/onramp/session"), "session");
    expect(r.ok === false && r.res.status).toBe(401);
  });

  it("accepts an enabled, origin-pinned publishable key as the partner", async () => {
    const p = await partnerKey();
    const r = await authenticateRampRequest(req("/api/onramp/session", p.key), "session");
    expect(r.ok && r.auth).toEqual({ type: "partner", partnerId: p.partnerId, keyId: p.keyId, partnerName: "Shop checkout" });
  });

  it("refuses a key with no Origin allowlist", async () => {
    const p = await partnerKey({ origins: [] });
    const r = await authenticateRampRequest(req("/api/onramp/session", p.key), "session");
    expect(r.ok).toBe(false);
    expect(r.ok === false && (await r.res.json()).error).toBe("origin_allowlist_required");
  });

  it("refuses a key used from another site", async () => {
    const p = await partnerKey();
    const r = await authenticateRampRequest(req("/api/onramp/session", p.key, "https://evil.example"), "session");
    expect(r.ok === false && r.res.status).toBe(403);
  });

  it("refuses a partner ops has not enabled", async () => {
    const p = await partnerKey({ enabled: false });
    const r = await authenticateRampRequest(req("/api/onramp/session", p.key), "session");
    expect(r.ok === false && (await r.res.json()).error).toBe("ramp_not_enabled");
  });

  it("refuses a revoked key", async () => {
    const p = await partnerKey();
    await revokeApiKey(p.partnerId, p.keyId);
    const r = await authenticateRampRequest(req("/api/onramp/session", p.key), "session");
    expect(r.ok).toBe(false);
  });

  it("gives each key its own session budget (10/min)", async () => {
    const p = await partnerKey();
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await authenticateRampRequest(req("/api/onramp/session", p.key), "session"));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10].ok === false && results[10].res.status).toBe(429);
  });

  it("quotes stay public, but a presented key must be valid", async () => {
    expect(await optionalRampAuth(req("/api/onramp/quote"), "quote")).toEqual({ ok: true, auth: null });
    const bad = await optionalRampAuth(req("/api/onramp/quote", "pk_test_nokey_nosecret"), "quote");
    expect(bad.ok).toBe(false);
  });
});

describe("partner session creates a partner-owned order", () => {
  it("opens the hosted checkout without a FurlPay user and records partnerId", async () => {
    const p = await partnerKey();
    const { POST } = await import("@/app/api/onramp/session/route");
    const res = await POST(
      req("/api/onramp/session", p.key, ORIGIN, {
        fiatAmount: 50,
        fiatCurrency: "USD",
        token: "USDC",
        chain: "base",
        destinationAddress: WALLET,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const order = await getRampOrder(body.orderId);
    expect(order).toMatchObject({ partnerId: p.partnerId, providerId: "furlgateway", status: "PAYMENT_PENDING", flowKind: "hosted_checkout" });
    expect(order?.userId).toBeUndefined();
    // Coinbase sees our order id, never the partner's own user identifiers.
    expect(coinbaseOnrampUrl).toHaveBeenCalledWith(expect.objectContaining({ partnerUserRef: body.orderId }));
  });
});

describe("partner webhook secret and delivery", () => {
  it("returns the secret once and never stores or exposes it in clear", async () => {
    const id = `m_${randomUUID()}`;
    const { secret, config } = await setPartnerWebhook(id, "https://hooks.shop.example/furlpay");
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify(publicPartnerConfig(config))).not.toContain(secret);
    expect(JSON.stringify(await getPartnerConfig(id))).not.toContain(secret);
  });

  it("refuses to store a secret without the sealing key", async () => {
    delete process.env.FURLPAY_PARTNER_WEBHOOK_KEY;
    await expect(setPartnerWebhook(`m_${randomUUID()}`, "https://hooks.shop.example/x")).rejects.toBeInstanceOf(PartnerWebhookKeyUnavailable);
  });

  it("signs t.body with HMAC-SHA256 and delivers to the checked address", async () => {
    const partnerId = `m_${randomUUID()}`;
    const { secret } = await setPartnerWebhook(partnerId, "https://93.184.215.14/hook");
    const sent: { headers: Record<string, string>; body?: string; address: string }[] = [];
    const transport = (async (_url: URL, address: string, opts: { headers: Record<string, string>; body?: string }) => {
      sent.push({ headers: opts.headers, body: opts.body, address });
      return new Response("ok", { status: 200 });
    }) as never;
    const order = {
      orderId: randomUUID(), partnerId, status: "PAYMENT_CONFIRMED", direction: "onramp", fiatAmountMinor: 10000,
      fiatCurrency: "USD", cryptoAsset: "USDC", chain: "base",
    } as Parameters<typeof deliverPartnerWebhook>[0];

    expect(await deliverPartnerWebhook(order, transport)).toEqual({ delivered: true, status: 200 });
    const [{ headers, body, address }] = sent;
    expect(address).toBe("93.184.215.14");
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers["x-furlpay-signature"]);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(createHmac("sha256", secret).update(`${m![1]}.${body}`).digest("hex"));
    expect(signPartnerPayload(secret, body!, Number(m![1]))).toBe(headers["x-furlpay-signature"]);
    expect(JSON.parse(body!)).toMatchObject({ event: "ramp.order.updated", orderId: order.orderId, status: "PAYMENT_CONFIRMED", fiatAmount: 10000 });
  });

  it("never posts to a private address", async () => {
    const partnerId = `m_${randomUUID()}`;
    await setPartnerWebhook(partnerId, "https://169.254.169.254/latest");
    const transport = vi.fn();
    const order = { orderId: randomUUID(), partnerId, status: "FAILED", direction: "onramp", cryptoAsset: "USDC", chain: "base" } as Parameters<typeof deliverPartnerWebhook>[0];
    const r = await deliverPartnerWebhook(order, transport as never);
    expect(r.delivered).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
