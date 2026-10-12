// ---------------------------------------------------------------------------
// Money/auth hardening (audit 2026-10-12). Each test drives the REAL route
// handler and states the failure it prevents:
//
//   * one step-up authorized more than one payout / bank account when the
//     requests arrived together (check-then-delete);
//   * a public route created Stripe intents that accepted cards;
//   * callers with no account could open unlimited paid KYC sessions.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { DEMO_USER_ID } from "@/lib/store";
import { recordStepUp, recentStepUp } from "@/lib/stepup";

const stripeCreate = vi.fn(async (_args: Record<string, unknown>) => ({ id: "pi_test", client_secret: "pi_test_secret" }));
vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { create: stripeCreate };
  },
}));

const startVerification = vi.fn(async () => ({ sessionId: "sess_1", sessionUrl: "https://example.test/s" }));
vi.mock("@/lib/compliance/providers/factory", () => ({
  getIdentityProvider: async () => ({ name: "test-provider", startVerification }),
}));

async function session(): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await signSession({ sub: DEMO_USER_ID, safe: "0x0", roles: ["user"], jti });
  return { token, jti };
}

let ipSeq = 10;
function post(path: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // A fresh address per request so the per-IP limiter is not what is tested.
    "x-forwarded-for": `198.51.100.${ipSeq++ % 250}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("off-ramp: one step-up, one payout", () => {
  const body = { fromCurrency: "USD", toCurrency: "EUR", amount: 6000, execute: true };

  it("refuses a large payout with no step-up", async () => {
    const { POST } = await import("@/app/api/offramp/route");
    const s = await session();
    const res = await POST(post("/api/offramp", body, s.token));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("step_up_required");
  });

  it("two concurrent payouts on one step-up: exactly one goes through", async () => {
    const { POST } = await import("@/app/api/offramp/route");
    const s = await session();
    await recordStepUp(DEMO_USER_ID, s.jti, "otp");
    const results = await Promise.all([
      POST(post("/api/offramp", body, s.token)),
      POST(post("/api/offramp", body, s.token)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    const denied = results.find((r) => r.status === 401)!;
    expect((await denied.json()).error).toBe("step_up_required");
  });

  it("the step-up is spent: a later payout needs a new one", async () => {
    const { POST } = await import("@/app/api/offramp/route");
    const s = await session();
    await recordStepUp(DEMO_USER_ID, s.jti, "otp");
    expect((await POST(post("/api/offramp", body, s.token))).status).toBe(200);
    expect(await recentStepUp(DEMO_USER_ID, s.jti)).toBe(false);
    expect((await POST(post("/api/offramp", body, s.token))).status).toBe(401);
  });

  it("an unsupported currency pair is a 400, and spends nothing", async () => {
    const { POST } = await import("@/app/api/offramp/route");
    const s = await session();
    await recordStepUp(DEMO_USER_ID, s.jti, "otp");
    const res = await POST(post("/api/offramp", { ...body, fromCurrency: "USDC", toCurrency: "XXX", execute: false }, s.token));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_currency_pair");
    expect(await recentStepUp(DEMO_USER_ID, s.jti)).toBe(true);
  });

  it("a quote spends nothing", async () => {
    const { POST } = await import("@/app/api/offramp/route");
    const s = await session();
    await recordStepUp(DEMO_USER_ID, s.jti, "otp");
    const res = await POST(post("/api/offramp", { ...body, execute: false }, s.token));
    expect(res.status).toBe(200);
    expect(await recentStepUp(DEMO_USER_ID, s.jti)).toBe(true);
  });
});

describe("public Stripe intent: stablecoin only", () => {
  beforeEach(() => stripeCreate.mockClear());

  it("names crypto as the only payment method and never enables automatic methods", async () => {
    const { POST } = await import("@/app/api/payments/stripe/intent/route");
    const res = await POST(post("/api/payments/stripe/intent", { amountInCents: 2500 }));
    expect(res.status).toBe(200);
    expect(stripeCreate).toHaveBeenCalledTimes(1);
    const args = stripeCreate.mock.calls[0][0];
    expect(args.payment_method_types).toEqual(["crypto"]);
    expect(args).not.toHaveProperty("automatic_payment_methods");
    expect(args.currency).toBe("usd");
  });

  it("answers 502, with no detail, when Stripe refuses", async () => {
    stripeCreate.mockRejectedValueOnce(new Error("crypto is not enabled on this account"));
    const { POST } = await import("@/app/api/payments/stripe/intent/route");
    const res = await POST(post("/api/payments/stripe/intent", { amountInCents: 2500 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "payment_provider_error" });
  });
});

describe("anonymous KYC: an hourly ceiling across all addresses", () => {
  it("stops opening provider sessions once the ceiling is reached", async () => {
    process.env.KYC_ANON_SESSIONS_PER_HOUR = "3";
    vi.resetModules();
    const { POST } = await import("@/app/api/compliance/kyc/route");
    const kyc = { fullName: "Test Person", dateOfBirth: "1990-01-01", documentNumber: "X1234567", country: "GB" };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await POST(post("/api/compliance/kyc", kyc))).status);
    expect(statuses).toEqual([200, 200, 200, 503, 503]);
    expect(startVerification).toHaveBeenCalledTimes(3);
    delete process.env.KYC_ANON_SESSIONS_PER_HOUR;
  });
});

describe("MPP: one authorization nonce, however it is spelled", () => {
  async function credential(nonce: unknown): Promise<string> {
    const { buildChallenge, MPP_METHOD, MPP_INTENT } = await import("@/lib/mpp");
    const ch = buildChallenge({ realm: "test-realm", priceUsd: 0.01 });
    const param = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(ch.header)![1];
    const cred = {
      challenge: { id: ch.id, realm: "test-realm", method: MPP_METHOD, intent: MPP_INTENT, request: param("request"), expires: param("expires") },
      payload: {
        signature: "0x" + "ab".repeat(65),
        authorization: {
          from: "0xAbC0000000000000000000000000000000000001",
          to: ch.request.recipient,
          value: ch.request.maxAmountRequired,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 600),
          nonce,
        },
      },
    };
    return "Payment " + Buffer.from(JSON.stringify(cred)).toString("base64url");
  }
  const verify = async (nonce: unknown) => {
    const { verifyMppPayment } = await import("@/lib/mpp");
    return verifyMppPayment({ authorization: await credential(nonce), realm: "test-realm", priceUsd: 0.01 });
  };

  it("refuses a re-spelled nonce on a fresh challenge", async () => {
    const hex = randomUUID().replace(/-/g, "").repeat(2);
    expect((await verify("0x" + hex)).ok).toBe(true);
    for (const again of ["0x" + hex, hex, "0x" + hex.toUpperCase(), "0X" + hex]) {
      const r = await verify(again);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/already used/i);
    }
  });

  it("refuses a missing or malformed nonce instead of keying on it", async () => {
    for (const bad of [undefined, "", "0x1234", 42, "0x" + "zz".repeat(32)]) {
      const r = await verify(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem).toBe("malformed-credential");
    }
  });
});
