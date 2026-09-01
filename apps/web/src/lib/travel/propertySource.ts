// ---------------------------------------------------------------------------
// The real property source. One normalized shape, from data we actually hold.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The `Stay` type this replaces declares `nightlyUsd: number`, `rating:
// number`, `reviews: number` and `stars: number` as REQUIRED. A type like that
// cannot express "we do not know the price", so every code path that produced
// a Stay had to invent one — and generateStays() duly did, from a hash seed:
// names, star ratings, ratings between 4.6 and 4.9, prices between $380 and
// $780, and a photograph. It was not a shortcut anyone chose. It was the only
// value the type would accept.
//
// So the fix is not to delete the generator and leave the shape alone. It is
// to make absence representable. Everything uncertain here is nullable, and
// the UI is expected to render nothing rather than a plausible number.
//
// ── PRICE IS ALWAYS NULL FROM THIS MODULE ──────────────────────────────────
// The indexed dataset holds no rates and cannot. Google's priceLevel is a 1-4
// bucket populated on 29 of 16,014 properties and is not a currency amount;
// converting it into dollars would be fabrication with an extra step. Live
// rates come from Duffel via lib/hotels/pricing.ts, which is a separate,
// per-property, on-demand path and correctly refuses to serve a test token's
// rates as real. A price therefore ARRIVES here from a caller that fetched
// one; it is never derived here.
// ---------------------------------------------------------------------------

import type { BBox } from "@/lib/travel/osmHotels";
import {
  googlePlacesInBBox,
  prominence,
  type GooglePlaceProperty,
} from "@/lib/hotels/googlePlacesLayer";
import { boxAround } from "@/lib/hotels/destinationSummary";
import { CITY_COORDS } from "@/lib/travel/data";

/** Where a value came from. There is deliberately no "demo" member. */
export type PropertySource = "indexed_dataset" | "google_places" | "duffel";

/** A live rate, when one has actually been fetched for this property. */
export interface PropertyRate {
  amount: number;
  currency: string;
  source: Extract<PropertySource, "duffel">;
  /** When the rate was retrieved. A price with no age is not a price. */
  fetchedAt: string;
}

/**
 * A property we can show, with every uncertain field nullable.
 *
 * Compare against `Stay`: nothing here forces a caller to supply a number it
 * does not have.
 */
export interface IndexedProperty {
  id: string;
  name: string;
  coordinates: { latitude: number; longitude: number };
  address: string | null;
  city: string | null;
  country: string | null;
  /** FurlPay family: hotel, resort, villa, hostel… */
  propertyType: string | null;
  /** Google's own label, e.g. "Resort hotel". Null when unenriched. */
  typeDisplay: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** How many photographs exist. NOT the photographs: Places policy forbids
   *  storing photo names, so imagery is resolved per request via the photo
   *  proxy. A count is what lets a surface decide whether to ask. */
  photoCount: number;
  website: string | null;
  summary: string | null;
  /** Null unless a caller attached a real fetched rate. Never derived here. */
  rate: PropertyRate | null;
  source: PropertySource;
}

function normalize(p: GooglePlaceProperty): IndexedProperty {
  return {
    id: p.placeId,
    name: p.name,
    coordinates: { latitude: p.latitude, longitude: p.longitude },
    address: p.address,
    city: p.city,
    country: p.country,
    propertyType: p.propertyType || null,
    typeDisplay: p.typeDisplay,
    rating: p.rating,
    reviewCount: p.ratingCount,
    photoCount: p.photoCount ?? 0,
    website: p.website,
    summary: p.summary,
    // Not "not yet implemented" — this module has no rate to give. See header.
    rate: null,
    source: "indexed_dataset",
  };
}

/**
 * One property by its canonical id.
 *
 * Returns null for an unknown id, and the caller is expected to 404. The route
 * this replaces generated a property from the id instead, which meant any
 * string at all resolved to a plausible hotel — including in the booking flow.
 */
export function findPropertyById(id: string): IndexedProperty | null {
  if (!id) return null;
  // The whole-world box is the dataset itself; the layer's filters (open for
  // business, actually accommodation) still apply, so a permanently closed
  // property does not resolve.
  const all = googlePlacesInBBox({ minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 });
  const hit = all.find((p) => p.placeId === id);
  return hit ? normalize(hit) : null;
}

export interface PropertyQuery {
  /** Restrict to a viewport. */
  box?: BBox;
  /** Resolve a city name to a box via CITY_COORDS. */
  city?: string;
  /** Substring over name and city. */
  query?: string;
  types?: string[];
  minRating?: number;
  limit?: number;
}

/**
 * Search real properties.
 *
 * An unmatched query returns an EMPTY array. That is the entire point: the
 * route this replaces fell through to generateStays(query), so searching for a
 * city we have never indexed produced a full page of invented hotels that
 * looked exactly like the real ones.
 */
export function searchProperties(q: PropertyQuery): IndexedProperty[] {
  let box = q.box;
  if (!box && q.city) {
    const coords = CITY_COORDS[q.city] ?? CITY_COORDS[titleCase(q.city)];
    // A city we hold no coordinate for is not an invitation to guess; it is an
    // empty result.
    if (!coords) return [];
    box = boxAround(coords.lat, coords.lng);
  }
  if (!box) return [];

  const found = googlePlacesInBBox(box, {
    types: q.types,
    minRating: q.minRating,
    query: q.query,
  });

  // Same ranking the destination card uses, so a city page and the map agree
  // on which properties matter.
  const ranked = [...found].sort((a, b) => score(b) - score(a));
  return ranked.slice(0, q.limit ?? 24).map(normalize);
}

function score(p: GooglePlaceProperty): number {
  if (p.rating === null) return prominence(p) / 1000;
  return p.rating * Math.log10(1 + (p.ratingCount ?? 0)) + prominence(p) / 1000;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

/** Cities we can resolve to a box at all. Lets a caller distinguish "no
 *  coverage there" from "never heard of it". */
export function isKnownCity(city: string): boolean {
  return Boolean(CITY_COORDS[city] ?? CITY_COORDS[titleCase(city)]);
}
