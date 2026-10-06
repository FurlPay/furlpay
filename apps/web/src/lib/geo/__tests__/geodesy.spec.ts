import { describe, expect, it } from "vitest";
import { circleBBox, circlePolygon, destination, formatDistanceKm, greatCircle, haversineKm } from "../geodesy";

const NRT = { latitude: 35.7647, longitude: 140.3864 };
const HND = { latitude: 35.5523, longitude: 139.7798 };
const SFO = { latitude: 37.619, longitude: -122.375 };
const LHR = { latitude: 51.47, longitude: -0.4543 };
const JFK = { latitude: 40.6398, longitude: -73.7789 };

describe("haversineKm", () => {
  it("matches known airport-pair distances within 0.5%", () => {
    // Published great-circle distances: LHR-JFK 5,540 km, SFO-NRT 8,236 km.
    expect(haversineKm(LHR, JFK)).toBeGreaterThan(5540 * 0.995);
    expect(haversineKm(LHR, JFK)).toBeLessThan(5540 * 1.005);
    expect(haversineKm(SFO, NRT)).toBeGreaterThan(8236 * 0.995);
    expect(haversineKm(SFO, NRT)).toBeLessThan(8236 * 1.005);
    expect(haversineKm(NRT, HND)).toBeGreaterThan(55);
    expect(haversineKm(NRT, HND)).toBeLessThan(62);
  });
  it("is zero for the same point and symmetric", () => {
    expect(haversineKm(NRT, NRT)).toBe(0);
    expect(haversineKm(NRT, HND)).toBeCloseTo(haversineKm(HND, NRT), 9);
  });
  it("refuses invalid coordinates rather than inventing a distance", () => {
    expect(haversineKm({ latitude: 91, longitude: 0 }, NRT)).toBeNaN();
    expect(haversineKm({ latitude: NaN, longitude: 0 }, NRT)).toBeNaN();
    expect(haversineKm(NRT, { latitude: 0, longitude: 181 })).toBeNaN();
  });
});

describe("formatDistanceKm", () => {
  it("reads naturally at every scale", () => {
    expect(formatDistanceKm(0.85)).toBe("850 m");
    expect(formatDistanceKm(12.44)).toBe("12.4 km");
    expect(formatDistanceKm(312.4)).toBe("312 km");
    expect(formatDistanceKm(NaN)).toBe("");
  });
});

describe("circles", () => {
  it("puts every vertex at the radius", () => {
    const c = { latitude: 35.68, longitude: 139.77 };
    const ring = circlePolygon(c, 5).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    for (const [lng, lat] of ring) expect(haversineKm(c, { latitude: lat, longitude: lng })).toBeCloseTo(5, 6);
  });
  it("bounds the circle", () => {
    const c = { latitude: 35.68, longitude: 139.77 };
    const b = circleBBox(c, 10);
    expect(b.minLat).toBeLessThan(c.latitude);
    expect(b.maxLat).toBeGreaterThan(c.latitude);
    expect(haversineKm(c, { latitude: b.maxLat, longitude: c.longitude })).toBeCloseTo(10, 6);
    expect(haversineKm(c, { latitude: c.latitude, longitude: b.maxLng })).toBeGreaterThanOrEqual(9.99);
  });
  it("walks a bearing to the right destination", () => {
    const p = destination({ latitude: 0, longitude: 0 }, 111.195, 90);
    expect(p.latitude).toBeCloseTo(0, 6);
    expect(p.longitude).toBeCloseTo(1, 2);
  });
});

describe("greatCircle", () => {
  it("starts and ends at the endpoints", () => {
    const f = greatCircle(LHR, JFK, 50);
    expect(f.geometry.type).toBe("LineString");
    const c = f.geometry.coordinates as [number, number][];
    expect(c[0][0]).toBeCloseTo(LHR.longitude, 6);
    expect(c[c.length - 1][1]).toBeCloseTo(JFK.latitude, 6);
    // A great circle from London to New York bows NORTH of both endpoints.
    expect(Math.max(...c.map((p) => p[1]))).toBeGreaterThan(51.5);
  });
  it("splits at the antimeridian instead of crossing the world", () => {
    const f = greatCircle(SFO, NRT);
    expect(f.geometry.type).toBe("MultiLineString");
    const parts = f.geometry.coordinates as [number, number][][];
    for (const part of parts) {
      for (let i = 1; i < part.length; i++) expect(Math.abs(part[i][0] - part[i - 1][0])).toBeLessThan(180);
    }
  });
});
