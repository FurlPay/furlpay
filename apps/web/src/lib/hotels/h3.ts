import { latLngToCell, gridDisk } from "h3-js";

// ---------------------------------------------------------------------------
// Spatial consensus: merging the same hotel arriving from different sources.
//
// THE PROBLEM. OpenStreetMap calls it "Aman Tokyo". Google calls it
// "Aman Tokyo - Amman Tokyo". OSM puts it on the building centroid, Google on
// the entrance 40m away. They are one hotel. Matching on name alone merges
// every "Hilton Garden Inn" in a city into one; matching on distance alone
// merges a hotel with the hostel in its basement.
//
// THE APPROACH. Require BOTH: near in space and near in name. H3 makes the
// spatial half cheap - instead of comparing every candidate against every other
// (O(n^2), which at 100k properties is 5 billion comparisons), each candidate is
// binned into a hexagon and compared only against its own bin and the 6
// touching it. That bounds the work to the local neighbourhood.
//
// WHY A HEX GRID rather than a square one: every H3 neighbour shares an edge and
// sits at an equal centre-to-centre distance. A square grid has 4 edge
// neighbours at distance d and 4 corner neighbours at d*sqrt(2), so a
// fixed-ring search covers an uneven area and the merge radius silently varies
// with direction.
// ---------------------------------------------------------------------------

/** Resolution 9 is ~174m edge, ~0.1 km^2 cells - a couple of city blocks. Big
 *  enough that a hotel and its own duplicate almost always land within one ring,
 *  small enough that a downtown ring holds tens of candidates, not thousands. */
export const DEDUPE_RESOLUTION = 9;

/** Two records must be within this to be the same building. Chosen from what
 *  the sources actually disagree by: a centroid-vs-entrance offset on a large
 *  hotel runs to ~60m, while neighbouring distinct hotels in dense districts
 *  are rarely closer than ~100m. */
export const MERGE_DISTANCE_M = 75;

/** Jaro-Winkler floor. 0.85 accepts "Aman Tokyo" vs "Aman Tokyo Hotel" and
 *  rejects "Hilton Tokyo" vs "Hilton Tokyo Bay", which are 12km apart and
 *  genuinely different hotels. */
export const NAME_SIMILARITY_MIN = 0.85;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. Haversine rather than equirectangular
 *  because the latter's error grows toward the poles, and hotels exist in
 *  Tromso and Ushuaia. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Combining marks left behind by NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Fold a hotel name to its comparable form.
 *
 * Strips diacritics so "Hotel" matches its accented spelling, drops corporate
 * suffixes and the generic word "hotel" itself - otherwise every pair in the
 * set shares a token and Jaro-Winkler reports everything as similar.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(hotel|hotels|resort|resorts|spa|the|a|an|inn|lodge)\b/g, " ")
    .replace(/\b(ltd|llc|inc|gmbh|sa|sas|bv|pte|pvt|co)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jaro similarity - the share of characters two strings have in common,
 * counting a character as common only if it appears within a sliding window,
 * plus a penalty for those common characters appearing out of order.
 */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Transpositions: matched characters that appear in a different order.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

/**
 * Jaro-Winkler: Jaro, weighted up when the strings share a prefix.
 *
 * The prefix bonus is what makes this the right metric for hotel names - brand
 * names lead ("Four Seasons Hotel George V"), so agreement at the front is
 * stronger evidence of identity than agreement in the middle.
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  if (j < 0.7) return j; // standard threshold: don't reward weak matches
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

export interface Placeable {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** A group of records judged to be one real-world property. */
export interface Cluster<T extends Placeable> {
  h3Index: string;
  members: T[];
}

/**
 * Group records that refer to the same property.
 *
 * Single pass: each record either joins an existing cluster in its H3
 * neighbourhood or starts a new one. Comparisons are against the cluster's
 * first member rather than every member, so a chain of near-duplicates cannot
 * drag one cluster across the map.
 */
export function clusterByConsensus<T extends Placeable>(
  records: T[],
  opts: { resolution?: number; distanceM?: number; similarity?: number } = {}
): Cluster<T>[] {
  const resolution = opts.resolution ?? DEDUPE_RESOLUTION;
  const distanceM = opts.distanceM ?? MERGE_DISTANCE_M;
  const similarity = opts.similarity ?? NAME_SIMILARITY_MIN;

  // Clusters indexed by cell, so a lookup touches only the 7-cell
  // neighbourhood instead of the whole dataset.
  const byCell = new Map<string, Cluster<T>[]>();
  const clusters: Cluster<T>[] = [];

  for (const rec of records) {
    if (!Number.isFinite(rec.latitude) || !Number.isFinite(rec.longitude)) continue;

    const cell = latLngToCell(rec.latitude, rec.longitude, resolution);
    const norm = normalizeName(rec.name);

    let target: Cluster<T> | null = null;
    // gridDisk(cell, 1) is this cell plus the 6 sharing an edge. A duplicate
    // further out than one ring is further than MERGE_DISTANCE_M anyway.
    for (const neighbour of gridDisk(cell, 1)) {
      for (const cand of byCell.get(neighbour) ?? []) {
        const head = cand.members[0];
        if (
          haversineMeters(rec.latitude, rec.longitude, head.latitude, head.longitude) >
          distanceM
        )
          continue;
        if (jaroWinkler(norm, normalizeName(head.name)) < similarity) continue;
        target = cand;
        break;
      }
      if (target) break;
    }

    if (target) {
      target.members.push(rec);
      continue;
    }
    const created: Cluster<T> = { h3Index: cell, members: [rec] };
    clusters.push(created);
    const bucket = byCell.get(cell);
    if (bucket) bucket.push(created);
    else byCell.set(cell, [created]);
  }

  return clusters;
}

/** H3 cell for a point, at the resolution used for viewport indexing. */
export function cellFor(lat: number, lng: number, resolution = DEDUPE_RESOLUTION): string {
  return latLngToCell(lat, lng, resolution);
}
