import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapCluster, MapPoint } from "@/app/api/travel/hotels/map/route";
import { buildFeatures, SRC_POINTS } from "../layers";

// ---------------------------------------------------------------------------
// The path that decides whether anything appears on the map.
//
// buildFeatures runs on every repaint and every zoom. If it throws, the sources
// keep their old contents and the map shows a basemap with no pins — which
// looks exactly like "there are no hotels here" rather than like a bug. That
// failure mode is why this is tested rather than eyeballed.
//
// The map is stubbed with MapLibre's real projection CONTRACT: project() takes
// a [lng, lat] tuple and returns {x, y}; unproject() takes a point and returns
// an object with .lng and .lat. The arithmetic is a plain Web Mercator so the
// round trip is faithful enough to catch a shape error, which is the class of
// bug that actually bites here.
// ---------------------------------------------------------------------------

const SCALE = 4096;

function stubMap(): MapLibreMap {
  const project = (ll: [number, number]) => {
    const [lng, lat] = ll;
    const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return {
      x: ((lng + 180) / 360) * SCALE,
      y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * SCALE,
    };
  };
  const unproject = (p: unknown) => {
    // MapLibre normalises a point through Point.convert. Accepting ONLY the
    // tuple form here is deliberate: it is what pins the caller to the shape
    // every version of Point.convert handles. Passing {x, y} fails this test.
    if (!Array.isArray(p)) {
      throw new Error("unproject expects a [x, y] tuple");
    }
    const [x, y] = p as [number, number];
    const n = Math.PI * (1 - (2 * y) / SCALE);
    return {
      lng: (x / SCALE) * 360 - 180,
      lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    };
  };
  return { project, unproject } as unknown as MapLibreMap;
}

const cluster = (over: Partial<MapCluster> = {}): MapCluster => ({
  id: "cl_3_1:2",
  kind: "cluster",
  latitude: 45.44,
  longitude: 12.33,
  count: 12,
  topName: "Aman Venice",
  label: "Venice",
  sublabel: "12 properties",
  families: { hotels: 8, resorts: 3, villas: 1 },
  confirmed: 11,
  top: [],
  bounds: { minLat: 45.4, minLng: 12.3, maxLat: 45.5, maxLng: 12.4 },
  ...over,
});

const point = (over: Partial<MapPoint> = {}): MapPoint => ({
  id: "lux_italy_aman-venice",
  kind: "property",
  source: "curated",
  latitude: 45.4368,
  longitude: 12.332,
  name: "Aman Venice",
  city: "Venice",
  country: "Italy",
  stars: 5,
  hotelType: "Hotel",
  categories: ["ultra_luxury"],
  precision: "exact",
  ...over,
});

describe("buildFeatures", () => {
  it("emits one feature per cluster and per point", () => {
    const built = buildFeatures([cluster()], [point()], stubMap());
    expect(built.points.features).toHaveLength(2);
    expect(built.index.size).toBe(2);
  });

  it("gives every feature a numeric id, which feature-state hover requires", () => {
    const built = buildFeatures([cluster()], [point()], stubMap());
    for (const f of built.points.features) {
      expect(typeof f.id).toBe("number");
      expect(Number.isFinite(f.id as number)).toBe(true);
    }
  });

  it("keeps ids stable across rebuilds, so hover survives a pan", () => {
    const a = buildFeatures([cluster()], [point()], stubMap());
    const b = buildFeatures([cluster()], [point()], stubMap());
    expect(a.points.features.map((f) => f.id)).toEqual(b.points.features.map((f) => f.id));
  });

  it("produces coordinates that are actually on the earth", () => {
    // A projection shape error shows up here as NaN rather than as a throw,
    // and NaN coordinates make MapLibre drop the feature silently.
    const built = buildFeatures([cluster()], [point()], stubMap());
    for (const f of built.points.features) {
      const [lng, lat] = f.geometry.coordinates;
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    }
  });

  it("carries only primitives in feature properties", () => {
    // MapLibre stringifies anything else, which turns a category array into
    // "[object Object]" in an expression and breaks the layer filter.
    const built = buildFeatures([cluster()], [point()], stubMap());
    for (const f of built.points.features) {
      for (const v of Object.values(f.properties)) {
        expect(["string", "number", "boolean"]).toContain(typeof v);
      }
    }
  });

  it("separates co-located markers and tethers each to its true position", () => {
    // The Cusco pair: Belmond Hotel Monasterio and Belmond Palacio Nazarenas,
    // 38m apart. Both must remain clickable, and the leader lines are what make
    // the displacement honest rather than a quiet lie about where they are.
    const a = point({ id: "a", name: "Belmond Hotel Monasterio", latitude: -13.51529, longitude: -71.97691 });
    const b = point({ id: "b", name: "Belmond Palacio Nazarenas", latitude: -13.51499, longitude: -71.97708 });
    const built = buildFeatures([], [a, b], stubMap());

    expect(built.leaders.features).toHaveLength(2);

    const drawn = built.points.features.map((f) => f.geometry.coordinates);
    const apart = Math.hypot(drawn[0][0] - drawn[1][0], drawn[0][1] - drawn[1][1]);
    const originally = Math.hypot(a.longitude - b.longitude, a.latitude - b.latitude);
    expect(apart).toBeGreaterThan(originally);

    // The index — which the hover card and the accessible list both read — must
    // still hold where the hotels REALLY are.
    expect(built.index.get("a")!.lngLat).toEqual([a.longitude, a.latitude]);
    expect(built.index.get("b")!.lngLat).toEqual([b.longitude, b.latitude]);
  });

  it("leaves a lone marker exactly where it is", () => {
    const built = buildFeatures([], [point()], stubMap());
    expect(built.leaders.features).toHaveLength(0);
    expect(built.points.features[0].geometry.coordinates).toEqual([12.332, 45.4368]);
  });

  it("marks an unconfirmed position so the layer can draw it differently", () => {
    const built = buildFeatures([], [point({ precision: "approximate" })], stubMap());
    expect(built.points.features[0].properties.approx).toBe(1);
  });

  it("carries a price label only for hotels that hold one, never for clusters", () => {
    const p = point();
    const built = buildFeatures([cluster()], [p], stubMap(), null, new Map([[p.id, "$142"]]));
    const byKind = Object.fromEntries(built.points.features.map((f) => [f.properties.kind, f.properties.price]));
    expect(byKind.property).toBe("$142");
    expect(byKind.cluster).toBe("");
    expect(buildFeatures([], [p], stubMap()).points.features[0].properties.price).toBe("");
  });

  it("handles an empty viewport without throwing", () => {
    const built = buildFeatures([], [], stubMap());
    expect(built.points.features).toEqual([]);
    expect(built.leaders.features).toEqual([]);
  });
});

describe("source naming", () => {
  it("keeps the source id the component and the layers agree on", () => {
    // A typo here is invisible until runtime, where it shows as a map with a
    // basemap and no markers.
    expect(SRC_POINTS).toBe("hm-points");
  });
});
