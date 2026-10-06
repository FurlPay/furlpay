import { describe, expect, it } from "vitest";
import { airportsInBBox, geoAirportByIata, minSizeForZoom, nearestAirports } from "../airportGeo";

describe("airport positions", () => {
  it("knows where the major hubs are", () => {
    const nrt = geoAirportByIata("NRT")!;
    expect(nrt.latitude).toBeCloseTo(35.76, 1);
    expect(nrt.longitude).toBeCloseTo(140.39, 1);
    expect(geoAirportByIata("nrt")?.iata).toBe("NRT");
    expect(geoAirportByIata("ZZZ")).toBeUndefined();
  });
});

describe("airportsInBBox", () => {
  const tokyo = { minLat: 35.3, minLng: 139.3, maxLat: 36.0, maxLng: 140.6 };
  it("draws only hubs at country zoom and adds smaller fields as you zoom in", () => {
    const wide = airportsInBBox(tokyo, 4);
    expect(wide.every((a) => a.size === 3)).toBe(true);
    expect(wide.map((a) => a.iata)).toEqual(expect.arrayContaining(["HND", "NRT"]));
    expect(airportsInBBox(tokyo, 9).length).toBeGreaterThanOrEqual(wide.length);
    expect(minSizeForZoom(3)).toBe(3);
    expect(minSizeForZoom(10)).toBe(1);
  });
  it("caps a view and keeps the largest", () => {
    const world = airportsInBBox({ minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 }, 9, 10);
    expect(world).toHaveLength(10);
    expect(world.every((a) => a.size === 3)).toBe(true);
  });
  it("handles a view across the antimeridian", () => {
    const fiji = airportsInBBox({ minLat: -20, minLng: 175, maxLat: -15, maxLng: -178 }, 8);
    expect(fiji.map((a) => a.iata)).toContain("NAN");
  });
});

describe("nearestAirports", () => {
  it("finds the commercial airports nearest a central Tokyo hotel, by straight line", () => {
    const near = nearestAirports({ latitude: 35.6812, longitude: 139.7671 }, 2);
    expect(near[0].iata).toBe("HND");
    expect(near[0].distanceKm).toBeGreaterThan(12);
    expect(near[0].distanceKm).toBeLessThan(18);
    expect(near.map((a) => a.iata)).toContain("NRT");
  });
  it("returns nothing for an invalid coordinate or an empty ocean", () => {
    expect(nearestAirports({ latitude: 999, longitude: 0 })).toEqual([]);
    expect(nearestAirports({ latitude: -48.9, longitude: -123.4 }, 2, 200)).toEqual([]); // Point Nemo
  });
});
