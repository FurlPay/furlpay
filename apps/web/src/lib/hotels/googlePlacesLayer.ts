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
    if (types && !types.has(p.propertyType)) continue;
    if (min !== undefined && (p.rating === null || p.rating < min)) continue;
    if (q && !p.name.toLowerCase().includes(q) && !(p.city ?? "").toLowerCase().includes(q)) continue;
    out.push(p);
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
