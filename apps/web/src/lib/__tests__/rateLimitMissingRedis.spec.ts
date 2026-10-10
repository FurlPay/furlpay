import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../kv", () => ({ kvBackend: "memory", kvErrorCategory: () => "unknown", kvIncr: vi.fn() }));
import { limit, rateLimitOr429 } from "../rateLimit";

afterEach(() => vi.unstubAllEnvs());

describe("missing global limiter configuration", () => {
  it.each(["auth.telegram", "miniapp.telegram-link", "otp.start", "payments.create"])("refuses %s in production before granting even one request", async bucket => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await rateLimitOr429(undefined, bucket, { limit: 5, windowMs: 60_000 });
    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("30");
    expect(await response?.json()).toMatchObject({ error: "temporarily_unavailable" });
  });
  it("keeps a bounded development fallback and a bounded public-read fallback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const options = { limit: 1, windowMs: 60_000 };
    expect((await limit("auth.telegram:local-test", options)).ok).toBe(true);
    expect((await limit("auth.telegram:local-test", options)).ok).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect((await limit("markets.table:local-test", options)).ok).toBe(true);
    expect((await limit("markets.table:local-test", options)).ok).toBe(false);
  });
});
