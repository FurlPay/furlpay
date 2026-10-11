import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ requireApiKey: vi.fn(), createLink: vi.fn(), listMerchant: vi.fn(), paymentDetail: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/apiKeyAuth", () => ({ requireApiKey: h.requireApiKey }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/store", () => ({ getAccountDurable: h.account }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/payments/merchant/repository", async (orig) => ({ ...(await orig<object>()), createLink: h.createLink, listMerchant: h.listMerchant, paymentDetail: h.paymentDetail }));

import { GET, POST } from "../route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const key = (over = {}) => ({ ok: true, record: { keyId: "k1", userId: OWNER, prefix: "sk", environment: "live", scopes: ["payments:read", "payments:create"], ...over } });
const body = { requestId: "22222222-2222-4222-8222-222222222222", title: "Order 1", description: "", amount: "25", chains: ["base"], reusable: false, feePayer: "merchant", expiresAt: null, kind: "link", reference: "o-1", lines: [] };
const link = { id: body.requestId, merchant_id: OWNER, merchant_name: "Acme Ltd", slug: "s1", title: "Order 1", description: "", amount_units: "25000000", processing_bps: 75, fee_payer: "merchant", chains: ["base"], reusable: false, active: true, kind: "link", reference: "o-1", lines: [], expires_at: null, created_at: "x" };
const req = (method: string, payload?: unknown, qs = "") => new NextRequest(`http://localhost/api/v1/payment-links${qs}`, { method, headers: { authorization: "Bearer sk_live_x", "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.requireApiKey.mockResolvedValue(key());
  h.account.mockResolvedValue({ user: { name: "Acme Ltd" } });
  h.createLink.mockResolvedValue(link);
  h.listMerchant.mockResolvedValue({ links: [link], intents: [], limit: 500 });
});

describe("POST /api/v1/payment-links", () => {
  it("requires a LIVE key with payments:create (collection is mainnet-only)", async () => {
    await POST(req("POST", body));
    expect(h.requireApiKey).toHaveBeenCalledWith(expect.anything(), { scope: "payments:create", environment: "live" });
    h.requireApiKey.mockResolvedValue({ ok: false, res: NextResponse.json({ error: "wrong_environment" }, { status: 403 }) });
    expect((await POST(req("POST", body))).status).toBe(403);
  });
  it("creates under the key owner with the ACCOUNT's name, and returns the hosted URL", async () => {
    const res = await POST(req("POST", body));
    expect(res.status).toBe(201);
    expect(h.createLink).toHaveBeenCalledWith(OWNER, "Acme Ltd", expect.objectContaining({ requestId: body.requestId }));
    expect((await res.json()).link).toMatchObject({ id: body.requestId, url: "/p/s1", merchantName: "Acme Ltd" });
  });
  it("refuses a body that tries to set the merchant name or other unknown fields", async () => {
    expect((await POST(req("POST", { ...body, merchantName: "Amazon" }))).status).toBe(400);
    expect(h.createLink).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/payment-links", () => {
  it("lists only the key owner's links and payments", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(h.listMerchant).toHaveBeenCalledWith(OWNER);
    expect((await res.json()).links[0]).toMatchObject({ url: "/p/s1" });
  });
  it("refuses publishable keys: they are public by design", async () => {
    h.requireApiKey.mockResolvedValue(key({ prefix: "pk", scopes: ["payments:read"] }));
    expect((await GET(req("GET"))).status).toBe(403);
    expect(h.listMerchant).not.toHaveBeenCalled();
  });
  it("returns one payment scoped to the owner, 404 otherwise", async () => {
    h.paymentDetail.mockResolvedValue(null);
    expect((await GET(req("GET", undefined, "?id=33333333-3333-4333-8333-333333333333"))).status).toBe(404);
    expect(h.paymentDetail).toHaveBeenCalledWith(OWNER, "33333333-3333-4333-8333-333333333333");
    expect((await GET(req("GET", undefined, "?id=nope"))).status).toBe(400);
  });
});
