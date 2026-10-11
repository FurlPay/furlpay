// Draw-to-search on the hotel map: the geometry the route and the client share.
//
// A drawn area travels as `area=lng,lat;lng,lat;...` — compact, URL-safe and
// bounded. The server REVALIDATES everything: vertex count, coordinate ranges,
// size, and that the ring does not cross itself. An unbounded or malformed
// shape is rejected, never "repaired" into something the reader did not draw.

import type { LatLng } from "@/lib/geo/geodesy";

export type Ring = Array<[number, number]>; // [lng, lat], NOT closed

export const MIN_VERTICES = 3;
export const MAX_VERTICES = 40;
/** Same ceiling Overpass and the map route use for a viewport. */
export const MAX_SPAN_DEG = 6;
/** Hard cap on the raw parameter, before any parsing. */
export const MAX_AREA_PARAM_CHARS = 1200;

export function encodeArea(ring: Ring): string {
  return ring.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** True when no two non-adjacent edges cross. O(n²) over ≤ 40 vertices. */
export function isSimpleRing(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex and cannot "cross".
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(a, b, ring[j], ring[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function ringBBox(ring: Ring): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
}

/** Parse and validate `area=`; null for anything the server must not trust. */
export function parseArea(raw: string | null): Ring | null {
  if (!raw || raw.length > MAX_AREA_PARAM_CHARS) return null;
  const parts = raw.split(";");
  if (parts.length < MIN_VERTICES || parts.length > MAX_VERTICES) return null;
  const ring: Ring = [];
  for (const part of parts) {
    const xy = part.split(",");
    if (xy.length !== 2) return null;
    const lng = Number(xy[0]);
    const lat = Number(xy[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    ring.push([lng, lat]);
  }
  // A closing vertex equal to the first is tolerated, not required.
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (ring.length > MIN_VERTICES && f[0] === l[0] && f[1] === l[1]) ring.pop();
  const b = ringBBox(ring);
  if (b.maxLng - b.minLng > MAX_SPAN_DEG || b.maxLat - b.minLat > MAX_SPAN_DEG) return null;
  if (b.maxLng - b.minLng < 1e-5 || b.maxLat - b.minLat < 1e-5) return null; // degenerate
  if (!isSimpleRing(ring)) return null;
  return ring;
}

/** Ray-casting point-in-polygon (boundary counts as inside within float noise). */
export function inArea(p: LatLng, ring: Ring): boolean {
  const x = p.longitude, y = p.latitude;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The rectangle spanned by two corner clicks, as a ring. */
export function rectangleRing(a: LatLng, b: LatLng): Ring {
  const w = Math.min(a.longitude, b.longitude), e = Math.max(a.longitude, b.longitude);
  const s = Math.min(a.latitude, b.latitude), n = Math.max(a.latitude, b.latitude);
  return [[w, s], [e, s], [e, n], [w, n]];
}
