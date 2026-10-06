import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { categoryFor, osmPoisNear, parsePoiElements } = await import("../osmPois");

const el = (id: number, tags: Record<string, string>, lat = 35.68, lon = 139.76) => ({ type: "node", id, lat, lon, tags });

describe("parsePoiElements", () => {
  it("keeps named, categorised places and reads way centres", () => {
    const pois = parsePoiElements([
      el(1, { amenity: "restaurant", name: "Sushi Dai" }),
      el(2, { amenity: "cafe", name: "Blue Bottle", "name:en": "Blue Bottle Coffee" }),
      { type: "way", id: 3, center: { lat: 35.67, lon: 139.75 }, tags: { tourism: "museum", name: "Mitsubishi Ichigokan" } },
      el(4, { railway: "station", name: "Tokyo" }),
    ]);
    expect(pois.map((p) => [p.category, p.name])).toEqual([
      ["restaurant", "Sushi Dai"],
      ["cafe", "Blue Bottle Coffee"],
      ["museum", "Mitsubishi Ichigokan"],
      ["transport", "Tokyo"],
    ]);
    expect(pois[2].id).toBe("way/3");
  });
  it("drops unnamed, uncategorised, duplicate and out-of-range features", () => {
    expect(
      parsePoiElements([
        el(1, { amenity: "restaurant" }),
        el(2, { amenity: "bench", name: "Bench" }),
        el(3, { amenity: "cafe", name: "Starbucks" }),
        el(4, { amenity: "cafe", name: "starbucks" }),
        el(5, { amenity: "cafe", name: "Nowhere" }, 120, 0),
      ]).map((p) => p.id)
    ).toEqual(["node/3"]);
  });
  it("maps tags to categories", () => {
    expect(categoryFor({ shop: "mall" })).toBe("shopping");
    expect(categoryFor({ tourism: "viewpoint" })).toBe("attraction");
    expect(categoryFor({ amenity: "bar" })).toBeNull();
  });
});

describe("osmPoisNear", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => store.clear());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("returns places on success and caches them", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ elements: [el(1, { amenity: "cafe", name: "Café" })] })));
    globalThis.fetch = f as never;
    const r = await osmPoisNear(35.68, 139.76);
    expect(r.status).toBe("ok");
    expect(r.pois).toHaveLength(1);
    await osmPoisNear(35.68, 139.76);
    expect(f).toHaveBeenCalledTimes(1); // second answer came from the cache
  });

  it("says ok with no places for an empty answer — distinct from unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [] }))) as never;
    const r = await osmPoisNear(1, 1);
    expect(r).toMatchObject({ status: "ok", pois: [] });
  });

  it("reports unavailable when every mirror fails over HTTP", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    globalThis.fetch = f as never;
    const r = await osmPoisNear(2, 2);
    expect(r).toMatchObject({ status: "unavailable", pois: [] });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("gives up inside its total budget when mirrors hang (timeout + cancellation)", async () => {
    globalThis.fetch = vi.fn(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))
    ) as never;
    const t0 = Date.now();
    const r = await osmPoisNear(3, 3);
    expect(r.status).toBe("unavailable");
    expect(Date.now() - t0).toBeLessThan(9_500);
  }, 15_000);
});
