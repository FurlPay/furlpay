import type { BBox } from "@/lib/travel/osmHotels";
import dataset from "@/data/google-places.json";

// ---------------------------------------------------------------------------
// The Google accommodation layer.
//
// A third source beside the curated spine and the OpenStreetMap coverage, and
// the one that gives the map depth outside the 507 properties FurlPay curates:
// ~2,900 hotels, resorts, villas, hostels and guest houses discovered through
// Places Nearby Search across nine destinations, each with a real coordinate
// and a real name.
//
// ── WHY A FILE AND NOT A TABLE ─────────────────────────────────────────────
// Because the curated layer is already a file. There is no database anywhere in
// the map's read path — curated.ts imports its 507 properties the same way — so
// this ships as data rather than as infrastructure, and works without a
// migration. The file is imported by an API route, so it stays server-side; the
// browser only ever receives what a viewport query returns.
//
// ── THE EXPIRY IS LOAD-BEARING ─────────────────────────────────────────────
// Everything here except the place ID is Places content under Google's caching
// restrictions. The dataset therefore carries an expiry, and this module
// REFUSES TO SERVE past it — the whole layer goes quiet rather than serving
// content it is no longer permitted to hold. Coverage degrades visibly and the
// map's counts say so, which is the correct failure. Regenerating the dataset
// restores it.
//
// ── WHAT IS ABSENT ─────────────────────────────────────────────────────────
// Photographs. Not an oversight: photo names expire and Google states they
// cannot be cached, so there is nowhere here to put one. A card resolves a live
// image by place ID through /api/travel/hotels/preview. And nightly rates,
// which Google does not publish at all — `priceLevel` is a band, present for a
// vanishing fraction of hotels, and is never a price.
// ---------------------------------------------------------------------------

export interface GooglePlaceProperty {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  typeDisplay: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  priceLevel: string | null;
  businessStatus: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  summary: string | null;
  photoCount: number;
  enrichedAt: string | null;
}

interface Dataset {
  generatedAt: string;
  expiresAt: string;
  source: string;
  attribution: string;
  count: number;
  properties: GooglePlaceProperty[];
}

const data = dataset as unknown as Dataset;

export const GOOGLE_PLACES_ATTRIBUTION = data.attribution ?? "Powered by Google";

/**
 * Is the dataset still inside the window it may be served in?
 *
 * An unparseable expiry counts as expired: a dataset whose freshness cannot be
 * reasoned about is one that should not be on screen.
 */
export function datasetFresh(now: Date = new Date()): boolean {
  const t = Date.parse(data.expiresAt);
  return Number.isFinite(t) && t > now.getTime();
}

export function datasetStats() {
  return {
    count: data.count,
    generatedAt: data.generatedAt,
    expiresAt: data.expiresAt,
    fresh: datasetFresh(),
  };
}

/** Permanently closed properties are excluded at build time; a temporary
 *  closure is excluded here so a re-opened hotel returns without a rebuild. */
function bookable(p: GooglePlaceProperty): boolean {
  return p.businessStatus !== "CLOSED_PERMANENTLY" && p.businessStatus !== "CLOSED_TEMPORARILY";
}

/**
 * Google's own category for places that are plainly not somewhere to sleep.
 *
 * These arrived because the loader searched for accommodation and Google
 * returned whatever sat nearby under a loose type. It was invisible until the
 * enrichment pass fetched `typeDisplay` — before that the dataset carried no
 * category at all, so a gym and a guest house were indistinguishable rows.
 *
 * 254 records match, and every one was being drawn on the map as a place to
 * stay: Vondelgym in Amsterdam, Ziggy's Bar, a museum, a church, a car park.
 */
const NOT_ACCOMMODATION = new Set([
  "Pub", "Restaurant", "Bar", "Spa", "Banquet hall", "Corporate Office",
  "Consultant", "Association / Organization", "Travel Agency", "Tour Agency",
  "Real Estate Agency", "Cafe", "Coffee Shop", "Gym", "Store", "Shop",
  "Parking Lot", "Event Venue", "Wedding Venue", "Bank", "Hospital",
  "School", "Church", "Museum",
]);

/** Words that overrule the category, because the NAME is better evidence. */
const STAY_WORDS =
  /(hotel|hostel|guest\s?house|guesthouse|inn|resort|lodge|motel|b&b|homestay|villa|apartment|aparthotel|residence)/i;

/**
 * Is this somewhere a person can actually stay?
 *
 * The category alone would be too blunt. "Baan Glang Soi Restaurant &
 * Guesthouse" is typed Restaurant by Google and is demonstrably a guesthouse,
 * so a name that says what it is overrules a category that disagrees.
 * Filtering out a real property is the worse error: a reader can ignore a pin
 * they can see, and cannot find one that was removed.
 */
function isAccommodation(p: GooglePlaceProperty): boolean {
  const t = p.typeDisplay;
  if (!t || !NOT_ACCOMMODATION.has(t)) return true;
  return STAY_WORDS.test(p.name);
}

export interface GooglePlacesFilter {
  /** FurlPay property types: hotel, resort, villa, hostel, motel, … */
  types?: string[];
  /** Google's rating, when the property has one. Unrated properties are
   *  excluded by a rating filter — absence is not a low score, but the reader
   *  asked for a floor and a property with no rating cannot clear one. */
  minRating?: number;
  /** Matches name or city. */
  query?: string;
}

/**
 * Properties inside `box`, filtered.
 *
 * A linear scan over ~2,900 records, which measures in tenths of a millisecond
 * and is nothing beside the Overpass call happening alongside it. A spatial
 * index here would be optimising the cheapest thing the route does.
 */
export function googlePlacesInBBox(
  box: BBox,
  filter: GooglePlacesFilter = {},
  now: Date = new Date()
): GooglePlaceProperty[] {
  if (!datasetFresh(now)) return [];

  const types = filter.types?.length ? new Set(filter.types) : null;
  const q = filter.query?.trim().toLowerCase();
  const min = filter.minRating;

  const out: GooglePlaceProperty[] = [];
  for (const p of data.properties) {
    if (p.latitude < box.minLat || p.latitude > box.maxLat) continue;
    if (p.longitude < box.minLng || p.longitude > box.maxLng) continue;
    if (!bookable(p)) continue;
    if (!isAccommodation(p)) continue;
    if (types && !types.has(p.propertyType)) continue;
    if (min !== undefined && (p.rating === null || p.rating < min)) continue;
    if (q && !p.name.toLowerCase().includes(q) && !(p.city ?? "").toLowerCase().includes(q)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Choose `budget` properties that represent the whole viewport, not just its
 * densest corner.
 *
 * WHY RANKING ALONE IS NOT ENOUGH. Taking the top N by prominence sounds
 * obviously right and measurably is not: over an 8x8 grid it dropped 20% of
 * Paris' occupied cells, 30% of Tokyo's and 35% of Dubai's. Prominence
 * correlates with tourist density, so the strongest properties cluster in the
 * centre and entire neighbourhoods disappear from the map — Montmartre and
 * Belleville go dark so that another twenty hotels near the Louvre can be
 * drawn. A reader panning to a district and finding nothing concludes there is
 * nothing there.
 *
 * THE ALGORITHM: round-robin across cells. Every occupied cell contributes its
 * best property before any cell contributes its second, then its second before
 * any contributes its third, and so on until the budget is spent. Quality still
 * decides WHICH property represents a cell — this only decides how many each
 * cell gets, and the answer is "as evenly as the budget allows".
 *
 * Cells are ordered by their best property's score, so when the budget runs out
 * mid-pass it is the weakest areas that lose their nth property, never their
 * first. Dense strong districts still end up with more pins; they just cannot
 * take all of them.
 */
export function selectSpatially(
  items: readonly GooglePlaceProperty[],
  box: BBox,
  budget: number,
  gridSize = 8
): GooglePlaceProperty[] {
  if (items.length <= budget) return [...items];

  const latSpan = box.maxLat - box.minLat;
  const lngSpan = box.maxLng - box.minLng;
  // A degenerate viewport has no cells to speak of; fall back to pure ranking
  // rather than dividing by zero.
  if (!(latSpan > 0) || !(lngSpan > 0)) {
    return [...items].sort((a, b) => prominence(b) - prominence(a)).slice(0, budget);
  }

  const cells = new Map<number, GooglePlaceProperty[]>();
  for (const p of items) {
    const i = Math.min(gridSize - 1, Math.max(0, Math.floor(((p.latitude - box.minLat) / latSpan) * gridSize)));
    const j = Math.min(gridSize - 1, Math.max(0, Math.floor(((p.longitude - box.minLng) / lngSpan) * gridSize)));
    const key = i * gridSize + j;
    const bucket = cells.get(key);
    if (bucket) bucket.push(p);
    else cells.set(key, [p]);
  }

  const buckets = [...cells.values()];
  for (const b of buckets) b.sort((x, y) => prominence(y) - prominence(x));
  // Strongest areas first, so a budget that runs out mid-pass costs the
  // weakest cells their nth property rather than their only one.
  buckets.sort((a, b) => prominence(b[0]) - prominence(a[0]));

  const out: GooglePlaceProperty[] = [];
  for (let round = 0; out.length < budget; round++) {
    let placedThisRound = false;
    for (const b of buckets) {
      if (out.length >= budget) break;
      const p = b[round];
      if (!p) continue;
      out.push(p);
      placedThisRound = true;
    }
    // Every cell exhausted before the budget was — nothing left to place.
    if (!placedThisRound) break;
  }
  return out;
}

/**
 * Rank for the render budget: prominence first.
 *
 * Review count is the honest proxy for how likely a reader is to have heard of
 * a property, and it separates a 20,000-review resort from a guest house with
 * four. Rating breaks ties. A property with neither sorts last but is still
 * present — it is a real hotel, it simply has less to say for itself.
 */
export function prominence(p: GooglePlaceProperty): number {
  return (p.ratingCount ?? 0) * 10 + (p.rating ?? 0);
}
