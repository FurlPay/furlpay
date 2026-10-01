import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { publicPaymentView, type PaymentRecord } from "../services/payments";
import { createOnrampSession } from "../services/onramp";
import { requireOperator } from "../complianceOperator";
import { isGooglePhotoHost } from "../hotels/googlePlaces";
import { GET as onrampSessionGET } from "../../app/api/onramp/session/[id]/route";
import { GET as instagramGET } from "../../app/api/ambassadors/instagram/route";

// EXHAUSTIVE_SECURITY_REMEDIATION.md ES-07 … ES-11.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ES-07 payment view exposes no internals", () => {
  it("omits nonce, idempotency key, owners, block reason and ledger ids", () => {
    const view = publicPaymentView({
      id: "pay_1", status: "settled", amountUsdc: 5, feeUsdc: 0.01, sourceChain: "base", settlementChain: "base",
      recipient: "0x" + "a".repeat(40), createdByUserId: "u_secret", payerUserId: "u_payer", nonce: "n_secret",
      idempotencyKey: "idem_secret", createdAt: "2026-09-30T00:00:00Z", expiresAt: "2026-09-30T01:00:00Z",
      blockedReason: "internal", metadata: { k: "v" },
    } as PaymentRecord);
    const json = JSON.stringify(view);
    for (const leak of ["u_secret", "u_payer", "n_secret", "idem_secret", "internal", "metadata"]) expect(json).not.toContain(leak);
    expect(view.id).toBe("pay_1");
  });
});

describe("ES-08 onramp poll never returns the client secret", () => {
  it("GET /api/onramp/session/:id strips clientSecret", async () => {
    const s = createOnrampSession({ fiatAmount: 50, fiatCurrency: "USD", token: "USDC", chain: "base", paymentMethod: "card", destinationAddress: "0x" + "b".repeat(40) });
    const res = await onrampSessionGET(new NextRequest(`http://localhost/api/onramp/session/${s.id}`), { params: Promise.resolve({ id: s.id }) });
    const body = await res.json();
    expect(body.id).toBe(s.id);
    expect(body.clientSecret).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(s.clientSecret);
  });
});

describe("ES-09 operator bearer", () => {
  const req = (auth?: string) => new NextRequest("http://localhost/x", { headers: auth ? { authorization: auth } : {} });
  it("accepts only the exact token; unset token disables", () => {
    vi.stubEnv("FURLPAY_COMPLIANCE_OPERATOR_TOKEN", "op-token-123");
    expect(requireOperator(req("Bearer op-token-123"))).toBeNull();
    expect(requireOperator(req("Bearer op-token-124"))?.status).toBe(401);
    expect(requireOperator(req("Bearer op-token-12"))?.status).toBe(401);
    expect(requireOperator(req())?.status).toBe(401);
    vi.stubEnv("FURLPAY_COMPLIANCE_OPERATOR_TOKEN", "");
    expect(requireOperator(req("Bearer "))?.status).toBe(403);
  });
});

describe("ES-10 no fabricated Instagram profile in production", () => {
  it("returns 503 profile_unavailable when the Graph API is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IG_ACCESS_TOKEN", "");
    vi.stubEnv("IG_USER_ID", "");
    const res = await instagramGET(new NextRequest("http://localhost/api/ambassadors/instagram?handle=someone"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("profile_unavailable");
  });
});

describe("ES-11 photo host pin", () => {
  it.each([
    ["https://lh3.googleusercontent.com/p/abc", true],
    ["http://lh3.googleusercontent.com/p/abc", false],
    ["https://googleusercontent.com.evil.example/p", false],
    ["https://evilgoogleusercontent.com/p", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["not a url", false],
  ])("%s → %s", (url, ok) => {
    expect(isGooglePhotoHost(url)).toBe(ok);
  });
});
