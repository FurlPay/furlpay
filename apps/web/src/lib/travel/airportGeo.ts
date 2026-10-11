// Airports with positions, for the hotel map: the airport layer, the
// hotel → airport distance, and flight-route endpoints.
//
// Server-only, like airportSearch.ts: it joins that index with
// airportCoords.json (OurAirports latitude/longitude, public domain, built by
// scripts/travel/build-airports.mjs --coords-only). The client asks
// /api/travel/airports/map for what is in view; neither table ships to the
// browser.

import coords from "./airportCoords.json";
import { airportByIata, type Airport } from "./airportSearch";
import rows from "./airportsData.json";
import { haversineKm, type LatLng } from "@/lib/geo/geodesy";

export interface GeoAirport extends Airport {
  latitude: number;
  longitude: number;
}

const COORDS = coords as unknown as Record<string, [number, number]>;

const ALL: GeoAirport[] = (rows as [string, ...unknown[]][])
  .map(([iata]) => {
    const a = airportByIata(iata);
    const c = COORDS[iata];
    return a && c ? { ...a, latitude: c[0], longitude: c[1] } : null;
  })
  .filter((a): a is GeoAirport => a !== null);

export function geoAirportByIata(code: string): GeoAirport | undefined {
  const a = airportByIata(code);
  const c = a && COORDS[a.iata];
  return a && c ? { ...a, latitude: c[0], longitude: c[1] } : undefined;
}

/**
 * The smallest airport size worth drawing at a zoom. A world view of 4,000
 * airports is noise; large hubs read at country scale, regional airports at
 * region scale, everything once a city fills the screen.
 */
export function minSizeForZoom(zoom: number): number {
  if (zoom < 5) return 3;
  if (zoom < 7.5) return 2;
  return 1;
}

export const MAX_AIRPORTS_PER_VIEW = 250;

export function airportsInBBox(
  box: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoom: number,
  limit = MAX_AIRPORTS_PER_VIEW
): GeoAirport[] {
  const min = minSizeForZoom(zoom);
  const crosses = box.minLng > box.maxLng; // antimeridian-spanning view
  const out: GeoAirport[] = [];
  for (const a of ALL) {
    if (a.size < min) continue;
    if (a.latitude < box.minLat || a.latitude > box.maxLat) continue;
    const inLng = crosses
      ? a.longitude >= box.minLng || a.longitude <= box.maxLng
      : a.longitude >= box.minLng && a.longitude <= box.maxLng;
    if (!inLng) continue;
    out.push(a);
  }
  // Larger first, so a cap drops the small fields, never the hubs.
  return out.sort((x, y) => y.size - x.size || x.iata.localeCompare(y.iata)).slice(0, limit);
}

/**
 * Nearest airports to a point by straight-line distance — the honest default
 * for "how far is the airport": it is labelled straight-line wherever shown,
 * never as a drive.
 *
 * Small fields are skipped (size >= 2) unless nothing else is in range: a
 * grass strip 9 km away is not the airport a traveller means.
 */
export function nearestAirports(
  p: LatLng,
  limit = 2,
  maxKm = 200
): Array<GeoAirport & { distanceKm: number }> {
  const scored = ALL.map((a) => ({ ...a, distanceKm: haversineKm(p, a) })).filter(
    (a) => Number.isFinite(a.distanceKm) && a.distanceKm <= maxKm
  );
  const commercial = scored.filter((a) => a.size >= 2);
  return (commercial.length ? commercial : scored)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, Math.min(limit, 5)));
}
