// ---------------------------------------------------------------------------
// Coordinates: one validator, one distance, one formatter.
//
// THE POINT IS THAT THERE IS ONLY ONE. Before this, `isPlottable` lived inside
// directions.ts, which meant the directions button and everything else could
// disagree about whether a property has a position. That disagreement is not
// theoretical — it is how a card ends up showing "0.4 km away" for a property
// whose Directions button is hidden because the same coordinate was judged
// invalid three files away. Markers, directions, distance, ranking, the detail
// page and the native app all import from here.
// ---------------------------------------------------------------------------

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Is this a position on Earth that we are willing to act on?
 *
 * `0,0` is rejected deliberately. It is a real point in the Gulf of Guinea and
 * nothing we index is there — but it is exactly what a missing latitude and
 * longitude collapse to when something upstream coerced null to zero. Treating
 * it as valid puts a marker in the ocean and tells someone it is 4,000km away.
 *
 * Only BOTH being zero is suspicious. The equator and the prime meridian are
 * real, and a coordinate on either is kept.
 */
export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Narrowing helper, so callers can hand an object straight through. */
export function asCoordinate(
  lat?: number | null,
  lng?: number | null
): Coordinate | null {
  return isValidCoordinate(lat, lng) ? { latitude: lat as number, longitude: lng as number } : null;
}

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius

/**
 * Great-circle distance in metres.
 *
 * Haversine, not a flat-earth approximation over degrees: a degree of
 * longitude is 111km at the equator and 48km in Reykjavik, so subtracting
 * degrees would rank a Nordic city's hotels wrongly against each other and
 * absurdly against anywhere else.
 *
 * Returns null when either end is not a position — a distance to nowhere is
 * not zero, and rendering it as zero would put "0 m away" on a broken record.
 */
export function distanceMeters(a: Coordinate | null, b: Coordinate | null): number | null {
  if (!a || !b) return null;
  if (!isValidCoordinate(a.latitude, a.longitude)) return null;
  if (!isValidCoordinate(b.latitude, b.longitude)) return null;

  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type DistanceUnit = "metric" | "imperial";

/**
 * Distance as a person would say it.
 *
 * Precision falls as distance grows, because it stops meaning anything: a GPS
 * fix is good to a few metres at best, so "1.283947 km" is six digits of noise
 * dressed as confidence. Under a kilometre reads in round tens of metres, then
 * one decimal, then whole units.
 *
 * Returns null for a null distance so a caller renders nothing rather than a
 * dash that looks like a real value.
 */
export function formatDistance(
  meters: number | null,
  unit: DistanceUnit = "metric"
): string | null {
  if (meters === null || !Number.isFinite(meters) || meters < 0) return null;

  if (unit === "imperial") {
    const feet = meters * 3.28084;
    if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
    const miles = meters / 1609.344;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }

  if (meters < 1000) {
    // Round tens of metres. A GPS fix is not accurate to the metre and
    // printing one implies it is.
    return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  }
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** "1.2 km away", or null when there is no distance to state. */
export function formatDistanceAway(
  meters: number | null,
  unit: DistanceUnit = "metric"
): string | null {
  const d = formatDistance(meters, unit);
  return d === null ? null : `${d} away`;
}

/**
 * A bounding box around a point, for a radius query.
 *
 * Longitude is widened by latitude so the box stays roughly square on the
 * ground. A fixed degree offset would search a band about half as wide in
 * Reykjavik as at the equator, and the reader would see fewer results purely
 * as an artefact of the projection.
 */
export function boundsAround(centre: Coordinate, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const cos = Math.cos((centre.latitude * Math.PI) / 180);
  const lngDelta = radiusMeters / (111_320 * Math.max(0.01, Math.abs(cos)));
  return {
    minLat: Math.max(-90, centre.latitude - latDelta),
    maxLat: Math.min(90, centre.latitude + latDelta),
    minLng: Math.max(-180, centre.longitude - lngDelta),
    maxLng: Math.min(180, centre.longitude + lngDelta),
  };
}

/** Radii the "nothing nearby" recovery steps through, in metres. */
export const SEARCH_RADII_M = [5_000, 25_000, 100_000] as const;
