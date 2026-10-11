import { afterEach, describe, expect, it, vi } from "vitest";

// Audit F-32: XSGD was priced with a hardcoded 0.78 USD/SGD whenever
// X402_XSGD_USD_RATE was unset, and advertised in every 402 in production.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const opts = { resource: "/api/x402/demo", method: "GET", priceUsd: 0.01, description: "demo" };

describe("XSGD is priced only from a configured, sane rate", () => {
  it("has no default rate", async () => {
    vi.stubEnv("X402_XSGD_USD_RATE", "");
    const { xsgdUsdRate } = await import("@/lib/x402");
    expect(xsgdUsdRate()).toBeNull();
  });

  it("refuses rates outside the 0.5-1.0 sanity band and non-numbers", async () => {
    const { xsgdUsdRate } = await import("@/lib/x402");
    for (const bad of ["0", "0.1", "1.5", "78", "abc", "NaN", "-0.78"]) {
      expect(xsgdUsdRate({ X402_XSGD_USD_RATE: bad } as unknown as NodeJS.ProcessEnv), bad).toBeNull();
    }
    expect(xsgdUsdRate({ X402_XSGD_USD_RATE: "0.74" } as unknown as NodeJS.ProcessEnv)).toBe(0.74);
  });

  it("advertises USDC only when no rate is configured", async () => {
    vi.stubEnv("X402_XSGD_USD_RATE", "");
    const { acceptedRequirements, USDC_ASSET } = await import("@/lib/x402");
    const accepts = acceptedRequirements(opts);
    expect(accepts).toHaveLength(1);
    expect(accepts[0].asset).toBe(USDC_ASSET);
  });

  it("advertises XSGD at the configured rate when one is set", async () => {
    vi.stubEnv("X402_XSGD_USD_RATE", "0.8");
    const { acceptedRequirements, xsgdOffered } = await import("@/lib/x402");
    if (!xsgdOffered()) return; // no XSGD deployment on the active network
    const xsgd = acceptedRequirements(opts).find((r) => r.extra.name === "XSGD");
    expect(xsgd?.maxAmountRequired).toBe(String(Math.round((0.01 / 0.8) * 1e6)));
  });
});
