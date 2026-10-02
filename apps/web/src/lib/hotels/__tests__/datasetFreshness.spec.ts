import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { datasetFresh, datasetStats, googlePlacesInBBox, isFresh, placesDatasetReadiness } from "../googlePlacesLayer";
import { GET as hotelsGET } from "@/app/api/travel/hotels/route";

// The Google Places snapshot may only be served inside its cache window. These
// pin that rule at its edges with explicit dates, independent of today's date.

const { generatedAt, expiresAt } = datasetStats();
const EXPIRES = Date.parse(expiresAt);
const WORLD = { west: -180, south: -85, east: 180, north: 85 };

afterEach(() => vi.useRealTimers());

describe("isFresh (the rule)", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it.each([
    ["2026-06-01T00:00:01Z", true],
    ["2026-06-01T00:00:00Z", false], // at expiry: no longer servable
    ["2026-05-31T23:59:59Z", false],
    ["", false],
    ["not a date", false],
    [undefined, false],
    [null, false],
    [1_900_000_000_000, false], // a number is not an ISO expiry
  ])("%j → %s", (expiry, want) => expect(isFresh(expiry, now)).toBe(want));
});

describe("operator readiness check (GET /api/ops/readiness)", () => {
  const exp = "2026-06-30T00:00:00.000Z";
  it("ok with more than a week left", () => {
    expect(placesDatasetReadiness(new Date("2026-06-01T00:00:00Z"), exp).ok).toBe(true);
  });
  it("warns inside the last week", () => {
    const r = placesDatasetReadiness(new Date("2026-06-27T00:00:00Z"), exp);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/expires in 3 day/);
  });
  it("fails once expired, and says the layer serves nothing", () => {
    const r = placesDatasetReadiness(new Date("2026-07-01T00:00:00Z"), exp);
    expect(r.ok).toBe(false);
    expect(r.state).toBe("stale");
    expect(r.detail).toMatch(/expired.*serves nothing/);
  });
  it.each([
    [0, exp],
    [-1, exp],
    [null, exp],
    [16014, ""],
    [16014, "garbage"],
    [16014, null],
  ])("missing data (count %j, expiresAt %j; null = absent, since undefined would take the default) is 'missing', not 'stale' or 'healthy'", (count, expiry) => {
    const r = placesDatasetReadiness(new Date("2026-06-01T00:00:00Z"), expiry, count);
    expect(r).toMatchObject({ ok: false, state: "missing" });
  });
  it("states are distinct: healthy / expiring / stale", () => {
    expect(placesDatasetReadiness(new Date("2026-06-01T00:00:00Z"), exp, 10).state).toBe("healthy");
    expect(placesDatasetReadiness(new Date("2026-06-27T00:00:00Z"), exp, 10).state).toBe("expiring");
    expect(placesDatasetReadiness(new Date("2026-07-01T00:00:00Z"), exp, 10).state).toBe("stale");
  });
});

describe("the checked-in snapshot", () => {
  it("has a parseable 30-day window", () => {
    expect(Number.isFinite(EXPIRES)).toBe(true);
    expect(Math.round((EXPIRES - Date.parse(generatedAt)) / 86_400_000)).toBe(30);
  });

  it("serves inside the window and NOTHING from the first millisecond after it", () => {
    const inside = googlePlacesInBBox(WORLD, {}, new Date(EXPIRES - 60_000));
    expect(inside.length).toBeGreaterThan(0);
    expect(googlePlacesInBBox(WORLD, {}, new Date(EXPIRES))).toEqual([]);
    expect(googlePlacesInBBox(WORLD, {}, new Date(EXPIRES + 86_400_000))).toEqual([]);
    expect(datasetFresh(new Date(EXPIRES))).toBe(false);
  });

  it("city search says WHY it is empty once expired, instead of implying no hotels exist", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EXPIRES + 1000);
    const res = await hotelsGET(
      new NextRequest("http://localhost/api/travel/hotels?city=Dubai", { headers: { "x-real-ip": "198.51.100.77" } })
    );
    const body = (await res.json()) as { hotels: unknown[]; googleDataset: { fresh: boolean; expiresAt: string } };
    expect(body.googleDataset.fresh).toBe(false);
    expect(body.googleDataset.expiresAt).toBe(expiresAt);
  });
});
