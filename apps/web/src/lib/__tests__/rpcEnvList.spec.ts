import { afterEach, describe, expect, it, vi } from "vitest";

// ARC-P3-002: one env contract for RPC endpoints. The merchant reader takes
// ARC_RPC_URL as a comma-separated failover list (endpointsFor); every other
// reader of the same variable must agree, or adding a backup provider for
// collection breaks x402 settlement, the chain registry and the Arc rail.
const A = "https://arc-a.example/rpc", B = "https://arc-b.example/rpc";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("comma-separated RPC lists are read the same everywhere", () => {
  it("x402Chains: every listed endpoint, then the _FALLBACK", async () => {
    vi.stubEnv("ARC_RPC_URL", `${A}, ${B}`); vi.stubEnv("ARC_RPC_URL_FALLBACK", "https://arc-c.example/rpc");
    const x = await import("@/lib/x402Chains");
    expect(x.rpcUrls("arc")).toEqual([A, B, "https://arc-c.example/rpc"]);
    expect(x.rpcUrl("arc")).toBe(A);
  });
  it("chainRegistry: the first listed endpoint, never the raw list", async () => {
    vi.stubEnv("ARC_RPC_URL", `${A},${B}`); vi.stubEnv("BASE_RPC_URL", `${B},${A}`);
    const r = await import("@/lib/services/chainRegistry");
    expect(r.getChain("arc")?.rpcUrl).toBe(A);
    expect(r.getChain("base")?.rpcUrl).toBe(B);
  });
  it("merchant reader and x402 agree on the same value", async () => {
    vi.stubEnv("ARC_RPC_URL", `${A},${B}`);
    const [{ endpointsFor }, x] = await Promise.all([import("@/lib/payments/merchant/rpc"), import("@/lib/x402Chains")]);
    expect(endpointsFor("arc").slice(0, 2)).toEqual(x.rpcUrls("arc"));
  });
  it("ignores entries that are not https (or local http)", async () => {
    vi.stubEnv("ARC_RPC_URL", `ftp://x, ${A}`);
    const x = await import("@/lib/x402Chains");
    expect(x.rpcUrls("arc")).toEqual([A]);
  });
});
