import type { GooglePlace } from "@/lib/hotels/googlePlaces";

/**
 * The discovery field mask.
 *
 * Its own mask rather than MASK_ESSENTIALS, which is id/name/location/address
 * — right for resolving one hotel, short of what a map needs. A marker shows a
 * rating, a card shows a photo and a type, and requesting them later would
 * mean a second billed round-trip per place.
 *
 * Everything here is drawn by the map or a card. Nothing is requested "in
 * case": `*` would bill every discovery at the most expensive SKU for fields
 * that never reach a pixel.
 */
export const MASK_DISCOVERY = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.primaryType",
  "places.photos",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  // priceLevel powers the $/$$/$$$ indicator on restaurant cards.
  //
  // FREE TO ADD HERE, which is not obvious and is worth writing down. Google
  // bills a request at the HIGHEST SKU any requested field belongs to, and
  // `rating`, `userRatingCount` and `websiteUri` above are already Text Search
  // Enterprise fields — so this request is billed at Enterprise already.
  // `priceLevel` is in that same Enterprise tier, so it adds no SKU change.
  // Removing the three fields above would change that calculus; this line
  // would then be what keeps the request at Enterprise.
  "places.priceLevel",
].join(",");

// ---------------------------------------------------------------------------
// Viewport-aware Places discovery (Places API New, Text Search).
//
// WHY TEXT SEARCH AND NOT NEARBY SEARCH
// =====================================
// lib/hotels/googlePlaces.ts already wraps Nearby Search, and it is the right
// call there: it answers "what is around this point". This module answers a
// different question — "what is inside the rectangle the user is looking at" —
// and Nearby Search cannot express that. Its `locationRestriction` accepts a
// circle only, so serving a viewport through it means inscribing a circle in
// the rectangle (losing the corners) or circumscribing one (returning places
// off-screen). Text Search takes a rectangle directly.
//
// FIELD MASKS ARE BILLING
// =======================
// `X-Goog-FieldMask` selects the SKU. Asking for `*` bills every request at
// the most expensive tier for data the map never draws, so the discovery pass
// requests only what a marker and a card need. Details and photos are fetched
// lazily, per place, when something actually opens.
//
// WHAT THIS MODULE WILL NOT DO
// ============================
// It does not invent. Google returns no nightly rate, so this returns no
// nightly rate; a marker shows a rating because that is what exists. Anything
// absent stays absent rather than being filled with a plausible number.
// ---------------------------------------------------------------------------

const PLACES_BASE = "https://places.googleapis.com/v1";

/** Place kinds this product discovers. Google's own types, not ours. */
export const HOTEL_TYPES = ["hotel", "resort_hotel", "extended_stay_hotel", "bed_and_breakfast", "guest_house", "motel"] as const;
export const RESTAURANT_TYPES = ["restaurant", "fine_dining_restaurant"] as const;

export type DiscoveryKind = "hotels" | "restaurants";

export interface Viewport {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface DiscoveryResult {
  places: GooglePlace[];
  /** True when Google signalled more results than the cap returned. */
  truncated: boolean;
}

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

/** A viewport is only usable if it is finite and correctly ordered. */
export function isValidViewport(v: Viewport): boolean {
  const finite = [v.north, v.south, v.east, v.west].every((n) => Number.isFinite(n));
  if (!finite) return false;
  if (v.north <= v.south) return false;
  if (v.north > 90 || v.south < -90) return false;
  if (v.east > 180 || v.west < -180) return false;
  return true;
}

/**
 * Rough viewport area in square degrees.
 *
 * Used to refuse a whole-world query. At low zoom the rectangle covers
 * continents, and Text Search would answer with an effectively arbitrary
 * twenty places — which then render as a map of "hotels" that is really a map
 * of whatever the ranker happened to surface. Better to ask the user to zoom
 * than to draw something misleading.
 */
export function viewportSpan(v: Viewport): number {
  const lat = Math.abs(v.north - v.south);
  const lngRaw = v.east - v.west;
  // Handle the antimeridian without pretending the span is tiny.
  const lng = lngRaw >= 0 ? lngRaw : 360 + lngRaw;
  return lat * lng;
}

/** Above this, the viewport is too coarse for place-level discovery. */
export const MAX_DISCOVERY_SPAN = 400; // ~20° x 20°

export const MAX_RESULTS = 20; // Text Search (New) hard cap per page.

interface TextSearchBody {
  textQuery: string;
  maxResultCount: number;
  includedType?: string;
  locationRestriction: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } };
  rankPreference?: "RELEVANCE" | "DISTANCE";
}

function toPlace(raw: any): GooglePlace | null {
  const placeId = raw?.id;
  const name = raw?.displayName?.text;
  if (!placeId || !name) return null;
  return {
    placeId,
    name,
    formattedAddress: raw.formattedAddress ?? undefined,
    latitude: raw.location?.latitude,
    longitude: raw.location?.longitude,
    rating: typeof raw.rating === "number" ? raw.rating : undefined,
    userRatingCount: typeof raw.userRatingCount === "number" ? raw.userRatingCount : undefined,
    // Google's own enum, passed through unmapped. Translating it to "$$" here
    // would bake a presentation choice into the transport layer, and
    // PRICE_LEVEL_UNSPECIFIED is a real value that must stay distinguishable
    // from "absent" — a caller that cannot tell them apart renders a price
    // band for a place Google declined to band.
    priceLevel: typeof raw.priceLevel === "string" ? raw.priceLevel : undefined,
    editorialSummary: raw.editorialSummary?.text ?? undefined,
    types: Array.isArray(raw.types) ? raw.types : [],
    primaryType: raw.primaryType ?? undefined,
    websiteUri: raw.websiteUri ?? undefined,
    businessStatus: raw.businessStatus ?? undefined,
    googleMapsUri: raw.googleMapsUri ?? undefined,
    photos: Array.isArray(raw.photos)
      ? raw.photos.map((p: any) => ({ name: p.name, widthPx: p.widthPx, heightPx: p.heightPx }))
      : [],
  };
}

/**
 * Discover places of one kind inside a viewport.
 *
 * Returns `null` — never an empty array — when the API is not configured or
 * the call fails, so a caller can tell "nothing is here" apart from "we could
 * not ask". Those are different answers and the UI shows different things.
 */
export async function discoverInViewport(opts: {
  viewport: Viewport;
  kind: DiscoveryKind;
  /** Free-text narrowing, e.g. a brand the user typed. */
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<DiscoveryResult | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  if (!isValidViewport(opts.viewport)) return null;
  if (viewportSpan(opts.viewport) > MAX_DISCOVERY_SPAN) return null;

  const { north, south, east, west } = opts.viewport;
  const isHotels = opts.kind === "hotels";

  // The text query carries the user's words when they typed any; otherwise a
  // neutral noun for the kind. It is NOT a filter — the includedType is.
  const textQuery = opts.query?.trim() || (isHotels ? "hotel" : "restaurant");

  const body: TextSearchBody = {
    textQuery,
    maxResultCount: Math.min(MAX_RESULTS, Math.max(1, opts.maxResults ?? MAX_RESULTS)),
    includedType: isHotels ? "hotel" : "restaurant",
    locationRestriction: {
      rectangle: {
        low: { latitude: south, longitude: west },
        high: { latitude: north, longitude: east },
      },
    },
    rankPreference: "RELEVANCE",
  };

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Only what a marker and a card render. See the header note on billing.
        "X-Goog-FieldMask": MASK_DISCOVERY,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
      cache: "no-store",
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { places?: unknown[] };
    const places = (json.places ?? []).map(toPlace).filter((p): p is GooglePlace => p !== null);
    return { places, truncated: places.length >= body.maxResultCount };
  } catch {
    return null;
  }
}

/**
 * Deduplicate by place id, keeping the first occurrence.
 *
 * Successive viewport queries overlap, so the same hotel arrives repeatedly.
 * The place id is Google's stable identifier and the only field their policy
 * permits persisting, which makes it the right dedupe key.
 */
export function dedupeByPlaceId(places: GooglePlace[]): GooglePlace[] {
  const seen = new Set<string>();
  const out: GooglePlace[] = [];
  for (const p of places) {
    if (seen.has(p.placeId)) continue;
    seen.add(p.placeId);
    out.push(p);
  }
  return out;
}
