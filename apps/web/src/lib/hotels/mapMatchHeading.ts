// ---------------------------------------------------------------------------
// Map-matched heading: using the roads we are already drawing.
//
// This is the browser-implementable half of what Google and Amap do natively.
// Their sensor fusion snaps a drifting track to the nearest logical road and
// takes the road's bearing as a heading hypothesis — the "walking a few metres
// makes the map self-correct" effect. That is map matching, not calibration.
//
// WE CAN DO IT TOO, and the reason is easy to miss: the basemap is a VECTOR
// tile set, so the road geometry is already in the browser. OpenFreeMap's
// positron style carries 19 line layers over a `transportation` source-layer,
// `highway_path` included, and MapLibre's queryRenderedFeatures hands back
// their LineStrings. No extra request, no extra key, no extra dependency — the
// data arrived with the tiles that drew the map.
//
// WHAT THIS IS FOR. Not to replace the compass, and not to place the user. It
// answers one question: does the direction we think the reader is facing agree
// with a road they could plausibly be on? Agreement raises confidence in a
// heading; disagreement is the signal that a magnetometer has been thrown by a
// steel doorframe or a magnetic phone case.
//
// ── ROADS ARE BIDIRECTIONAL ────────────────────────────────────────────────
// The single most important detail here. A street drawn west-to-east has a
// bearing of 90 degrees, and someone walking down it may be heading 90 or 270.
// Both are perfectly consistent with the geometry. So every comparison folds
// the difference into [0, 90]: 269 degrees of disagreement is really 1 degree
// of agreement in the other direction. Getting this wrong makes the matcher
// reject exactly half of all correct headings, and it fails quietly because the
// other half still works.
// ---------------------------------------------------------------------------

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * Initial great-circle bearing from `a` to `b`, degrees clockwise from north.
 *
 * Not the planar atan2 of the coordinate deltas: longitude degrees shrink with
 * latitude, so a flat calculation is wrong everywhere except the equator and
 * badly wrong at the latitudes where most cities are.
 */
export function bearingTo(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const φ1 = a.lat * toRad;
  const φ2 = b.lat * toRad;
  const Δλ = (b.lng - a.lng) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Signed smallest angle between two bearings, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * How far a heading is from a road's line, ignoring which way along it.
 *
 * Returns [0, 90]. See the note above: a road supports travel in both
 * directions, so 179 degrees of raw difference is 1 degree of misalignment.
 */
export function alignmentError(headingDeg: number, roadBearingDeg: number): number {
  const d = Math.abs(angleDelta(headingDeg, roadBearingDeg));
  return d > 90 ? 180 - d : d;
}

/** Approximate metres between two points. Equirectangular, which is accurate
 *  well past the few hundred metres this module ever looks at. */
export function metersBetween(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * R;
}

export interface RoadCandidate {
  /** Bearing of the nearest segment, degrees clockwise from north. */
  bearing: number;
  /** Distance from the user to that segment's nearest endpoint, in metres. */
  distance: number;
}

/**
 * Turn LineString geometries into bearing candidates near a point.
 *
 * Takes the raw coordinate rings so the caller can pass whatever
 * queryRenderedFeatures returned without this module importing MapLibre —
 * which also makes the whole thing testable with plain arrays.
 *
 * Only segments within `radiusM` are considered. A road two hundred metres away
 * says nothing about which way someone is walking here.
 */
export function roadCandidates(
  lines: readonly (readonly [number, number][])[],
  at: LngLat,
  radiusM = 40
): RoadCandidate[] {
  const out: RoadCandidate[] = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = { lng: line[i][0], lat: line[i][1] };
      const b = { lng: line[i + 1][0], lat: line[i + 1][1] };
      // Endpoint distance rather than true point-to-segment distance: the
      // tiles are already generalised at these zooms, so segments are short,
      // and the exact perpendicular buys nothing a 40m radius does not.
      const d = Math.min(metersBetween(at, a), metersBetween(at, b));
      if (d > radiusM) continue;
      // A zero-length segment has no bearing to speak of.
      if (metersBetween(a, b) < 1) continue;
      out.push({ bearing: bearingTo(a, b), distance: d });
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}

export interface MapMatch {
  /** The road bearing that best explains the observed heading, or null. */
  bearing: number | null;
  /** Misalignment with that road, in [0, 90]. */
  errorDegrees: number | null;
  /** How much this supports the observed heading, in [0, 1]. */
  support: number;
  /** How many road segments were in range at all. */
  candidates: number;
}

/**
 * Does the observed heading agree with any road the reader could be on?
 *
 * Scored rather than accepted or rejected, because the caller is combining this
 * with a compass and a GPS course and needs a weight, not a verdict. Nearer
 * roads count for more: the street underfoot is better evidence than one across
 * the square.
 *
 * Returns zero support when nothing is in range — an open plaza, a beach, a
 * resort lawn. That is an honest "no opinion", NOT evidence against the
 * heading, and the caller must not read it as such.
 */
export function matchHeading(
  observedHeadingDeg: number | null,
  candidates: readonly RoadCandidate[],
  tolerance = 30
): MapMatch {
  if (observedHeadingDeg === null || !Number.isFinite(observedHeadingDeg) || !candidates.length) {
    return { bearing: null, errorDegrees: null, support: 0, candidates: candidates.length };
  }

  let best: { bearing: number; err: number; score: number } | null = null;
  for (const c of candidates) {
    const err = alignmentError(observedHeadingDeg, c.bearing);
    if (err > tolerance) continue;
    // Linear falloff on both angle and distance. Deliberately simple: a
    // Gaussian would imply a precision this evidence does not have.
    const angleScore = 1 - err / tolerance;
    const distScore = 1 - Math.min(1, c.distance / 40);
    const score = angleScore * (0.5 + 0.5 * distScore);
    if (!best || score > best.score) best = { bearing: c.bearing, err, score };
  }

  if (!best) {
    // Roads were in range and NONE agreed. That is real evidence the heading is
    // wrong, and the caller can tell it apart from "no roads here" by looking
    // at `candidates`.
    return { bearing: null, errorDegrees: null, support: 0, candidates: candidates.length };
  }

  return {
    bearing: best.bearing,
    errorDegrees: best.err,
    support: Math.max(0, Math.min(1, best.score)),
    candidates: candidates.length,
  };
}

/**
 * Which way along the matched road the reader is actually going.
 *
 * The road gives an axis; the direction along it comes from the reader. GPS
 * course is preferred when moving because it is derived from successive
 * positions and owes nothing to the magnetometer; the compass is the fallback.
 * Returns the road bearing or its reciprocal, whichever the observation is
 * nearer to — which is how a heading gets SNAPPED to a road rather than merely
 * checked against one.
 */
export function snapToRoad(
  roadBearingDeg: number,
  observedHeadingDeg: number
): number {
  const forward = ((roadBearingDeg % 360) + 360) % 360;
  const reverse = (forward + 180) % 360;
  return Math.abs(angleDelta(observedHeadingDeg, forward)) <=
    Math.abs(angleDelta(observedHeadingDeg, reverse))
    ? forward
    : reverse;
}
