import { describe, expect, it, vi } from "vitest";

// Redis configured but unreachable. Before 2026-10-01 every call returned
// ok:true ("fail open"), so an outage removed every throttle at once: OTP,
// login, payments. It must now degrade to the bounded per-instance window.
vi.mock("../kv", () => ({
  kvBackend: "redis",
  kvIncr: vi.fn(async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:6379");
  }),
}));

import { limit } from "../rateLimit";

describe("rate limiting during a Redis outage", () => {
  it("still refuses once the limit is reached (no unlimited fail-open)", async () => {
    const key = `outage-${Math.random()}`;
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await limit(key, { limit: 3, windowMs: 60_000 }));
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results.slice(3).every((r) => !r.ok)).toBe(true);
    expect(results[5].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not take the endpoint down: the first requests are allowed", async () => {
    expect((await limit(`outage-${Math.random()}`, { limit: 5, windowMs: 1000 })).ok).toBe(true);
  });
});
