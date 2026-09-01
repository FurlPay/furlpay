import { describe, it, expect } from "vitest";
import { directionsUrl, placeUrl, isPlottable } from "../directions";

// A directions button that opens a map pointed at nowhere is worse than no
// button: it looks like it worked. So most of these test the refusal.

const ROVE = {
  latitude: 25.1899,
  longitude: 55.2721,
  placeId: "ChIJdVjX4mVDXz4RmRbNKgBWTuU",
  name: "Rove Downtown",
};

describe("a coordinate has to be somewhere real", () => {
  it("accepts a genuine position", () => {
    expect(isPlottable(25.1899, 55.2721)).toBe(true);
    expect(isPlottable(-33.8688, 151.2093)).toBe(true);
  });

  it("rejects 0,0 — Null Island is a bug, not a hotel", () => {
    // It is in the Gulf of Guinea, and it is exactly what a missing lat/lng
    // collapses to when something upstream coerced null to zero.
    expect(isPlottable(0, 0)).toBe(false);
  });

  it("rejects missing, NaN and out-of-range values", () => {
    expect(isPlottable(null, 55)).toBe(false);
    expect(isPlottable(25, undefined)).toBe(false);
    expect(isPlottable(NaN, 55)).toBe(false);
    expect(isPlottable(25, Infinity)).toBe(false);
    expect(isPlottable(91, 0)).toBe(false);
    expect(isPlottable(0, 181)).toBe(false);
  });

  it("keeps a real coordinate on an axis", () => {
    // Only BOTH being zero is suspicious. The equator and the prime meridian
    // are real places.
    expect(isPlottable(0, 55.2721)).toBe(true);
    expect(isPlottable(25.1899, 0)).toBe(true);
  });
});

describe("directionsUrl", () => {
  it("builds the documented cross-platform form", () => {
    const url = directionsUrl(ROVE)!;
    expect(url.startsWith("https://www.google.com/maps/dir/?")).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get("api")).toBe("1");
    expect(q.get("destination")).toBe("25.1899,55.2721");
    expect(q.get("destination_place_id")).toBe(ROVE.placeId);
    expect(q.get("travelmode")).toBe("driving");
  });

  it("sends the coordinate even when a place id is present", () => {
    // The id sharpens the destination; the coordinate is what keeps the link
    // working if Google ever retires it.
    const q = new URL(directionsUrl(ROVE)!).searchParams;
    expect(q.get("destination")).toBeTruthy();
    expect(q.get("destination_place_id")).toBeTruthy();
  });

  it("honours the travel mode", () => {
    const q = new URL(directionsUrl(ROVE, "walking")!).searchParams;
    expect(q.get("travelmode")).toBe("walking");
  });

  it("returns null without a plottable coordinate, so the caller hides the button", () => {
    expect(directionsUrl({ placeId: "abc", name: "Somewhere" })).toBeNull();
    expect(directionsUrl({ latitude: 0, longitude: 0, placeId: "abc" })).toBeNull();
    expect(directionsUrl({ latitude: NaN, longitude: 55 })).toBeNull();
  });

  it("escapes a place id rather than pasting it into the query string", () => {
    const url = directionsUrl({ ...ROVE, placeId: "a b&c=d" })!;
    expect(url).not.toContain("a b&c=d");
    expect(new URL(url).searchParams.get("destination_place_id")).toBe("a b&c=d");
  });
});

describe("placeUrl", () => {
  it("prefers the place id, which survives a rename", () => {
    const q = new URL(placeUrl(ROVE)!).searchParams;
    expect(q.get("query_place_id")).toBe(ROVE.placeId);
    expect(q.get("query")).toBe("Rove Downtown");
  });

  it("falls back to the coordinate when there is no id", () => {
    const q = new URL(placeUrl({ latitude: 25.1899, longitude: 55.2721 })!).searchParams;
    expect(q.get("query")).toBe("25.1899,55.2721");
    expect(q.get("query_place_id")).toBeNull();
  });

  it("returns null when it has neither", () => {
    expect(placeUrl({ name: "A hotel with no position" })).toBeNull();
    expect(placeUrl({ latitude: 0, longitude: 0 })).toBeNull();
  });

  it("does not break on a name containing URL syntax", () => {
    const url = placeUrl({ ...ROVE, name: "Hotel & Spa?x=1" })!;
    expect(new URL(url).searchParams.get("query")).toBe("Hotel & Spa?x=1");
  });
});
