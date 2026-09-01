import { describe, it, expect } from "vitest";
import {
  bearingTo,
  angleDelta,
  alignmentError,
  metersBetween,
  roadCandidates,
  matchHeading,
  snapToRoad,
} from "../mapMatchHeading";

// Angle code fails silently — it returns a plausible number rather than
// throwing — so these tests target the specific ways it goes wrong: the
// 0/360 seam, the bidirectionality of roads, and latitude-dependent longitude.

describe("bearings are great-circle, not planar", () => {
  it("reads the cardinal directions correctly", () => {
    const o = { lng: 0, lat: 0 };
    expect(bearingTo(o, { lng: 0, lat: 1 })).toBeCloseTo(0, 1);    // north
    expect(bearingTo(o, { lng: 1, lat: 0 })).toBeCloseTo(90, 1);   // east
    expect(bearingTo(o, { lng: 0, lat: -1 })).toBeCloseTo(180, 1); // south
    expect(bearingTo(o, { lng: -1, lat: 0 })).toBeCloseTo(270, 1); // west
  });

  it("accounts for longitude shrinking with latitude", () => {
    // A planar atan2 of the coordinate deltas returns 45 degrees at BOTH
    // latitudes, and is wrong at one of them. At 60N a degree of longitude
    // covers about half the ground a degree of latitude does, so the same
    // +1/+1 step is a far more NORTHERLY course — nearer 26 than 45.
    const equator = bearingTo({ lng: 0, lat: 0 }, { lng: 1, lat: 1 });
    const oslo = bearingTo({ lng: 0, lat: 60 }, { lng: 1, lat: 61 });
    expect(equator).toBeCloseTo(45, 0);
    expect(oslo).toBeLessThan(equator);
    expect(oslo).toBeCloseTo(26, 0);
  });

  it("always returns a bearing in [0, 360)", () => {
    for (const p of [{ lng: -1, lat: -1 }, { lng: 1, lat: -1 }, { lng: -1, lat: 1 }]) {
      const b = bearingTo({ lng: 0, lat: 0 }, p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe("angleDelta crosses the 0/360 seam", () => {
  it("treats 359 and 1 as two degrees apart", () => {
    expect(angleDelta(359, 1)).toBeCloseTo(2, 6);
    expect(angleDelta(1, 359)).toBeCloseTo(-2, 6);
  });

  it("stays within (-180, 180]", () => {
    for (const [a, b] of [[0, 180], [0, 181], [350, 170], [10, 200]]) {
      const d = angleDelta(a, b);
      expect(d).toBeGreaterThan(-180.0001);
      expect(d).toBeLessThanOrEqual(180.0001);
    }
  });
});

describe("roads are bidirectional — the detail that halves accuracy if missed", () => {
  it("counts walking the OTHER way down a street as aligned", () => {
    // A street bearing 90 supports travel at 90 and at 270. Without the fold,
    // exactly half of all correct headings would be rejected.
    expect(alignmentError(270, 90)).toBeCloseTo(0, 6);
    expect(alignmentError(90, 270)).toBeCloseTo(0, 6);
  });

  it("returns the acute angle, never more than 90", () => {
    expect(alignmentError(0, 179)).toBeCloseTo(1, 6);
    expect(alignmentError(0, 91)).toBeCloseTo(89, 6);
    expect(alignmentError(0, 90)).toBeCloseTo(90, 6);
  });

  it("is largest for a perpendicular crossing", () => {
    expect(alignmentError(0, 90)).toBe(90);
    expect(alignmentError(45, 135)).toBeCloseTo(90, 6);
  });
});

describe("finding roads near the reader", () => {
  // ~111m per 0.001 degrees of latitude.
  const northSouth: [number, number][] = [[0, 0], [0, 0.002]];
  const eastWest: [number, number][] = [[0, 0], [0.002, 0]];

  it("returns a bearing per nearby segment, nearest first", () => {
    const c = roadCandidates([northSouth, eastWest], { lng: 0, lat: 0 }, 300);
    expect(c).toHaveLength(2);
    expect(c[0].distance).toBeLessThanOrEqual(c[1].distance);
    expect(c.map((x) => Math.round(x.bearing)).sort((a, b) => a - b)).toEqual([0, 90]);
  });

  it("ignores roads out of range", () => {
    // A road 20km away says nothing about which way someone is walking here.
    const far: [number, number][] = [[0.2, 0.2], [0.2, 0.202]];
    expect(roadCandidates([far], { lng: 0, lat: 0 }, 40)).toHaveLength(0);
  });

  it("skips zero-length segments, which have no bearing", () => {
    const degenerate: [number, number][] = [[0, 0], [0, 0]];
    expect(roadCandidates([degenerate], { lng: 0, lat: 0 }, 100)).toHaveLength(0);
  });

  it("handles an empty road set", () => {
    expect(roadCandidates([], { lng: 0, lat: 0 })).toEqual([]);
  });
});

describe("scoring a heading against the roads", () => {
  const street = [{ bearing: 90, distance: 5 }];

  it("strongly supports a heading down the street", () => {
    const m = matchHeading(90, street);
    expect(m.support).toBeGreaterThan(0.9);
    expect(m.errorDegrees).toBeCloseTo(0, 6);
    expect(m.bearing).toBe(90);
  });

  it("supports walking back up the same street just as strongly", () => {
    expect(matchHeading(270, street).support).toBeGreaterThan(0.9);
  });

  it("gives no support to a heading across the street", () => {
    const m = matchHeading(0, street);
    expect(m.support).toBe(0);
    expect(m.candidates).toBe(1); // roads WERE in range and none agreed
  });

  it("distinguishes 'no roads here' from 'no road agrees'", () => {
    // An open plaza or a beach is not evidence against a heading, and the
    // caller has to be able to tell the two apart.
    const empty = matchHeading(90, []);
    expect(empty.support).toBe(0);
    expect(empty.candidates).toBe(0);

    const disagree = matchHeading(0, street);
    expect(disagree.support).toBe(0);
    expect(disagree.candidates).toBe(1);
  });

  it("prefers the nearer of two equally aligned roads", () => {
    const near = matchHeading(90, [{ bearing: 90, distance: 2 }]).support;
    const far = matchHeading(90, [{ bearing: 90, distance: 38 }]).support;
    expect(near).toBeGreaterThan(far);
  });

  it("returns no opinion on a null or non-finite heading", () => {
    expect(matchHeading(null, street).support).toBe(0);
    expect(matchHeading(NaN, street).support).toBe(0);
  });
});

describe("snapping a heading onto a road", () => {
  it("keeps the forward direction when that is nearer", () => {
    expect(snapToRoad(90, 85)).toBe(90);
  });

  it("takes the reciprocal when the reader is going the other way", () => {
    expect(snapToRoad(90, 265)).toBe(270);
  });

  it("works across the 0/360 seam", () => {
    // A north-south road, reader heading 359 — forward (0), not south.
    expect(snapToRoad(0, 359)).toBe(0);
    expect(snapToRoad(0, 181)).toBe(180);
  });

  it("normalises an out-of-range road bearing", () => {
    expect(snapToRoad(450, 90)).toBe(90);
    expect(snapToRoad(-90, 270)).toBe(270);
  });
});

describe("distance", () => {
  it("is about 111km per degree of latitude", () => {
    expect(metersBetween({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeGreaterThan(110_000);
    expect(metersBetween({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeLessThan(112_000);
  });

  it("shrinks east-west distance with latitude", () => {
    const atEquator = metersBetween({ lng: 0, lat: 0 }, { lng: 1, lat: 0 });
    const atSixty = metersBetween({ lng: 0, lat: 60 }, { lng: 1, lat: 60 });
    expect(atSixty).toBeLessThan(atEquator * 0.55);
  });
});
