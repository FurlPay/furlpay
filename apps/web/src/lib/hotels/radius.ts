// Radius search on the hotel map — the parts the route and the client share.

import { haversineKm, isValidLatLng, type LatLng } from "@/lib/geo/geodesy";

/** The radii a reader can pick. A closed set: the route rejects anything else,
 *  so a URL cannot ask the server to scan an arbitrary circle. */
export const RADIUS_OPTIONS_KM = [1, 2, 5, 10, 25] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

export interface RadiusQuery {
  center: LatLng;
  km: RadiusKm;
}

export function isRadiusKm(n: number): n is RadiusKm {
  return (RADIUS_OPTIONS_KM as readonly number[]).includes(n);
}

/** `near=lat,lng` + `radiusKm=5` → a RadiusQuery, or null when absent/invalid. */
export function parseRadius(near: string | null, radiusKm: string | null): RadiusQuery | null {
  if (!near || !radiusKm) return null;
  const parts = near.split(",").map(Number);
  if (parts.length !== 2) return null;
  const center = { latitude: parts[0], longitude: parts[1] };
  const km = Number(radiusKm);
  if (!isValidLatLng(center) || !isRadiusKm(km)) return null;
  return { center, km };
}

/** True when the point lies inside the circle (edge inclusive). */
export function withinRadius(p: LatLng, r: RadiusQuery): boolean {
  const d = haversineKm(r.center, p);
  return Number.isFinite(d) && d <= r.km;
}
