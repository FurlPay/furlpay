import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/x402Registry", () => ({
  findResource: () => ({ resource: "/api/x402/fx", method: "GET", priceUsd: 0.01, description: "fx" }),
}));

const { GET } = await import("@/app/api/x402/price/route");
const call = () => GET(new NextRequest("https://furlpay.test/api/x402/price?resource=/api/x402/fx"));

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/x402/price without a quote secret", () => {
  it("answers a structured 503 in production instead of throwing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "");
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("x402_not_configured");
  });

  it("quotes normally once the secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "a-real-quote-secret-of-at-least-32-chars");
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).accepts.length).toBeGreaterThan(0);
  });
});
