import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What happens to sensitive limits when the global counter store fails.
//
// 2026-10-02: production's Upstash database answered every command with
// 403 "This database has reached current Fixed plan limits". Per-instance
// fallback windows kept every endpoint up — and turned "5 OTPs per 10 minutes"
// into 5 per serverless instance. Sensitive buckets must refuse instead.
// ---------------------------------------------------------------------------

const QUOTA = 'kv redis error 403: {"error":"ERR This database has reached current Fixed plan limits."}';

vi.mock("../kv", async (orig) => {
  const real = await orig<typeof import("../kv")>();
  return {
    ...real,
    kvBackend: "redis",
    kvIncr: vi.fn(async () => {
      throw new real.KvError(QUOTA, "plan_limit", 403);
    }),
  };
});

const { classifyKvFailure, kvErrorCategory, KvError } = await import("../kv");
const { limit, failsClosed, rateLimitOr429 } = await import("../rateLimit");

describe("classifyKvFailure", () => {
  it("classifies the message production actually returned as a plan limit, not an outage", () => {
    expect(classifyKvFailure(403, "ERR This database has reached current Fixed plan limits.")).toBe("plan_limit");
  });

  it("separates the specific quotas when the provider names them", () => {
    expect(classifyKvFailure(400, "ERR max requests limit exceeded")).toBe("request_limit");
    expect(classifyKvFailure(400, "ERR max daily request limit exceeded")).toBe("request_limit");
    expect(classifyKvFailure(400, "ERR max monthly bandwidth limit exceeded")).toBe("bandwidth_limit");
    expect(classifyKvFailure(400, "ERR max db size limit exceeded")).toBe("storage_limit");
  });

  it("recognises auth failures and throttling", () => {
    expect(classifyKvFailure(401, "Unauthorized")).toBe("auth");
    expect(classifyKvFailure(400, "WRONGPASS invalid password")).toBe("auth");
    expect(classifyKvFailure(429, "Too Many Requests")).toBe("throttled");
  });

  it("does not guess", () => {
    expect(classifyKvFailure(500, "internal error")).toBe("unknown");
    expect(kvErrorCategory(new Error("plain"))).toBe("unknown");
    expect(kvErrorCategory(new KvError("x", "timeout", null))).toBe("timeout");
  });
});

describe("rate limits during a store outage", () => {
  it("lists the sensitive buckets as fail-closed and leaves reads alone", () => {
    for (const b of ["otp.start", "otp.check", "auth.passkey.authenticate", "payments.create", "v1.payments.execute",
      "wallets.transfer", "transfers-gasless", "transfers.sponsored", "offramp", "account.fund", "cards.reveal",
      "developer.keys.rotate", "p2p.orders.release", "x402.facilitator.settle",
      // Telegram Mini App sign-in and account linking
      "auth.telegram", "miniapp.telegram-link"]) {
      expect(failsClosed(b), b).toBe(true);
    }
    for (const b of ["markets.table", "markets.symbol", "travel.search", "insights", "payments.history",
      "payments.fees.estimate", "contact", "newsletter.subscribe", "auth.logout", "security.lock"]) {
      expect(failsClosed(b), b).toBe(false);
    }
  });

  it("refuses an OTP send on the FIRST request — no per-instance budget", async () => {
    const r = await limit(`otp.start:1.2.3.4:+6590000000`, { limit: 5, windowMs: 600_000 });
    expect(r.ok).toBe(false);
    expect(r.storeUnavailable).toBe(true);
  });

  it("answers 503 with Retry-After, not 429 — the client did nothing wrong", async () => {
    const res = await rateLimitOr429(undefined, "payments.create", { limit: 10, windowMs: 60_000 });
    expect(res?.status).toBe(503);
    expect(res?.headers.get("Retry-After")).toBe("30");
    expect(await res?.json()).toMatchObject({ error: "temporarily_unavailable" });
  });

  it("keeps public reads up on the per-instance window", async () => {
    const key = `markets.table:${Math.random()}:`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limit(key, { limit: 3, windowMs: 60_000 }));
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3].ok).toBe(false);
    expect(results[3].storeUnavailable).toBeUndefined();
  });
});
