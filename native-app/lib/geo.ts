// ---------------------------------------------------------------------------
// Coordinates, distance and formatting — the native half.
//
// ── WHY THIS IS A SECOND COPY, WHICH IS NORMALLY WRONG ─────────────────────
// The canonical implementation is apps/web/src/lib/geo/coordinates.ts and this
// mirrors it exactly. That duplication is deliberate and it is a compromise,
// so the reasoning belongs here rather than in a commit message nobody reads.
//
// native-app is not in the root package.json `workspaces` array — the
// workspaces are apps/*, packages/*, sdks/node and mcp — so it resolves its
// own node_modules and cannot import a workspace package. Making it shareable
// means adding native-app to the workspaces AND giving Metro a `watchFolders`
// entry for the shared package. Both are reasonable changes. Neither can be
// verified in this environment: there is no simulator, no Android SDK, and EAS
// builds run remotely. Changing how the mobile app resolves modules without
// being able to build it once is how you find out at release time.
//
// So: duplicated code, with the divergence made loud instead of hoped away.
// apps/web/src/lib/geo/__tests__/nativeParity.spec.ts imports BOTH files and
// runs one fixture table through each, asserting identical output. If these
// drift, that test fails. It is not as good as one implementation; it is
// better than two that quietly disagree, which is what a card reading
// "0.4 km away" beside a hidden Directions button is made of.
//
// If native-app is ever brought into the workspace, delete this file and
// import the shared one. The parity test then has nothing to compare and
// should be deleted with it.
// ---------------------------------------------------------------------------

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Is this a position on Earth that we are willing to act on?
 *
 * `0,0` is rejected: it is a real point in the Gulf of Guinea, and it is what
 * a missing latitude and longitude collapse to when something coerced null to
 * zero. Only BOTH being zero is suspicious — the equator and the prime
 * meridian are real, and a coordinate on either is kept.
 */
export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function asCoordinate(lat?: number | null, lng?: number | null): Coordinate | null {
  return isValidCoordinate(lat, lng) ? { latitude: lat as number, longitude: lng as number } : null;
}

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius

/**
 * Great-circle distance in metres. Haversine, not degree subtraction: a degree
 * of longitude is 111km at the equator and 48km in Reykjavik.
 *
 * Returns null when either end is unknown — never 0, which would render as
 * "0 m away", the closest possible hotel, on a record we know nothing about.
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

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type DistanceUnit = "metric" | "imperial";

/**
 * Distance as a person would say it. Precision falls as distance grows: a GPS
 * fix is good to a few metres at best, so "1.283947 km" is six digits of noise
 * dressed as confidence.
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

  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
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
 * A bounding box around a point. Longitude is widened by latitude so the box
 * stays roughly square on the ground — a fixed offset searches a band half as
 * wide in Reykjavik as at the equator.
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

/**
 * Google Maps directions URL, or null when we cannot say where the place is.
 *
 * Deliberately the same cross-platform https:// form the web uses rather than
 * the `maps://` and `google.navigation:` schemes: those depend on the app
 * being installed and fail silently when it is not. Android and iOS both
 * intercept this URL into the native Maps app when it exists, and fall back to
 * the browser when it does not — which is the behaviour we want and one code
 * path instead of a Platform branch.
 */
export function directionsUrl(target: {
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
}): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) return null;
  const params = new URLSearchParams({
    api: "1",
    destination: `${target.latitude},${target.longitude}`,
    travelmode: "driving",
  });
  if (target.placeId) params.set("destination_place_id", target.placeId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
