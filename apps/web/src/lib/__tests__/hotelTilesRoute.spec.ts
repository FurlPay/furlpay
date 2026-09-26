// GET /api/travel/hotels/tiles/:z/:x/:y — vector tile route.
//
// What only the route can get wrong: which tile coordinates it agrees to query
// for, what it says when the migration is missing, and whether an empty tile is
// distinguishable from a broken one. All three are cheap to get wrong and
// expensive to debug from a blank map.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sbRpc = vi.fn();
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, sbRpc, supabaseBackend: "supabase" };
});

const { GET } = await import("@/app/api/travel/hotels/tiles/[z]/[x]/[y]/route");

/** A tile with one point in it, produced by ST_AsMVT and base64'd in Postgres. */
const SAMPLE_MVT_B64 = Buffer.from([0x1a, 0x2b, 0x3c, 0x4d, 0x5e]).toString("base64");

function req(ip = `10.60.0.${Math.floor(Math.random() * 250)}`) {
  return new NextRequest("https://furlpay.com/api/travel/hotels/tiles/10/512/512", {
    headers: { "x-forwarded-for": ip },
  });
}

function params(z: number | string, x: number | string, y: number | string) {
  return { params: Promise.resolve({ z: String(z), x: String(x), y: String(y) }) };
}

beforeEach(() => {
  sbRpc.mockReset();
  sbRpc.mockResolvedValue(SAMPLE_MVT_B64);
});

describe("tile coordinate validation", () => {
  it("400s non-integer coordinates without querying the database", async () => {
    for (const bad of [["a", "1", "1"], ["1", "b", "1"], ["1", "1", "c"], ["1.5", "1", "1"], ["", "1", "1"]]) {
      const res = await GET(req(), params(bad[0], bad[1], bad[2]));
      expect(res.status).toBe(400);
    }
    expect(sbRpc).not.toHaveBeenCalled();
  });

  it("400s a zoom outside 0-20", async () => {
    for (const z of [-1, 21, 99]) {
      expect((await GET(req(), params(z, 0, 0))).status).toBe(400);
    }
    expect(sbRpc).not.toHaveBeenCalled();
  });

  it("accepts the boundary zooms", async () => {
    expect((await GET(req(), params(0, 0, 0))).status).toBe(200);
    expect((await GET(req(), params(20, 0, 0))).status).toBe(200);
  });

  it("400s x/y outside the 2^z grid for that zoom", async () => {
    // THE CASE THE BLUEPRINT MISSES. /tiles/2/999999/999999 parses fine as
    // integers; without this bound ST_TileEnvelope computes an envelope off
    // the map and Postgres runs an index scan per request — a free
    // amplification primitive against the database.
    expect((await GET(req(), params(2, 4, 0))).status).toBe(400); // 2^2 = 4, so max index is 3
    expect((await GET(req(), params(2, 0, 4))).status).toBe(400);
    expect((await GET(req(), params(2, 999999, 999999))).status).toBe(400);
    expect((await GET(req(), params(0, 1, 0))).status).toBe(400); // z=0 has exactly one tile
    expect((await GET(req(), params(10, -1, 5))).status).toBe(400);
    expect(sbRpc).not.toHaveBeenCalled();
  });

  it("accepts the last valid tile index at a zoom", async () => {
    expect((await GET(req(), params(2, 3, 3))).status).toBe(200);
    expect((await GET(req(), params(0, 0, 0))).status).toBe(200);
  });

  it("passes the coordinates through to the SQL function as numbers", async () => {
    await GET(req(), params(10, 512, 511));
    expect(sbRpc).toHaveBeenCalledWith("hotels_mvt", { z: 10, x: 512, y: 511 });
  });
});

describe("tile responses", () => {
  it("serves the decoded binary with vector-tile headers", async () => {
    const res = await GET(req(), params(10, 512, 512));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(res.headers.get("cache-control")).toContain("stale-while-revalidate");

    // The bytes must survive the base64 round trip unchanged — a tile that is
    // re-encoded or truncated renders as nothing with no error anywhere.
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from(SAMPLE_MVT_B64, "base64"))).toBe(true);
  });

  it("204s an empty tile rather than sending an empty 200", async () => {
    // MapLibre treats 204 as "nothing here" and stops; an empty 200 body is a
    // malformed protobuf and logs a decode error on every pan over open ocean.
    sbRpc.mockResolvedValue("");
    const res = await GET(req(), params(10, 512, 512));
    expect(res.status).toBe(204);
  });

  it("204s when the function returns a zero-length buffer", async () => {
    sbRpc.mockResolvedValue(Buffer.alloc(0).toString("base64"));
    expect((await GET(req(), params(10, 512, 512))).status).toBe(204);
  });
});

describe("failure modes are distinguishable", () => {
  it("503s with a specific message when migration 0015 is not applied", async () => {
    const { SupabaseFunctionMissing } = await import("@/lib/supabase");
    sbRpc.mockRejectedValue(new SupabaseFunctionMissing("hotels_mvt"));

    const res = await GET(req(), params(10, 512, 512));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.detail).toMatch(/not installed/i);
  });

  it("500s a genuine query failure, distinct from a missing function", async () => {
    // A blank map caused by a broken query and one caused by an unapplied
    // migration need completely different fixes, so they get different codes.
    sbRpc.mockRejectedValue(new Error("connection reset"));
    const res = await GET(req(), params(10, 512, 512));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("tile_failed");
  });

  it("never leaks commercial columns in an error body", async () => {
    sbRpc.mockRejectedValue(new Error("direct_booking_url column missing"));
    const res = await GET(req(), params(10, 512, 512));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/direct_booking_url/);
  });
});

describe("rate limiting", () => {
  it("429s once the public budget is exhausted", async () => {
    // Public and unauthenticated, so the IP budget is the only gate — same IP
    // throughout to exhaust it.
    const ip = "10.61.0.9";
    const statuses: number[] = [];
    for (let i = 0; i < 320; i += 1) {
      statuses.push((await GET(req(ip), params(10, 512, 512))).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 300).every((s) => s !== 429)).toBe(true);
  });
});
