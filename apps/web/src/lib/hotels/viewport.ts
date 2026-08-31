// ---------------------------------------------------------------------------
// When is what we already fetched no longer good enough for what is on screen?
//
// The map used to answer this with "always": every `moveend` fired a request on
// a 350ms debounce, so dragging across a continent issued a request per pause.
// That is a lot of work for results nobody asked to see, and it makes the map
// feel like it is chasing the reader rather than waiting for them.
//
// The rule now has two halves, and this module is the geometric one:
//
//   ZOOM changed  -> refetch immediately. The API clusters for a given zoom and
//                    caps the response, so a different zoom is a genuinely
//                    different answer, not the same answer re-framed.
//   PAN only      -> offer. Ask with a button rather than assume.
//
// Pure, so the threshold is a tested number rather than something tuned by
// dragging a map around and squinting.
// ---------------------------------------------------------------------------

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * The fraction of `now` that `loaded` does NOT cover, from 0 to 1.
 *
 * 0 means the current viewport sits entirely inside what was fetched — there is
 * nothing new to show. 1 means they are disjoint. Degenerate or inverted boxes
 * return 1: a viewport with no area cannot be said to be covered, and treating
 * "I cannot tell" as "fully covered" would suppress the offer exactly when the
 * map is in a state nobody has reasoned about.
 *
 * ANTIMERIDIAN. This works in raw lng/lat and does not wrap. The caller clamps
 * bounds to ±180 before fetching (see `load` in HotelMap), so a viewport that
 * straddles 180° arrives here already flattened; the answer there is
 * conservative — it over-reports drift and offers a refetch — which is the safe
 * direction to be wrong in.
 */
export function uncoveredFraction(loaded: BBox, now: BBox): number {
  const w = now.maxLng - now.minLng;
  const h = now.maxLat - now.minLat;
  if (!(w > 0) || !(h > 0)) return 1;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 1;

  const overlapW = Math.max(
    0,
    Math.min(now.maxLng, loaded.maxLng) - Math.max(now.minLng, loaded.minLng)
  );
  const overlapH = Math.max(
    0,
    Math.min(now.maxLat, loaded.maxLat) - Math.max(now.minLat, loaded.minLat)
  );

  const covered = (overlapW * overlapH) / (w * h);
  // Clamped because floating-point can put a fully-covered box a hair over 1.
  return Math.min(1, Math.max(0, 1 - covered));
}

/**
 * How much of the view has to be new before the offer appears.
 *
 * A quarter. Below that the reader has nudged the map and the markers already
 * on screen still answer the question; above it they are looking somewhere the
 * data does not describe.
 */
export const DRIFT_THRESHOLD = 0.25;

/**
 * A zoom change smaller than this is a nudge, not a new question.
 *
 * Trackpad pinches emit a continuous stream of small deltas, and treating each
 * settled frame as a new zoom level would refetch constantly while someone is
 * still adjusting.
 */
export const ZOOM_EPSILON = 0.35;

/** What the map should do after the reader finishes moving it. */
export type ViewAction = "refetch" | "offer" | "nothing";

/**
 * Decide, given what was last fetched and where the camera now is.
 *
 * `loaded` being null means nothing has been fetched yet, which can only happen
 * before the first response — there is no view to compare against, so the map
 * fetches rather than offering the reader a button for data that has never
 * existed.
 */
export function decideViewAction(
  loaded: { bbox: BBox; zoom: number } | null,
  now: { bbox: BBox; zoom: number }
): ViewAction {
  if (!loaded) return "refetch";
  if (Math.abs(now.zoom - loaded.zoom) > ZOOM_EPSILON) return "refetch";
  return uncoveredFraction(loaded.bbox, now.bbox) > DRIFT_THRESHOLD ? "offer" : "nothing";
}
