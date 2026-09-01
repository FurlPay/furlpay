import { describe, it, expect } from "vitest";
import {
  isValidCoordinate,
  asCoordinate,
  distanceMeters,
  formatDistance,
  formatDistanceAway,
  boundsAround,
} from "../coordinates";

const DUBAI = { latitude: 25.2048, longitude: 55.2708 };
const ABU_DHABI = { latitude: 24.4539, longitude: 54.3773 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

describe("isValidCoordinate — the single source of truth", () => {
  it("accepts real positions", () => {
    expect(isValidCoordinate(25.2048, 55.2708)).toBe(true);
    expect(isValidCoordinate(-33.8688, 151.2093)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
  });

  it("rejects 0,0 — that is a coerced null, not a hotel", () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
  });

  it("keeps genuine equator and prime-meridian coordinates", () => {
    // Only BOTH being zero is suspicious. Rejecting either axis would delete
    // real properties in Ecuador, Kenya, Ghana and the UK.
    expect(isValidCoordinate(0, 55.2708)).toBe(true);
    expect(isValidCoordinate(51.5074, 0)).toBe(true);
  });

  it("rejects null, undefined, NaN and Infinity", () => {
    expect(isValidCoordinate(null, 55)).toBe(false);
    expect(isValidCoordinate(25, null)).toBe(false);
    expect(isValidCoordinate(undefined, undefined)).toBe(false);
    expect(isValidCoordinate(NaN, 55)).toBe(false);
    expect(isValidCoordinate(25, NaN)).toBe(false);
    expect(isValidCoordinate(Infinity, 55)).toBe(false);
    expect(isValidCoordinate(25, -Infinity)).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(isValidCoordinate(90.1, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -180.5)).toBe(false);
  });

  it("asCoordinate narrows or returns null", () => {
    expect(asCoordinate(25.2048, 55.2708)).toEqual(DUBAI);
    expect(asCoordinate(0, 0)).toBeNull();
    expect(asCoordinate(null, 5)).toBeNull();
  });
});

describe("distanceMeters", () => {
  it("measures a known separation", () => {
    // Dubai to Abu Dhabi is about 120km great-circle.
    const d = distanceMeters(DUBAI, ABU_DHABI)!;
    expect(d).toBeGreaterThan(115_000);
    expect(d).toBeLessThan(125_000);
  });

  it("is zero to itself and symmetric", () => {
    expect(distanceMeters(DUBAI, DUBAI)).toBeCloseTo(0, 3);
    expect(distanceMeters(DUBAI, LONDON)).toBeCloseTo(distanceMeters(LONDON, DUBAI)!, 3);
  });

  it("does not use flat degree subtraction", () => {
    // One degree of longitude is ~111km at the equator and ~69km at London's
    // latitude. A degree-subtracting implementation would report these equal.
    const atEquator = distanceMeters({ latitude: 0.0001, longitude: 0 }, { latitude: 0.0001, longitude: 1 })!;
    const atLondon = distanceMeters({ latitude: 51.5, longitude: 0 }, { latitude: 51.5, longitude: 1 })!;
    expect(atLondon).toBeLessThan(atEquator * 0.75);
  });

  it("returns NULL rather than 0 when a coordinate is missing", () => {
    // 0 would render as "0 m away" — the closest possible hotel — on a record
    // we know nothing about.
    expect(distanceMeters(null, DUBAI)).toBeNull();
    expect(distanceMeters(DUBAI, null)).toBeNull();
    expect(distanceMeters({ latitude: 0, longitude: 0 }, DUBAI)).toBeNull();
    expect(distanceMeters({ latitude: NaN, longitude: 5 }, DUBAI)).toBeNull();
  });
});

describe("formatDistance — precision falls as distance grows", () => {
  it("rounds to tens of metres up close", () => {
    // A GPS fix is not accurate to the metre; printing one implies it is.
    expect(formatDistance(647)).toBe("650 m");
    expect(formatDistance(12)).toBe("10 m");
    expect(formatDistance(999)).toBe("1000 m");
  });

  it("never returns 0 m for a real, tiny distance", () => {
    expect(formatDistance(3)).toBe("10 m");
  });

  it("uses one decimal between 1 and 10 km", () => {
    expect(formatDistance(1_283.947)).toBe("1.3 km");
    expect(formatDistance(3_200)).toBe("3.2 km");
  });

  it("uses whole kilometres beyond 10", () => {
    expect(formatDistance(18_400)).toBe("18 km");
    expect(formatDistance(120_000)).toBe("120 km");
  });

  it("never emits absurd precision", () => {
    for (const m of [1, 647, 1283.947, 8712.3, 120345.6]) {
      const out = formatDistance(m)!;
      const decimals = (out.match(/\.(\d+)/)?.[1] ?? "").length;
      expect(decimals).toBeLessThanOrEqual(1);
    }
  });

  it("formats imperial when asked", () => {
    expect(formatDistance(200, "imperial")).toBe("660 ft");
    expect(formatDistance(5_000, "imperial")).toBe("3.1 mi");
    expect(formatDistance(50_000, "imperial")).toBe("31 mi");
  });

  it("returns null for null, negative or non-finite input", () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(-5)).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
    expect(formatDistanceAway(null)).toBeNull();
  });

  it("appends 'away' only when there is a distance", () => {
    expect(formatDistanceAway(3_200)).toBe("3.2 km away");
  });
});

describe("boundsAround", () => {
  it("contains the centre", () => {
    const b = boundsAround(DUBAI, 5_000);
    expect(DUBAI.latitude).toBeGreaterThan(b.minLat);
    expect(DUBAI.latitude).toBeLessThan(b.maxLat);
    expect(DUBAI.longitude).toBeGreaterThan(b.minLng);
    expect(DUBAI.longitude).toBeLessThan(b.maxLng);
  });

  it("widens longitude with latitude so the box stays square on the ground", () => {
    // A fixed degree offset searches a band half as wide in Reykjavik as at
    // the equator, and the reader sees fewer results for no real reason.
    const equator = boundsAround({ latitude: 0, longitude: 10 }, 10_000);
    const iceland = boundsAround({ latitude: 64, longitude: 10 }, 10_000);
    const width = (b: { minLng: number; maxLng: number }) => b.maxLng - b.minLng;
    expect(width(iceland)).toBeGreaterThan(width(equator) * 2);
    // Latitude span is unaffected by latitude.
    expect(iceland.maxLat - iceland.minLat).toBeCloseTo(equator.maxLat - equator.minLat, 6);
  });

  it("clamps at the poles instead of producing an impossible box", () => {
    const polar = boundsAround({ latitude: 89.99, longitude: 0 }, 50_000);
    expect(polar.maxLat).toBeLessThanOrEqual(90);
    expect(Number.isFinite(polar.minLng)).toBe(true);
    expect(Number.isFinite(polar.maxLng)).toBe(true);
  });

  it("grows with the radius", () => {
    const small = boundsAround(DUBAI, 5_000);
    const large = boundsAround(DUBAI, 25_000);
    expect(large.maxLat - large.minLat).toBeGreaterThan(small.maxLat - small.minLat);
  });
});
