// Spherical geometry for the hotel map: distances, radius circles and
// great-circle routes.
//
// WHY NOT TURF. Three functions — a haversine, a circle and a great-circle arc
// — are about sixty lines of well-known maths. Pulling in @turf/circle and
// @turf/great-circle (and their dependency trees) for them would add more code
// than it saves. A mean-earth sphere is accurate to ~0.5%, which is far inside
// what a "12.4 km straight-line" label or a drawn radius needs.

export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLng {
  latitude: number;
  longitude: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180
  );
}

/** Great-circle (straight-line) distance in km. NaN for invalid input — a
 *  distance must never be invented for a coordinate that is not one. */
export function haversineKm(a: LatLng, b: LatLng): number {
  if (!isValidLatLng(a) || !isValidLatLng(b)) return NaN;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" under a kilometre, "12.4 km" under 100, "312 km" beyond. */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** The point `distanceKm` from `from` along `bearingDeg` (0 = north). */
export function destination(from: LatLng, distanceKm: number, bearingDeg: number): LatLng {
  const d = distanceKm / EARTH_RADIUS_KM;
  const b = rad(bearingDeg);
  const lat1 = rad(from.latitude);
  const lng1 = rad(from.longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: deg(lat2), longitude: ((deg(lng2) + 540) % 360) - 180 };
}

/** A closed polygon ring approximating a circle on the sphere — what the map
 *  draws for a radius search. */
export function circlePolygon(center: LatLng, radiusKm: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destination(center, radiusKm, (i / steps) * 360);
    ring.push([p.longitude, p.latitude]);
  }
  ring.push(ring[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** The bounding box that contains a circle, for the bbox the map route needs. */
export function circleBBox(center: LatLng, radiusKm: number): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const n = destination(center, radiusKm, 0).latitude;
  const s = destination(center, radiusKm, 180).latitude;
  const dLng = (radiusKm / (EARTH_RADIUS_KM * Math.cos(rad(center.latitude)))) * (180 / Math.PI);
  return {
    minLat: Math.max(-90, s),
    maxLat: Math.min(90, n),
    minLng: Math.max(-180, center.longitude - dLng),
    maxLng: Math.min(180, center.longitude + dLng),
  };
}

/**
 * Great-circle arc between two points, as GeoJSON.
 *
 * Interpolated by slerp on the unit sphere. Split into a MultiLineString where
 * it crosses the antimeridian, otherwise MapLibre would draw the long way
 * round the world (SFO → NRT would cross the Atlantic).
 */
export function greatCircle(a: LatLng, b: LatLng, npoints = 96): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> {
  const toV = (p: LatLng) => {
    const la = rad(p.latitude), lo = rad(p.longitude);
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const va = toV(a), vb = toV(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const pts: [number, number][] = [];
  for (let i = 0; i <= npoints; i++) {
    const t = i / npoints;
    let v: number[];
    if (omega < 1e-9) v = va;
    else {
      const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const s2 = Math.sin(t * omega) / Math.sin(omega);
      v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
    }
    pts.push([deg(Math.atan2(v[1], v[0])), deg(Math.atan2(v[2], Math.hypot(v[0], v[1])))]);
  }
  // Split wherever consecutive longitudes jump across ±180.
  const parts: [number, number][][] = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const [lng0, lat0] = pts[i - 1];
    const [lng1, lat1] = pts[i];
    if (Math.abs(lng1 - lng0) > 180) {
      const edge = lng0 > 0 ? 180 : -180;
      const lng1u = lng1 + (lng0 > 0 ? 360 : -360);
      const f = (edge - lng0) / (lng1u - lng0);
      const latX = lat0 + f * (lat1 - lat0);
      parts[parts.length - 1].push([edge, latX]);
      parts.push([[-edge, latX], [lng1, lat1]]);
    } else parts[parts.length - 1].push([lng1, lat1]);
  }
  return parts.length === 1
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: parts[0] } }
    : { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: parts } };
}
