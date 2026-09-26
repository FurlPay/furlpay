import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import type { GooglePlace } from "@/lib/hotels/googlePlaces";
import { normalizeName } from "@/lib/hotels/h3";

// ---------------------------------------------------------------------------
// Live Google Places → MapPoint, merged into the existing map result set.
//
// WHAT THIS IS FOR
// ================
// /api/travel/hotels/map unions four sources: curated, OSM, a Google snapshot
// and the registry. All four are server-side and none of them is live — the
// Google layer is a harvested file with an expiry.
//
// This adds a fifth, live one. It does NOT replace the others: the snapshot
// covers ~16k properties worldwide and answers instantly, while live discovery
// answers for whatever rectangle the user is actually looking at, including
// places the harvest never visited.
//
// SOURCE PROVENANCE IS LOAD-BEARING
// =================================
// A live result and a snapshot result are different things and are labelled
// differently (`google-live` vs `google`). When live discovery fails — and it
// currently does, because Places API (New) is not enabled on the project — the
// map keeps showing snapshot points and must NOT relabel them as live. A map
// that silently claims freshness it does not have is worse than one that
// admits the layer is down.
// ---------------------------------------------------------------------------

/** Metres between two coordinates. Cheap equirectangular approximation. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const mLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(mLat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

/**
 * Google place types → the map's `hotelType`.
 *
 * Straight from Google's own vocabulary where one exists. "Villa" is NOT a
 * Google place type; it is inferred from the name only, and is tagged as such
 * rather than presented as though Google classified it.
 */
export function hotelTypeFromGoogle(p: GooglePlace): string {
  const t = new Set([...(p.types ?? []), p.primaryType].filter(Boolean) as string[]);
  if (t.has("resort_hotel")) return "resort";
  if (t.has("extended_stay_hotel")) return "apartment";
  if (t.has("bed_and_breakfast")) return "guest_house";
  if (t.has("guest_house")) return "guest_house";
  if (t.has("motel")) return "motel";
  if (t.has("hostel")) return "hostel";
  if (t.has("campground") || t.has("rv_park")) return "campground";
  if (t.has("hotel") || t.has("lodging")) return "hotel";
  return "hotel";
}

/**
 * One live Google place as a map point.
 *
 * `stars` is deliberately never set. Google returns a user rating, which is a
 * different measurement from an official star classification — MapPoint's own
 * doc comment says they are never blended, and populating `stars` from
 * `rating` would be exactly that blend.
 */
export function toMapPoint(p: GooglePlace): MapPoint | null {
  if (typeof p.latitude !== "number" || typeof p.longitude !== "number") return null;
  if (!p.placeId || !p.name) return null;

  return {
    id: `google-live:${p.placeId}`,
    kind: "property",
    // A distinct source, so nothing downstream can mistake this for the
    // snapshot or vice versa.
    source: "google-live",
    latitude: p.latitude,
    longitude: p.longitude,
    name: p.name,
    // Google's discovery mask does not include address components, and
    // splitting a formatted address into city/country is guesswork. Left empty
    // rather than parsed badly; the card shows the formatted address instead.
    city: "",
    country: "",
    rating: typeof p.rating === "number" ? p.rating : undefined,
    ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
    website: p.websiteUri,
    hotelType: hotelTypeFromGoogle(p),
    placeId: p.placeId,
    googleMapsUri: p.googleMapsUri,
  } as MapPoint;
}

export function toMapPoints(places: readonly GooglePlace[]): MapPoint[] {
  return places.map(toMapPoint).filter((p): p is MapPoint => p !== null);
}

/** Two points are the same property if they share a place id. */
const sameByPlaceId = (a: MapPoint, b: MapPoint) =>
  Boolean(a.placeId && b.placeId && a.placeId === b.placeId);

/**
 * …or if they sit on top of each other with the same normalised name.
 *
 * Needed because the curated, OSM and registry layers key on their own ids and
 * often have no place id at all. Without this, a hotel the harvest already
 * knows about appears twice the moment live discovery returns it — two pins,
 * two cards, one building.
 *
 * 120 m is deliberately tight. Large resorts legitimately have several
 * entrances mapped as separate POIs, and a loose radius would merge a hotel
 * with its own neighbour.
 */
const NEAR_METRES = 120;

function sameByNameAndPlace(a: MapPoint, b: MapPoint): boolean {
  if (!a.name || !b.name) return false;
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  return metresBetween(a.latitude, a.longitude, b.latitude, b.longitude) <= NEAR_METRES;
}

/**
 * Which point survives when two describe the same property.
 *
 * Existing sources win. Curated carries FurlPay's own editorial data and
 * collection membership; the registry and OSM carry identifiers the rest of
 * the product already joins on. A live Google point adds reach, not
 * authority, so it fills gaps rather than displacing what is already known.
 */
const SOURCE_PRIORITY: Record<string, number> = {
  curated: 0,
  registry: 1,
  osm: 2,
  google: 3,
  "google-live": 4,
};

const rank = (p: MapPoint) => SOURCE_PRIORITY[p.source as string] ?? 99;

export interface MergeResult {
  points: MapPoint[];
  /** How many live points were dropped as duplicates of existing ones. */
  deduped: number;
  /** How many live points were genuinely new. */
  added: number;
}

/**
 * Merge live points into the existing result set.
 *
 * Existing points are never removed or reordered — the map's clusters, saved
 * ids and hover targets all key off them, and reshuffling the array on every
 * live response would make the map flicker.
 */
export function mergeLivePoints(existing: readonly MapPoint[], live: readonly MapPoint[]): MergeResult {
  const out = [...existing];
  let deduped = 0;
  let added = 0;

  for (const candidate of live) {
    const clashIndex = out.findIndex(
      (p) => sameByPlaceId(p, candidate) || sameByNameAndPlace(p, candidate)
    );

    if (clashIndex === -1) {
      out.push(candidate);
      added++;
      continue;
    }

    deduped++;
    // The incumbent normally wins. The one exception: if the live point
    // outranks it (it cannot today, but the table is the single place that
    // decides), replace in place so ordering is untouched.
    if (rank(candidate) < rank(out[clashIndex])) out[clashIndex] = candidate;
  }

  return { points: out, deduped, added };
}
