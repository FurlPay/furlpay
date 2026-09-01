// ---------------------------------------------------------------------------
// Google Maps URLs for directions and place lookup.
//
// Uses the official cross-platform Maps URLs API, which Google documents as
// working on Android, iOS and desktop from a single https:// link — the mobile
// apps intercept it, everything else opens the web map — and which explicitly
// needs no API key. That is why this builds URLs rather than the
// platform-sniffed `maps://` and `google.navigation:` schemes: those depend on
// the app being installed, silently fail when it is not, and need a Platform
// branch that then has to be kept correct on every surface.
//
// ── WHY EVERY FUNCTION CAN RETURN NULL ─────────────────────────────────────
// A directions button that opens a map pointed at nowhere is worse than no
// button. The dataset has coordinates on all 16,014 properties today, but it
// is fed by an external provider and a record with a missing or malformed
// position is a matter of when. So the coordinate is validated here and the
// caller is expected to hide the control when this returns null, rather than
// rendering a link that leads somewhere wrong.
// ---------------------------------------------------------------------------

import { isValidCoordinate } from "@/lib/geo/coordinates";

/** How the reader wants to travel. Google's own parameter values. */
export type TravelMode = "driving" | "walking" | "bicycling" | "transit" | "two-wheeler";

export interface DirectionsTarget {
  latitude?: number | null;
  longitude?: number | null;
  /** Google place id. Sharpens the destination and names it in the app. */
  placeId?: string | null;
  /** Shown as the destination label when there is no place id. */
  name?: string | null;
}

/**
 * Re-exported so existing callers keep working, but the implementation now
 * lives in lib/geo/coordinates.
 *
 * It was defined here first, which meant the directions button owned its own
 * opinion about whether a property has a position — and the distance label,
 * the marker and the native app each had room to form a different one. A card
 * reading "0.4 km away" beside a hidden Directions button is what that
 * disagreement looks like.
 */
export { isValidCoordinate as isPlottable } from "@/lib/geo/coordinates";

/**
 * Directions to a property, or null when we cannot say where it is.
 *
 * The place id is sent alongside the coordinate rather than instead of it:
 * Google's parameter documentation pairs `destination_place_id` with
 * `destination`, and the coordinate is what keeps the link working if the id
 * is ever retired.
 */
export function directionsUrl(
  target: DirectionsTarget,
  mode: TravelMode = "driving"
): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) return null;

  const params = new URLSearchParams({
    api: "1",
    destination: `${target.latitude},${target.longitude}`,
    travelmode: mode,
  });
  if (target.placeId) params.set("destination_place_id", target.placeId);

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * The property's own page on Google Maps, or null.
 *
 * A place id alone is enough here and is the better key — it survives a
 * rename. The coordinate form is the fallback for records we hold a position
 * for but no id.
 */
export function placeUrl(target: DirectionsTarget): string | null {
  if (target.placeId) {
    const params = new URLSearchParams({ api: "1", query_place_id: target.placeId });
    // `query` is required alongside query_place_id. The name is the honest
    // value; the coordinate is used when we do not have one.
    params.set(
      "query",
      target.name ??
        (isValidCoordinate(target.latitude, target.longitude)
          ? `${target.latitude},${target.longitude}`
          : "")
    );
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  if (!isValidCoordinate(target.latitude, target.longitude)) return null;
  const params = new URLSearchParams({
    api: "1",
    query: `${target.latitude},${target.longitude}`,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
