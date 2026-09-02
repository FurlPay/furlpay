import { describe, it, expect } from "vitest";
import * as web from "../coordinates";
import { directionsUrl as webDirections } from "@/lib/travel/directions";
// Reached by relative path on purpose. native-app is not in the workspace, so
// there is no package specifier for it — but vitest resolves from the
// filesystem, which is enough to hold the two implementations against each
// other. This import is the entire reason the duplication is tolerable.
import * as native from "../../../../../../native-app/lib/geo";

// ---------------------------------------------------------------------------
// WEB / NATIVE PARITY
//
// The geo maths exists twice: apps/web/src/lib/geo/coordinates.ts and
// native-app/lib/geo.ts. That is a compromise, not a preference — native-app
// sits outside the root `workspaces` array and sharing a package would need a
// workspaces entry plus a Metro watchFolders change, neither of which can be
// verified without building the app, which this environment cannot do.
//
// So the divergence is made loud instead of hoped away. Every case below runs
// through BOTH implementations and asserts they agree. If someone edits one
// file and not the other, this fails.
//
// What it protects: a property whose card says "0.4 km away" on the phone and
// shows no distance on the web, or a Directions button that appears on one
// surface and not the other, because two validators disagreed about the same
// coordinate.
// ---------------------------------------------------------------------------

/** Every coordinate case that has ever mattered, plus the pathological ones. */
const COORDINATES: Array<[string, number | null | undefined, number | null | undefined]> = [
  ["Dubai", 25.2048, 55.2708],
  ["Sydney (southern, eastern)", -33.8688, 151.2093],
  ["London (negative longitude)", 51.5074, -0.1278],
  ["poles and antimeridian", 90, 180],
  ["opposite extremes", -90, -180],
  ["Null Island — a coerced null", 0, 0],
  ["genuine equator", 0, 55.2708],
  ["genuine prime meridian", 51.5074, 0],
  ["null latitude", null, 55],
  ["null longitude", 25, null],
  ["undefined both", undefined, undefined],
  ["NaN latitude", NaN, 55],
  ["NaN longitude", 25, NaN],
  ["Infinity", Infinity, 55],
  ["negative Infinity", 25, -Infinity],
  ["latitude out of range", 90.1, 0],
  ["longitude out of range", 0, 181],
];

describe("isValidCoordinate agrees", () => {
  for (const [label, lat, lng] of COORDINATES) {
    it(label, () => {
      expect(native.isValidCoordinate(lat, lng)).toBe(web.isValidCoordinate(lat, lng));
    });
  }
});

const PAIRS: Array<[string, web.Coordinate | null, web.Coordinate | null]> = [
  ["Dubai → Abu Dhabi", { latitude: 25.2048, longitude: 55.2708 }, { latitude: 24.4539, longitude: 54.3773 }],
  ["Dubai → London", { latitude: 25.2048, longitude: 55.2708 }, { latitude: 51.5074, longitude: -0.1278 }],
  ["identical points", { latitude: 25.2048, longitude: 55.2708 }, { latitude: 25.2048, longitude: 55.2708 }],
  ["across the antimeridian", { latitude: 0.5, longitude: 179.9 }, { latitude: 0.5, longitude: -179.9 }],
  ["a few metres apart", { latitude: 25.2048, longitude: 55.2708 }, { latitude: 25.20485, longitude: 55.27085 }],
  ["one end unknown", null, { latitude: 25.2048, longitude: 55.2708 }],
  ["both unknown", null, null],
  ["one end Null Island", { latitude: 0, longitude: 0 }, { latitude: 25.2048, longitude: 55.2708 }],
];

describe("distanceMeters agrees", () => {
  for (const [label, a, b] of PAIRS) {
    it(label, () => {
      const w = web.distanceMeters(a, b);
      const n = native.distanceMeters(a, b);
      if (w === null) {
        expect(n).toBeNull();
      } else {
        expect(n).not.toBeNull();
        // Same formula, so this is exact rather than approximate. A tolerance
        // here would let a genuinely different implementation slip through.
        expect(n!).toBeCloseTo(w, 9);
      }
    });
  }
});

describe("formatDistance agrees", () => {
  const DISTANCES = [null, 0, 3, 12, 647, 999, 1000, 1283.947, 3200, 9999, 10_000, 18_400, 120_345.6, -5, NaN];
  for (const m of DISTANCES) {
    it(`${m}`, () => {
      expect(native.formatDistance(m)).toBe(web.formatDistance(m));
      expect(native.formatDistance(m, "imperial")).toBe(web.formatDistance(m, "imperial"));
      expect(native.formatDistanceAway(m)).toBe(web.formatDistanceAway(m));
    });
  }

  it("never emits more than one decimal place on either side", () => {
    for (const m of [1, 647, 1283.947, 8712.3, 120345.6]) {
      for (const out of [web.formatDistance(m)!, native.formatDistance(m)!]) {
        expect((out.match(/\.(\d+)/)?.[1] ?? "").length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("boundsAround agrees", () => {
  const CENTRES: web.Coordinate[] = [
    { latitude: 25.2048, longitude: 55.2708 },
    { latitude: 0, longitude: 10 },
    { latitude: 64, longitude: -21 },
    { latitude: 89.99, longitude: 0 },
  ];
  for (const c of CENTRES) {
    for (const r of [5_000, 25_000, 100_000]) {
      it(`${c.latitude},${c.longitude} @ ${r}m`, () => {
        const w = web.boundsAround(c, r);
        const n = native.boundsAround(c, r);
        expect(n.minLat).toBeCloseTo(w.minLat, 9);
        expect(n.maxLat).toBeCloseTo(w.maxLat, 9);
        expect(n.minLng).toBeCloseTo(w.minLng, 9);
        expect(n.maxLng).toBeCloseTo(w.maxLng, 9);
      });
    }
  }
});

describe("the search radii are the same ladder", () => {
  it("matches exactly", () => {
    // If these drift, "No stays within 5 km" on one platform becomes
    // "within 10 km" on the other for the same reader in the same place.
    expect([...native.SEARCH_RADII_M]).toEqual([...web.SEARCH_RADII_M]);
  });
});

describe("directions availability agrees", () => {
  for (const [label, lat, lng] of COORDINATES) {
    it(label, () => {
      const target = { latitude: lat, longitude: lng, placeId: "ChIJtest" };
      const w = webDirections(target);
      const n = native.directionsUrl(target);
      // The important parity is PRESENCE: a Directions button must not appear
      // on one platform and be hidden on the other for the same property.
      expect(n === null).toBe(w === null);
      if (w && n) {
        const wq = new URL(w).searchParams;
        const nq = new URL(n).searchParams;
        expect(nq.get("destination")).toBe(wq.get("destination"));
        expect(nq.get("destination_place_id")).toBe(wq.get("destination_place_id"));
      }
    });
  }

  it("both use the cross-platform https form, not a custom scheme", () => {
    // maps:// and google.navigation: depend on the app being installed and
    // fail silently when it is not.
    const t = { latitude: 25.2048, longitude: 55.2708, placeId: "x" };
    expect(native.directionsUrl(t)!.startsWith("https://www.google.com/maps/dir/")).toBe(true);
    expect(webDirections(t)!.startsWith("https://www.google.com/maps/dir/")).toBe(true);
  });
});
