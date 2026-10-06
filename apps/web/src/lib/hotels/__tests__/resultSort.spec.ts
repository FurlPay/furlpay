import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import { distanceKm, isResultSort, sortResults } from "@/lib/hotels/resultSort";

// Fixture points for the ordering rules only.
const p = (id: string, o: Partial<MapPoint> = {}): MapPoint => ({
  id,
  kind: "property",
  source: "osm",
  latitude: 35.68,
  longitude: 139.76,
  name: id,
  city: "Tokyo",
  country: "Japan",
  hotelType: "hotel",
  ...o,
});

const ids = (xs: MapPoint[]) => xs.map((x) => x.id);

describe("sortResults", () => {
  it("recommended: curated first, then L-Score, then rating", () => {
    const set = [p("osm-high", { rating: 4.9 }), p("cur-low", { source: "curated", lScore: 40 }), p("cur-high", { source: "curated", lScore: 90 })];
    expect(ids(sortResults(set, "recommended"))).toEqual(["cur-high", "cur-low", "osm-high"]);
  });

  it("rating: missing ratings sort last, not as zero", () => {
    const set = [p("none"), p("low", { rating: 3.1 }), p("high", { rating: 4.7 })];
    expect(ids(sortResults(set, "rating"))).toEqual(["high", "low", "none"]);
  });

  it("rating ties break on how many people rated", () => {
    const set = [p("few", { rating: 4.6, ratingCount: 12 }), p("many", { rating: 4.6, ratingCount: 2400 })];
    expect(ids(sortResults(set, "rating"))[0]).toBe("many");
  });

  it("stars: unknown star class sorts after known", () => {
    const set = [p("unknown"), p("three", { stars: 3 }), p("five", { stars: 5 })];
    expect(ids(sortResults(set, "stars"))).toEqual(["five", "three", "unknown"]);
  });

  it("distance: nearest to the centre first", () => {
    const centre = { latitude: 35.6812, longitude: 139.7671 }; // Tokyo Station
    const set = [p("far", { latitude: 35.6586, longitude: 139.7454 }), p("near", { latitude: 35.6815, longitude: 139.7665 })];
    expect(ids(sortResults(set, "distance", centre))).toEqual(["near", "far"]);
    expect(distanceKm(centre, set[1])).toBeLessThan(0.1);
  });

  it("does not mutate its input and is deterministic", () => {
    const set = [p("b"), p("a"), p("c")];
    const copy = [...set];
    expect(ids(sortResults(set, "name"))).toEqual(["a", "b", "c"]);
    expect(set).toEqual(copy);
    expect(sortResults(set, "rating")).toEqual(sortResults([...set].reverse(), "rating"));
  });

  it("validates sort ids from the URL", () => {
    expect(isResultSort("stars")).toBe(true);
    expect(isResultSort("price")).toBe(false); // no prices on this map
  });
});
