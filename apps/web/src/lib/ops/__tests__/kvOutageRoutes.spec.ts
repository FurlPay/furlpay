// Regression: production 500s on /api/rails and /api/x402/fx (6 Oct 2026).
//
// furlpay.com's KV store (Upstash) answered every command with
//   403 "ERR This database has reached current Fixed plan limits"
// and the pause-flag read in lib/ops/controls.ts let that KvError escape both
// routes as a bare 500. These tests reproduce it with the real KvError class.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const kvState = { fail: false, store: new Map<string, unknown>() };

vi.mock("@/lib/kv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kv")>();
  const planLimit = () =>
    new actual.KvError(
      'kv redis error 403: {"error":"ERR This database has reached current Fixed plan limits"}',
      "plan_limit",
      403
    );
  return {
    ...actual,
    kvGet: vi.fn(async (k: string) => {
      if (kvState.fail) throw planLimit();
      return kvState.store.get(k) ?? null;
    }),
    kvSet: vi.fn(async (k: string, v: unknown) => {
      if (kvState.fail) throw planLimit();
      kvState.store.set(k, v);
    }),
    kvDel: vi.fn(async (k: string) => {
      if (kvState.fail) throw planLimit();
      kvState.store.delete(k);
    }),
    kvListPush: vi.fn(async () => {
      if (kvState.fail) throw planLimit();
    }),
    kvIncrBy: vi.fn(async () => {
      if (kvState.fail) throw planLimit();
      return 1;
    }),
  };
});
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const rails = await import("@/app/api/rails/route");
const fx = await import("@/app/api/x402/fx/route");
const controls = await import("@/lib/ops/controls");

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });
const FX = "https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=100";

beforeEach(() => {
  kvState.fail = false;
  kvState.store.clear();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/rails", () => {
  it("serves the rail directory with live status when the store is healthy", async () => {
    const res = await rails.GET(req("https://furlpay.com/api/rails"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(body.rails.length);
    expect(body.count).toBeGreaterThan(0);
    for (const r of body.rails) expect(typeof r.status).toBe("string");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });

  it("reports a paused rail as PAUSED", async () => {
    await controls.setRailPause("x402", true, "test", "drill");
    const body = await (await rails.GET(req("https://furlpay.com/api/rails"))).json();
    const x402 = body.rails.find((r: { rail: string }) => r.rail === "x402");
    expect(x402.status).toBe("PAUSED");
  });

  it("an empty store (no flags, no health) reports nothing as HEALTHY", async () => {
    const body = await (await rails.GET(req("https://furlpay.com/api/rails"))).json();
    for (const r of body.rails) expect(r.status).not.toBe("HEALTHY");
  });

  it("REPRODUCTION: a store outage is a structured, retryable 503 — not a bare 500, not guessed statuses", async () => {
    kvState.fail = true;
    const res = await rails.GET(req("https://furlpay.com/api/rails"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("controls_unavailable");
    expect(body.error.reason).toBe("plan_limit");
    expect(body.rails).toBeUndefined(); // no directory with invented statuses
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toMatch(/Fixed plan|redis error/); // no upstream internals leaked
  });

  it("is public: no credentials needed", async () => {
    const res = await rails.GET(req("https://furlpay.com/api/rails"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/x402/fx", () => {
  it("quotes a valid USD->EUR request with a 402 challenge", async () => {
    const res = await fx.GET(req(FX));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("REPRODUCTION: a store outage fails closed with a structured 503 — no quote while the pause is unreadable", async () => {
    kvState.fail = true;
    for (const headers of [{}, { "X-PAYMENT": "eyJ4NDAyVmVyc2lvbiI6MX0=" }]) {
      const res = await fx.GET(req(FX, headers));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("controls_unavailable");
    }
  });

  it("the outage answer is retryable and leaks nothing", async () => {
    kvState.fail = true;
    const res = await fx.GET(req(FX, { "X-PAYMENT": "eyJ4NDAyVmVyc2lvbiI6MX0=" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("controls_unavailable");
    expect(body.error.reason).toBe("plan_limit");
    expect(res.headers.get("retry-after")).toBe("30");
    expect(JSON.stringify(body)).not.toMatch(/Fixed plan|redis error/); // no upstream internals leaked
  });

  it("a paused rail refuses with rail_paused", async () => {
    await controls.setRailPause("x402", true, "test", "drill");
    const res = await fx.GET(req(FX));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("rail_paused");
  });

  it("rejects invalid amounts", async () => {
    for (const a of ["-5", "0", "abc", "1e12"]) {
      const res = await fx.GET(req(`https://furlpay.com/api/x402/fx?from=USD&to=EUR&amount=${a}`));
      expect(res.status).toBe(400);
    }
  });

  it("rejects a currency it cannot price BEFORE quoting (no charge for an unanswerable quote)", async () => {
    for (const q of ["from=USD&to=XYZ", "from=ABC&to=EUR", "from=US%24&to=EUR"]) {
      const res = await fx.GET(req(`https://furlpay.com/api/x402/fx?${q}&amount=100`));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Unsupported currency");
    }
  });
});

describe("railControlState", () => {
  it("never reports an unreadable store as active", async () => {
    kvState.fail = true;
    const s = await controls.railControlState("x402");
    expect(s).toEqual({ kind: "unknown", reason: "plan_limit" });
  });
  it("railPaused still THROWS on a store error (settlementGuard fails closed on it)", async () => {
    kvState.fail = true;
    await expect(controls.railPaused("x402")).rejects.toThrow();
  });
});
