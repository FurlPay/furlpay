import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as restaurants } from "../restaurants/route";
import { GET as destination } from "../destinations/[slug]/route";
import { DELETE as alertsDelete, GET as alertsGet, POST as alertsPost } from "../alerts/route";
import { getDestination } from "@/lib/travel/data";

// Zero-mock audit: routes that only had GENERATED content (restaurants,
// destination listings with invented prices) or an ownerless global store
// (price alerts, reachable anonymously under the public /api/travel prefix)
// do not serve it in production.

let ip = 0;
const req = (url: string, init: RequestInit = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { "x-real-ip": `192.0.2.${(ip++ % 200) + 1}`, ...(init.headers ?? {}) } });

afterEach(() => vi.unstubAllEnvs());

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

describe("development keeps the demo behaviour", () => {
  it("restaurants still render locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await restaurants(req("/api/travel/restaurants?city=Lisbon"))).status).toBe(200);
  });
});
