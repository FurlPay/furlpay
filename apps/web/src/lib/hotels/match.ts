import { haversineMeters, jaroWinkler, normalizeName } from "./h3";
import type { DuffelAccommodation } from "@/lib/travel/duffel";

// ---------------------------------------------------------------------------
// Matching an OpenStreetMap hotel to a Duffel accommodation.
//
// These are two independent records of the same building, and they disagree.
// OSM has "The Oberoi Bengaluru" on the building centroid; Duffel may have
// "The Oberoi, Bangalore" at the entrance 60m away. Neither is wrong.
//
// THE FAILURE MODE THIS GUARDS AGAINST is not missing a match - it is making a
// wrong one, because a wrong match prices hotel A with hotel B's rate. That is
// indistinguishable from inventing a price. So the pipeline reports a
// CONFIDENCE and only HIGH is allowed to drive a displayed rate; everything
// else leaves the marker priceless rather than wrong.
//
// THE OSM COORDINATE IS AUTHORITATIVE. A match never moves the marker. Duffel
// supplies commerce, OSM supplies geography.
// ---------------------------------------------------------------------------

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNMATCHED";

export interface HotelMatch {
  osmHotelId: string;
  duffelAccommodationId: string;
  duffelName: string;
  confidence: MatchConfidence;
  distanceMeters: number;
  nameSimilarity: number;
  /** Combined 0-1 score; ranking only, never a display value. */
  score: number;
}

export interface OsmSubject {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  countryCode?: string;
  brand?: string;
}

/**
 * Thresholds.
 *
 * HIGH is deliberately strict on BOTH axes. A near-identical name at 120m is a
 * match; the same name at 900m is a different property of the same chain, which
 * is exactly the Hilton-London case: "Hilton London Metropole" and "Hilton
 * London Bankside" share two of three tokens and sit 4km apart. Distance alone
 * would separate them and name alone would merge them - requiring both is what
 * makes the pair safe.
 */
const HIGH_NAME = 0.92;
const HIGH_DISTANCE_M = 150;
const MEDIUM_NAME = 0.85;
const MEDIUM_DISTANCE_M = 400;
/** Below this, a candidate is not evidence of anything. */
const FLOOR_NAME = 0.7;
const FLOOR_DISTANCE_M = 1500;

function classify(nameSim: number, distanceM: number): MatchConfidence {
  if (nameSim >= HIGH_NAME && distanceM <= HIGH_DISTANCE_M) return "HIGH";
  if (nameSim >= MEDIUM_NAME && distanceM <= MEDIUM_DISTANCE_M) return "MEDIUM";
  // A very strong name a little further out is still worth surfacing, but only
  // as MEDIUM - it must not auto-price.
  if (nameSim >= 0.95 && distanceM <= 800) return "MEDIUM";
  if (nameSim >= FLOOR_NAME && distanceM <= FLOOR_DISTANCE_M) return "LOW";
  return "UNMATCHED";
}

/**
 * Score a single candidate.
 *
 * Name and distance carry the decision. City, country and brand only break ties
 * between candidates that already passed on the two axes that matter - they are
 * frequently absent in OSM, so letting them carry weight would penalise
 * correctly-matched hotels for having sparse tags.
 */
export function scoreCandidate(
  osm: OsmSubject,
  cand: DuffelAccommodation
): { score: number; nameSimilarity: number; distanceMeters: number } | null {
  if (cand.latitude === undefined || cand.longitude === undefined) return null;

  const distanceMeters = haversineMeters(
    osm.latitude,
    osm.longitude,
    cand.latitude,
    cand.longitude
  );
  const nameSimilarity = jaroWinkler(normalizeName(osm.name), normalizeName(cand.name));

  // Distance term decays to 0 at the floor, so a far candidate cannot be
  // rescued by its name alone.
  const proximity = Math.max(0, 1 - distanceMeters / FLOOR_DISTANCE_M);

  let score = 0.6 * nameSimilarity + 0.3 * proximity;
  if (osm.city && cand.city && normalizeName(osm.city) === normalizeName(cand.city)) score += 0.04;
  if (
    osm.countryCode &&
    cand.countryCode &&
    osm.countryCode.toUpperCase() === cand.countryCode.toUpperCase()
  ) {
    score += 0.03;
  }
  if (osm.brand && (cand.brand || cand.chain)) {
    const b = normalizeName(osm.brand);
    if (b && (normalizeName(cand.brand ?? "") === b || normalizeName(cand.chain ?? "") === b)) {
      score += 0.03;
    }
  }

  return { score: Math.min(1, score), nameSimilarity, distanceMeters };
}

/**
 * Best match for an OSM hotel among Duffel candidates.
 *
 * Returns UNMATCHED rather than null when candidates existed but none was
 * credible, so a caller can distinguish "Duffel has nothing here" from "Duffel
 * has properties here but none is this hotel".
 */
export function bestMatch(osm: OsmSubject, candidates: DuffelAccommodation[]): HotelMatch | null {
  let best: HotelMatch | null = null;

  for (const cand of candidates) {
    const scored = scoreCandidate(osm, cand);
    if (!scored) continue;

    const confidence = classify(scored.nameSimilarity, scored.distanceMeters);
    if (confidence === "UNMATCHED") continue;

    const match: HotelMatch = {
      osmHotelId: osm.id,
      duffelAccommodationId: cand.id,
      duffelName: cand.name,
      confidence,
      distanceMeters: Math.round(scored.distanceMeters),
      nameSimilarity: Math.round(scored.nameSimilarity * 1000) / 1000,
      score: Math.round(scored.score * 1000) / 1000,
    };
    if (!best || match.score > best.score) best = match;
  }

  return best;
}

/** Radii to try, in order. Small first: a wide sweep costs more upstream calls
 *  AND admits more false candidates, so it is the last resort, not the first. */
export const ESCALATING_RADII_KM = [1, 2, 5] as const;

/**
 * Find a Duffel property for an OSM hotel, widening the radius only while the
 * result is still inconclusive.
 *
 * Stops as soon as a HIGH match appears - a closer, better candidate cannot
 * exist further out, so continuing would only spend calls and risk a false
 * positive.
 */
export async function findDuffelMatch(
  osm: OsmSubject,
  fetchCandidates: (radiusKm: number) => Promise<DuffelAccommodation[] | null>
): Promise<HotelMatch | null> {
  let best: HotelMatch | null = null;

  for (const radiusKm of ESCALATING_RADII_KM) {
    const candidates = await fetchCandidates(radiusKm);
    if (!candidates || !candidates.length) continue;

    const m = bestMatch(osm, candidates);
    if (m && (!best || m.score > best.score)) best = m;
    if (best?.confidence === "HIGH") break;
  }

  return best;
}

/** Only a HIGH match may drive a price. Anything weaker prices a guess. */
export function mayPrice(match: HotelMatch | null): boolean {
  return match?.confidence === "HIGH";
}
