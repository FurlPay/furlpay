// ---------------------------------------------------------------------------
// Tests for @furlpay/rate-limit
// ---------------------------------------------------------------------------

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  rateLimit,
  rateLimitHeaders,
  rateLimitResponse,
  routeRateLimit,
  MemoryRateLimitStore,
  PRESETS,
  FURLPAY_ROUTE_LIMITS,
} from "../index.js";
import type { RateLimitRequest } from "../index.js";

function makeReq(overrides?: Partial<RateLimitRequest>): RateLimitRequest {
  return {
    ip: "127.0.0.1",
    path: "/api/test",
    method: "GET",
    headers: {},
    ...overrides,
  };
}

// ── Core rate limiter ───────────────────────────────────────────────────────

describe("rateLimit", () => {
  it("allows requests within the limit", async () => {
    const limiter = rateLimit({ limit: 3, windowSeconds: 60 });
    const req = makeReq();

    const r1 = await limiter(req);
    assert.equal(r1.allowed, true);
    assert.equal(r1.info.remaining, 2);

    const r2 = await limiter(req);
    assert.equal(r2.allowed, true);
    assert.equal(r2.info.remaining, 1);

    const r3 = await limiter(req);
    assert.equal(r3.allowed, true);
    assert.equal(r3.info.remaining, 0);
  });

  it("blocks requests exceeding the limit", async () => {
    const limiter = rateLimit({ limit: 2, windowSeconds: 60 });
    const req = makeReq();

    await limiter(req);
    await limiter(req);
    const r3 = await limiter(req);

    assert.equal(r3.allowed, false);
    assert.equal(r3.info.remaining, 0);
    assert.ok(r3.info.retryAfter > 0);
  });

  it("tracks different IPs separately", async () => {
    const limiter = rateLimit({ limit: 1, windowSeconds: 60 });

    const r1 = await limiter(makeReq({ ip: "1.1.1.1" }));
    const r2 = await limiter(makeReq({ ip: "2.2.2.2" }));

    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, true);
  });

  it("respects the skip function", async () => {
    const limiter = rateLimit({
      limit: 1,
      windowSeconds: 60,
      skip: (req) => req.path === "/api/health",
    });

    await limiter(makeReq({ path: "/api/health" }));
    await limiter(makeReq({ path: "/api/health" }));
    const r = await limiter(makeReq({ path: "/api/health" }));

    assert.equal(r.allowed, true); // skipped, always allowed
  });

  it("supports custom key generators", async () => {
    const limiter = rateLimit({
      limit: 1,
      windowSeconds: 60,
      keyGenerator: (req) => req.userId ?? req.ip,
    });

    const r1 = await limiter(makeReq({ userId: "user_123" }));
    const r2 = await limiter(makeReq({ userId: "user_123", ip: "different.ip" }));

    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, false); // same userId, different IP
  });
});

// ── Memory store ────────────────────────────────────────────────────────────

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;

  afterEach(() => {
    store?.destroy();
  });

  it("increments correctly", async () => {
    store = new MemoryRateLimitStore();
    const r1 = await store.increment("test", 60);
    assert.equal(r1.count, 1);

    const r2 = await store.increment("test", 60);
    assert.equal(r2.count, 2);
  });

  it("peek returns null for unknown keys", async () => {
    store = new MemoryRateLimitStore();
    const result = await store.peek("nonexistent");
    assert.equal(result, null);
  });

  it("peek returns current state", async () => {
    store = new MemoryRateLimitStore();
    await store.increment("peek-test", 60);
    await store.increment("peek-test", 60);

    const result = await store.peek("peek-test");
    assert.ok(result);
    assert.equal(result!.count, 2);
  });
});

// ── HTTP helpers ────────────────────────────────────────────────────────────

describe("rateLimitHeaders", () => {
  it("includes all standard headers", () => {
    const headers = rateLimitHeaders({
      limit: 100,
      remaining: 50,
      resetAt: 1700000060,
      retryAfter: 0,
    });

    assert.equal(headers["X-RateLimit-Limit"], "100");
    assert.equal(headers["X-RateLimit-Remaining"], "50");
    assert.equal(headers["X-RateLimit-Reset"], "1700000060");
    assert.equal(headers["Retry-After"], undefined);
  });

  it("includes Retry-After when rate limited", () => {
    const headers = rateLimitHeaders({
      limit: 10,
      remaining: 0,
      resetAt: 1700000060,
      retryAfter: 30,
    });

    assert.equal(headers["Retry-After"], "30");
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 response", () => {
    const res = rateLimitResponse({
      limit: 10,
      remaining: 0,
      resetAt: 1700000060,
      retryAfter: 30,
    });

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Content-Type"), "application/json");
    assert.equal(res.headers.get("Retry-After"), "30");
  });
});

// ── Route-specific rate limiting ────────────────────────────────────────────

describe("routeRateLimit", () => {
  it("applies specific limits to matching routes", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = routeRateLimit(
      { "/api/auth": { limit: 1, windowSeconds: 60 } },
      { limit: 100, windowSeconds: 60 },
      store
    );

    const r1 = await limiter(makeReq({ path: "/api/auth/login" }));
    assert.equal(r1.allowed, true);

    const r2 = await limiter(makeReq({ path: "/api/auth/login" }));
    assert.equal(r2.allowed, false);

    // Different route gets the default limit (100)
    const r3 = await limiter(makeReq({ path: "/api/data" }));
    assert.equal(r3.allowed, true);

    store.destroy();
  });
});

// ── Presets ──────────────────────────────────────────────────────────────────

describe("Presets", () => {
  it("all presets have valid configs", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      assert.ok(preset.limit > 0, `${name}.limit must be positive`);
      assert.ok(preset.windowSeconds > 0, `${name}.windowSeconds must be positive`);
      assert.ok(
        ["sliding-window", "fixed-window", "token-bucket"].includes(preset.algorithm),
        `${name}.algorithm must be valid`
      );
    }
  });

  it("FURLPAY_ROUTE_LIMITS has entries", () => {
    assert.ok(Object.keys(FURLPAY_ROUTE_LIMITS).length > 0);
  });
});
