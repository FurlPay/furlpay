// GET /api/travel/hotels/map with near=&radiusKm= — the server-side circle.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { haversineKm } from "@/lib/geo/geodesy";

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
// No network: OpenStreetMap answers nothing, so only curated/Google remain.
vi.mock("@/lib/travel/osmHotels", () => ({ osmHotelsInBBox: vi.fn(async () => []), bboxTooLarge: () => false }));

const { GET } = await import("@/app/api/travel/hotels/map/route");

const TOKYO = { latitude: 35.6812, longitude: 139.7671 };
const call = async (qs: string) => {
  const res = await GET(new NextRequest(`https://furlpay.com/api/travel/hotels/map?${qs}`));
  return { status: res.status, body: await res.json() };
};

describe("radius search", () => {
  it("returns only hotels inside the circle, never clustered, and echoes the circle", async () => {
    const all = await call("bbox=139.55,35.55,139.95,35.80&z=11");
    const near = await call("bbox=139.55,35.55,139.95,35.80&z=11&near=35.6812,139.7671&radiusKm=1");
    expect(all.status).toBe(200);
    expect(near.status).toBe(200);
    expect(near.body.radius).toEqual({ latitude: 35.6812, longitude: 139.7671, km: 1 });
    expect(near.body.clusters).toEqual([]);
    for (const p of near.body.points) expect(haversineKm(TOKYO, p)).toBeLessThanOrEqual(1);
    // The circle really narrowed the answer: hotels further than 1 km existed.
    const outside = all.body.points.filter((p: { latitude: number; longitude: number }) => haversineKm(TOKYO, p) > 1);
    expect(outside.length).toBeGreaterThan(0);
    expect(near.body.points.length).toBeLessThan(all.body.points.length);
  });

  it("narrows to a drawn area, and refuses a malformed one", async () => {
    // A small box around the Marunouchi/Ginza hotels.
    const ring = "139.755,35.670;139.775,35.670;139.775,35.690;139.755,35.690";
    const r = await call(`bbox=139.55,35.55,139.95,35.80&z=11&area=${ring}`);
    expect(r.status).toBe(200);
    expect(r.body.area).toEqual({ vertices: 4 });
    expect(r.body.clusters).toEqual([]);
    for (const p of r.body.points) {
      expect(p.longitude).toBeGreaterThanOrEqual(139.755);
      expect(p.longitude).toBeLessThanOrEqual(139.775);
      expect(p.latitude).toBeGreaterThanOrEqual(35.67);
      expect(p.latitude).toBeLessThanOrEqual(35.69);
    }
    const bad = await call("bbox=139.55,35.55,139.95,35.80&z=11&area=139.7,35.6;139.8,35.7;139.8,35.6;139.7,35.7");
    expect(bad.body.area).toBeNull(); // bow-tie: ignored, not "repaired"
  });

  it("ignores an invalid radius rather than scanning an arbitrary circle", async () => {
    const r = await call("bbox=139.55,35.55,139.95,35.80&z=11&near=35.68,139.76&radiusKm=500");
    expect(r.status).toBe(200);
    expect(r.body.radius).toBeNull();
  });
});
