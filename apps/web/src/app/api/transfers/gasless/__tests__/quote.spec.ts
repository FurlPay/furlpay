import { describe, it, expect, afterEach, vi } from "vitest";

// Audit P3-5 (2026-10-05): the quote said `live: true` whenever a relayer was
// configured, but POST settles on-chain only under INTEGRATION_MODE=live — so
// a mock-mode deployment with a relayer made the app sign a real authorization
// that POST then "simulated". The app signs only when `live === true` and the
// quote is unexpired, so the quote must be exact about both.

const settler = vi.fn<() => unknown>(() => null);
vi.mock("@/lib/x402Settler", () => ({
  defaultSettler: () => settler(),
  SettlementPendingError: class extends Error {},
}));

import { GET } from "@/app/api/transfers/gasless/route";

afterEach(() => {
  vi.unstubAllEnvs();
  settler.mockReset().mockReturnValue(null);
});

async function quote() {
  const res = await GET();
  return (await res.json()) as { live: boolean; quotedAt: number; expiresAt: number };
}

describe("GET /api/transfers/gasless — live means POST will settle", () => {
  it("relayer configured but NOT live mode → live: false (POST would only simulate)", async () => {
    vi.stubEnv("INTEGRATION_MODE", "mock");
    settler.mockReturnValue(() => undefined);
    expect((await quote()).live).toBe(false);
  });

  it("live mode but no relayer → live: false (POST would 503)", async () => {
    vi.stubEnv("INTEGRATION_MODE", "live");
    expect((await quote()).live).toBe(false);
  });

  it("live mode AND a relayer → live: true", async () => {
    vi.stubEnv("INTEGRATION_MODE", "live");
    settler.mockReturnValue(() => undefined);
    expect((await quote()).live).toBe(true);
  });

  it("every quote carries a short expiry the client enforces", async () => {
    const q = await quote();
    expect(Number.isInteger(q.quotedAt)).toBe(true);
    expect(q.expiresAt - q.quotedAt).toBe(60);
  });
});
