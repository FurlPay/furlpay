import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// The ramp controls taken over from an unreviewed session on 2026-10-02
// (PRODUCTION_READINESS_FINAL §17). Each case pins a defect that was in the
// working tree: guards removed on the strength of a TODO, base64 called
// encryption, a substring name match, an invented webhook signature header,
// and every adapter declared healthy for holding an API key.

import { flagState } from "@/lib/flags";
import { rampEnv, rampAttribution } from "@/lib/providers/rampEnv";
import { verifyFurlBridgeWebhook, verifyHs256Jwt, WebhookSignatureError } from "@/lib/ramp/webhookVerify";
import {
  checkBeneficiaryEligibility,
  decryptField,
  encryptField,
  namesMatch,
  BeneficiaryEncryptionUnavailable,
} from "@/lib/ramp/beneficiary";
import { kvSet } from "@/lib/kv";

const ENV_KEYS = [
  "ONRAMP_LIVE",
  "OFFRAMP_LIVE",
  "FURLPAY_ONRAMP_PROVIDER",
  "FURLPAY_ONRAMP_PROVIDER_API_KEY",
  "FURLPAY_OFFRAMP_PROVIDER",
  "FURLPAY_OFFRAMP_PROVIDER_API_KEY",
  "FURLGATEWAY_API_KEY_ID",
  "CDP_API_KEY_ID",
  "FURLBRIDGE_ACCESS_TOKEN",
  "TRANSAK_ACCESS_TOKEN",
  "FURLPAY_BENEFICIARY_ENCRYPTION_KEY",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => ENV_KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() =>
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  })
);

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function jwt(claims: object, key: string, alg = "HS256"): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg, typ: "JWT" })));
  const p = b64url(Buffer.from(JSON.stringify(claims)));
  return `${h}.${p}.${b64url(createHmac("sha256", key).update(`${h}.${p}`).digest())}`;
}
const event = (overrides: object = {}) => ({
  webhookData: { id: `ord_${randomUUID()}`, status: "COMPLETED", partnerOrderId: "p1" },
  eventID: "ORDER_COMPLETED",
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("money flags stay off while the ramp paths are incomplete", () => {
  it.each(["ONRAMP_LIVE", "OFFRAMP_LIVE"] as const)("%s cannot be switched on by env", (flag) => {
    process.env[flag] = "1";
    process.env[flag.replace("_LIVE", "") === "ONRAMP" ? "FURLPAY_ONRAMP_PROVIDER" : "FURLPAY_OFFRAMP_PROVIDER"] = "x";
    process.env.FURLPAY_ONRAMP_PROVIDER_API_KEY = "x";
    process.env.FURLPAY_OFFRAMP_PROVIDER_API_KEY = "x";
    const state = flagState(flag);
    expect(state.on).toBe(false);
    expect(state.blocker?.reason).toBe("unimplemented");
  });
});

describe("internal partner names", () => {
  it("reads the internal name first and the vendor name as fallback", () => {
    delete process.env.FURLGATEWAY_API_KEY_ID;
    process.env.CDP_API_KEY_ID = "legacy";
    expect(rampEnv("FURLGATEWAY_API_KEY_ID")).toBe("legacy");
    process.env.FURLGATEWAY_API_KEY_ID = "new";
    expect(rampEnv("FURLGATEWAY_API_KEY_ID")).toBe("new");
  });

  it("does not let a blank internal name shadow a real legacy value", () => {
    process.env.FURLGATEWAY_API_KEY_ID = "  ";
    process.env.CDP_API_KEY_ID = "legacy";
    expect(rampEnv("FURLGATEWAY_API_KEY_ID")).toBe("legacy");
  });

  it("always attributes to the real company", () => {
    expect(rampAttribution("furlgateway")?.company).toBe("Coinbase");
    expect(rampAttribution("furlbridge")?.company).toBe("Transak");
    expect(rampAttribution("unknown")).toBeNull();
  });
});

describe("FurlBridge (Transak) webhook: HS256 JWT in the body", () => {
  const KEY = "partner-access-token-test";

  it("fails closed when the access token is unset", () => {
    delete process.env.FURLBRIDGE_ACCESS_TOKEN;
    delete process.env.TRANSAK_ACCESS_TOKEN;
    expect(() => verifyFurlBridgeWebhook(JSON.stringify({ data: jwt(event(), KEY) }))).toThrow(/fail closed/);
  });

  it("accepts a correctly signed, fresh event", () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const e = verifyFurlBridgeWebhook(JSON.stringify({ data: jwt(event(), KEY) }));
    expect(e.status).toBe("COMPLETED");
    expect(e.dedupeKey).toContain("ORDER_COMPLETED:COMPLETED");
  });

  it("rejects a token signed with another key", () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    expect(() => verifyFurlBridgeWebhook(JSON.stringify({ data: jwt(event(), "attacker") }))).toThrow(
      WebhookSignatureError
    );
  });

  it("refuses alg downgrade (none / anything but HS256)", () => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "none" })));
    const p = b64url(Buffer.from(JSON.stringify(event())));
    expect(() => verifyHs256Jwt("t", `${h}.${p}.`, KEY)).toThrow(/alg/);
    expect(() => verifyHs256Jwt("t", jwt(event(), KEY, "HS512"), KEY)).toThrow(/alg/);
  });

  it("refuses a replayed event older than the window", () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const old = event({ createdAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() });
    expect(() => verifyFurlBridgeWebhook(JSON.stringify({ data: jwt(old, KEY) }))).toThrow(/window/);
  });

  it("ignores the invented x-transak-signature header entirely", () => {
    // The earlier draft trusted an HMAC header Transak never sends. A raw body
    // with a header-only "signature" must not verify.
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const raw = JSON.stringify(event());
    expect(() => verifyFurlBridgeWebhook(raw)).toThrow(/missing data JWT/);
  });

  it("route: 401 on a bad signature, 200 once, then duplicate on retry", async () => {
    process.env.FURLBRIDGE_ACCESS_TOKEN = KEY;
    const { POST } = await import("@/app/api/webhooks/furlbridge/route");
    const send = (body: string) =>
      POST(new NextRequest("http://localhost/api/webhooks/furlbridge", { method: "POST", body }));

    expect((await send(JSON.stringify({ data: jwt(event(), "wrong") }))).status).toBe(401);

    const body = JSON.stringify({ data: jwt(event(), KEY) });
    const first = await send(body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    expect(await (await send(body)).json()).toEqual({ received: true, duplicate: true });
  });
});

describe("beneficiary storage is encrypted, not encoded", () => {
  const ACCOUNT = "123456789012";

  it("refuses to store anything without a 32-byte key", () => {
    delete process.env.FURLPAY_BENEFICIARY_ENCRYPTION_KEY;
    expect(() => encryptField(ACCOUNT, "ben_x")).toThrow(BeneficiaryEncryptionUnavailable);
    process.env.FURLPAY_BENEFICIARY_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptField(ACCOUNT, "ben_x")).toThrow(BeneficiaryEncryptionUnavailable);
  });

  it("round-trips, never contains the plaintext, and is bound to its record", () => {
    process.env.FURLPAY_BENEFICIARY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const ct = encryptField(ACCOUNT, "ben_a");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(Buffer.from(ct.slice(3), "base64").toString("latin1")).not.toContain(ACCOUNT);
    expect(ct).not.toBe(Buffer.from(ACCOUNT).toString("base64"));
    expect(decryptField(ct, "ben_a")).toBe(ACCOUNT);
    expect(() => decryptField(ct, "ben_b")).toThrow();
  });
});

describe("name match is token-based", () => {
  it.each([
    ["Priya K Sharma", "Priya Sharma", true],
    ["SHARMA PRIYA", "Priya Sharma", true],
    ["José Álvarez", "Jose Alvarez", true],
    ["Alice Smith", "Al", false],
    ["Alice Smith", "", false],
    ["Sharma", "Priya Sharma", false],
    ["Rahul Sharma", "Priya Sharma", false],
  ])("%j vs KYC %j → %s", (bank, kyc, expected) => {
    expect(namesMatch(bank, kyc)).toBe(expected);
  });
});

describe("beneficiary eligibility checks ownership", () => {
  it("another user's active account is 'not found', not payable", async () => {
    const id = `ben_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await kvSet(`beneficiary:${id}`, {
      id,
      userId: "owner",
      status: "active",
      lastPayoutAt: null,
    });
    expect(await checkBeneficiaryEligibility(id, "owner")).toEqual({ eligible: true });
    expect(await checkBeneficiaryEligibility(id, "attacker")).toEqual({
      eligible: false,
      reason: "Beneficiary not found.",
    });
  });
});

describe("routes", () => {
  async function bearer() {
    const { signSession } = await import("@/lib/session");
    const { findOrCreateUserByIdentity } = await import("@/lib/store");
    const { account } = findOrCreateUserByIdentity({ email: `ramp-${randomUUID()}@furlpay.test`, name: "Ramp User" });
    const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
    return { account, auth: `Bearer ${token}` };
  }

  it("beneficiary POST refuses before reading any account number", async () => {
    const { POST } = await import("@/app/api/offramp/beneficiary/route");
    const { auth } = await bearer();
    const res = await POST(
      new NextRequest("http://localhost/api/offramp/beneficiary", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ accountHolderName: "A B", accountNumber: "123456789", country: "IN", currency: "INR" }),
      })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("beneficiary_verification_unavailable");
  });

  it("beneficiary GET says adding is unavailable", async () => {
    const { GET } = await import("@/app/api/offramp/beneficiary/route");
    const { auth } = await bearer();
    const res = await GET(new NextRequest("http://localhost/api/offramp/beneficiary", { headers: { authorization: auth } }));
    expect(await res.json()).toEqual({ available: false, beneficiaries: [] });
  });

  const quoteBody = JSON.stringify({ fiatAmount: 1000, fiatCurrency: "INR", token: "USDC", chain: "base" });

  it("quote: production with no provider refuses instead of pricing ₹ at 1:1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { POST } = await import("@/app/api/onramp/quote/route");
      const res = await POST(new NextRequest("http://localhost/api/onramp/quote", { method: "POST", body: quoteBody }));
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("quote: outside production the demo schedule is labelled as such", async () => {
    const { POST } = await import("@/app/api/onramp/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/onramp/quote", { method: "POST", body: quoteBody }));
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("demo_schedule");
  });

  it("session: production with no provider refuses instead of minting an unpayable checkout", async () => {
    const { auth, account } = await bearer();
    account.user.kycTier = 1;
    // Production auth needs the hosted session store; stand in for it so the
    // test reaches the provider gate, which is what is under test.
    vi.resetModules();
    vi.doMock("@/lib/authz", async (orig) => ({
      ...(await orig<typeof import("@/lib/authz")>()),
      requireUser: async () => ({ ok: true, account, claims: { jti: "t" } }),
    }));
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { POST } = await import("@/app/api/onramp/session/route");
      const res = await POST(
        new NextRequest("http://localhost/api/onramp/session", {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify({
            fiatAmount: 50,
            fiatCurrency: "USD",
            token: "USDC",
            chain: "base",
            destinationAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
          }),
        })
      );
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock("@/lib/authz");
    }
  });

  it("registration never declares health and never registers FurlPayout", async () => {
    vi.resetModules();
    process.env.FURLGATEWAY_API_KEY_ID = "id";
    process.env.FURLGATEWAY_API_KEY_SECRET = "secret";
    const router = await import("@/lib/providers/router");
    const { registerProviders } = await import("@/lib/providers/register");
    registerProviders();
    expect(router.providerRegistry.get("onramp", "furlgateway")).toBeDefined();
    expect(router.providerRegistry.get("offramp", "furlpayout")).toBeUndefined();
    expect(router.getProviderHealth("onramp", "furlgateway").state).toBe("unknown");
    delete process.env.FURLGATEWAY_API_KEY_SECRET;
  });
});

describe("adapters declare who runs the checkout", () => {
  it("hosted = provider page and provider KYC; server-initiated = FurlPay funds it", async () => {
    const { furlgatewayOnrampAdapter } = await import("@/lib/providers/adapters/furlgateway-onramp");
    const { furlgatewayOfframpAdapter } = await import("@/lib/providers/adapters/furlgateway-offramp");
    const { furlbridgeOnramp } = await import("@/lib/providers/adapters/furlbridge-onramp");
    const { furlbridgeOfframp } = await import("@/lib/providers/adapters/furlbridge-offramp");
    const { furlpayoutOfframp } = await import("@/lib/providers/adapters/furlpayout-offramp");
    expect(furlgatewayOnrampAdapter.hasHostedCheckout).toBe(true);
    expect(furlgatewayOfframpAdapter.hasHostedCheckout).toBe(true);
    expect(furlbridgeOnramp.hasHostedCheckout).toBe(true);
    expect(furlbridgeOfframp.hasHostedCheckout).toBe(false);
    expect(furlpayoutOfframp.hasHostedCheckout).toBe(false);
  });
});
