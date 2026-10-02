import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCircleComplianceCache,
  mapCircleDecision,
  screenAddressCircle,
} from "@/lib/services/circleCompliance";

// Circle Compliance Engine — response mapping and fail-closed behaviour, pinned
// to the shape in Circle's published OpenAPI (compliance.yaml):
// { result: APPROVED|DENIED, decision: { actions[], reasons[{riskScore, riskCategories}] } }.

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
  process.env.CIRCLE_COMPLIANCE_API_KEY = "TEST_API_KEY:id:secret";
  clearCircleComplianceCache();
});
afterEach(() => {
  delete process.env.CIRCLE_COMPLIANCE_API_KEY;
});

describe("mapCircleDecision", () => {
  it("APPROVED with APPROVE → allow", () => {
    const r = mapCircleDecision(ADDR, { result: "APPROVED", decision: { actions: ["APPROVE"], reasons: [] } });
    expect(r).toMatchObject({ action: "allow", provider: "circle", sanctioned: false, risk: "low" });
  });
  it("REVIEW action → review, not allow", () => {
    const r = mapCircleDecision(ADDR, {
      result: "APPROVED",
      decision: { actions: ["REVIEW"], reasons: [{ riskScore: "HIGH", riskCategories: ["GAMBLING"] }] },
    });
    expect(r).toMatchObject({ action: "review", risk: "high", score: 80, categories: ["gambling"] });
  });
  it.each([
    ["DENIED result", { result: "DENIED", decision: { actions: [], reasons: [] } }],
    ["DENY action", { result: "APPROVED", decision: { actions: ["DENY"], reasons: [] } }],
    ["FREEZE_WALLET action", { result: "APPROVED", decision: { actions: ["FREEZE_WALLET"], reasons: [] } }],
    ["sanctions category", { result: "APPROVED", decision: { actions: [], reasons: [{ riskCategories: ["SANCTIONS"] }] } }],
    ["BLOCKLIST score", { result: "APPROVED", decision: { actions: [], reasons: [{ riskScore: "BLOCKLIST" }] } }],
  ])("%s → block", (_n, body) => {
    expect(mapCircleDecision(ADDR, body as never)).toMatchObject({ action: "block", risk: "severe", score: 100 });
  });
  it("unknown result → null (caller fails closed)", () => {
    expect(mapCircleDecision(ADDR, { result: "MAYBE" })).toBeNull();
  });
});

describe("screenAddressCircle", () => {
  it("returns null when not configured — never calls Circle", async () => {
    delete process.env.CIRCLE_COMPLIANCE_API_KEY;
    const f = ok({});
    expect(await screenAddressCircle(ADDR, "ethereum", { fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("returns null for a chain Circle does not screen (Base)", async () => {
    const f = ok({});
    expect(await screenAddressCircle(ADDR, "base", { fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("sends the spec request and reads the data envelope", async () => {
    const f = ok({ data: { result: "APPROVED", decision: { actions: ["APPROVE"], reasons: [] } } });
    const r = await screenAddressCircle(ADDR, "arbitrum", { fetchImpl: f as never });
    expect(r?.action).toBe("allow");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.circle.com/v1/w3s/compliance/screening/addresses");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer TEST_API_KEY:id:secret");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ address: ADDR, chain: "ARB" });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("caches a verdict for the same chain+address", async () => {
    const f = ok({ result: "APPROVED", decision: { actions: ["APPROVE"], reasons: [] } });
    await screenAddressCircle(ADDR, "ethereum", { fetchImpl: f as never });
    await screenAddressCircle(ADDR.toUpperCase().replace("0X", "0x"), "ethereum", { fetchImpl: f as never });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["network error", vi.fn(async () => { throw new TypeError("fetch failed"); })],
    ["HTTP 500", vi.fn(async () => new Response("{}", { status: 500 }))],
    ["non-JSON", vi.fn(async () => new Response("<html>", { status: 200 }))],
    ["unexpected shape", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))],
  ])("%s → FAIL CLOSED (block, screening_unavailable)", async (_n, f) => {
    const r = await screenAddressCircle(ADDR, "ethereum", { fetchImpl: f as never });
    expect(r).toMatchObject({ action: "block", categories: ["screening_unavailable"] });
  });
});
