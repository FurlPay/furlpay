import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as restaurants } from "../restaurants/route";
import { GET as destination } from "../destinations/[slug]/route";
import { DELETE as alertsDelete, GET as alertsGet, POST as alertsPost } from "../alerts/route";
import { POST as book } from "../book/route";
import { POST as cancel } from "../cancel/[id]/route";
import { POST as giftBuy } from "../gift-cards/route";
import { POST as giftRedeem } from "../gift-cards/redeem/route";
import { findOrCreateUserByIdentity } from "@/lib/store";
import * as authz from "@/lib/authz";
import * as rateLimit from "@/lib/rateLimit";
import { getDestination } from "@/lib/travel/data";

// Zero-mock audit: routes that only had GENERATED content (restaurants,
// destination listings with invented prices) or an ownerless global store
// (price alerts, reachable anonymously under the public /api/travel prefix)
// do not serve it in production.

let ip = 0;
const req = (url: string, init: RequestInit = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { "x-real-ip": `192.0.2.${(ip++ % 200) + 1}`, ...(init.headers ?? {}) } });

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("production", () => {
  it("restaurant discovery answers 503 not_available, not generated venues", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await restaurants(req("/api/travel/restaurants?city=Lisbon"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("not_available");
  });

  it("destination pages keep curated facts but carry no invented prices", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const slug = ["lisbon", "tokyo", "bali", "dubai", "paris"].find((s) => getDestination(s)) ?? "";
    expect(slug).not.toBe("");
    const body = (await (await destination(req(`/api/travel/destinations/${slug}`), { params: Promise.resolve({ slug }) })).json()) as Record<string, unknown>;
    expect(body.topStays).toEqual([]);
    expect(body.topFlights).toEqual([]);
    expect(body.topActivities).toEqual([]);
    expect(body.listings).toBe("unavailable");
    expect(body.source).toBeUndefined();
  });

  it("price alerts cannot be listed, created or deleted anonymously", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await alertsGet()).status).toBe(503);
    const post = await alertsPost(req("/api/travel/alerts", { method: "POST", body: JSON.stringify({ to: "LIS", date: "2026-12-01", targetUsd: 100 }) }));
    expect(post.status).toBe(503);
    expect((await alertsDelete(req("/api/travel/alerts?id=alrt_x", { method: "DELETE" }))).status).toBe(503);
  });
});

describe("production: simulated booking is refused", () => {
  it("POST /api/travel/book answers 503 not_available; no trip, no confirmation", async () => {
    // Isolate the booking capability gate. Production's missing global limiter
    // now correctly refuses even sooner (covered by rateLimitMissingRedis.spec).
    vi.spyOn(rateLimit, "rateLimitOr429").mockResolvedValue(null);
    vi.stubEnv("NODE_ENV", "production");
    const res = await book(
      req("/api/travel/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subtotalUsd: 120, source: "travala", name: "Test stay", nights: 1, idempotencyKey: crypto.randomUUID() }),
      })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_available");
    expect(body.booking).toBeUndefined();
  });
});

describe("production: simulated cancellation and refund are refused", () => {
  it("POST /api/travel/cancel/:id with a valid session → 503, no 'Refunded' status", async () => {
    // Production auth resolves accounts durably; a resolved session is stubbed
    // so this exercises the cancellation gate, not the auth layer.
    const { account } = findOrCreateUserByIdentity({ email: `c-${crypto.randomUUID()}@example.test`, name: "C", authProvider: "email" } as never);
    const spy = vi.spyOn(authz, "requireUser").mockResolvedValue({ ok: true, account, claims: { sub: account.user.id } } as never);
    vi.stubEnv("NODE_ENV", "production");
    const res = await cancel(req("/api/travel/cancel/bk_x", { method: "POST" }), {
      params: Promise.resolve({ id: "bk_x" }),
    });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/Refunded/);
    spy.mockRestore();
  });
});

describe("production: gift cards cannot be issued or 'redeemed' for nothing", () => {
  it("purchase and redemption both answer 503; no code, no credit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const bought = await giftBuy(req("/api/travel/gift-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountUsd: 5000 }) }));
    expect(bought.status).toBe(503);
    expect(((await bought.json()) as Record<string, unknown>).giftCard).toBeUndefined();
    // Any well-formed unknown code used to "redeem" as a $50 credit.
    const redeemed = await giftRedeem(req("/api/travel/gift-cards/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "FURL-AAAA-BBBB-CCCC" }) }));
    expect(redeemed.status).toBe(503);
    expect(JSON.stringify(await redeemed.json())).not.toMatch(/credit added/);
  });

  it("redeem validates its body (AGENTS rule 1) in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await giftRedeem(req("/api/travel/gift-cards/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: 42 }) }));
    expect(res.status).toBe(400);
  });
});

describe("development keeps the demo behaviour", () => {
  it("restaurants still render locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await restaurants(req("/api/travel/restaurants?city=Lisbon"))).status).toBe(200);
  });
});
