// ---------------------------------------------------------------------------
// The Google accommodation layer: normalization, freshness, and the row shape
// that reaches `places_accommodation` (migration 0013).
//
// Everything here is pure. The database calls live in the loader script and in
// the map route; what this module owns is the two decisions that must be
// identical on both sides of the wire — what a Google place BECOMES, and when
// it stops being servable.
//
// ── THE RULE THAT SHAPES THE FILE ──────────────────────────────────────────
// Google's Places policy exempts only the place ID from its caching
// restrictions. So this module knows about three categories of field, and the
// types enforce the difference rather than a comment asking nicely:
//
//   PERMANENT  place_id
//   EXPIRING   name, coordinates, types, address, business status
//   NEVER      rating, reviews, photos, summaries, phone, opening hours
//
// There is deliberately no field on `AccommodationRow` for the third category.
// A row cannot carry a rating because there is nowhere to put one.
// ---------------------------------------------------------------------------

/** Must match CURATED_STALE_DAYS in curated.ts, and the default in 0013. The
 *  three are one policy expressed in three places, and they must not drift. */
export const CONTENT_TTL_DAYS = 30;

export type PropertyType =
  | "hotel"
  | "resort"
  | "villa"
  | "hostel"
  | "motel"
  | "guest_house"
  | "extended_stay"
  | "other_accommodation";

/**
 * Normalize Google's type vocabulary into FurlPay's.
 *
 * ORDER IS THE WHOLE ALGORITHM. A property routinely carries several types at
 * once — FIVE Palm Jumeirah is tagged `hotel`, `bed_and_breakfast`,
 * `resort_hotel` and `lodging` simultaneously — so "first match wins" is a
 * ranking decision, not a lookup. The specific beats the generic: `resort_hotel`
 * is checked before `hotel`, because everything that is a resort is also tagged
 * a hotel and testing `hotel` first would erase the resort category entirely.
 *
 * NOTHING IS INFERRED FROM THE NAME. "Villa Rotana" is a hotel; "Grand Hostel"
 * may be a guest house. The name is marketing, the tags are data.
 */
export function classifyPropertyType(googleTypes: readonly string[]): PropertyType {
  const t = new Set(googleTypes);
  if (t.has("resort_hotel")) return "resort";
  if (t.has("cottage") || t.has("private_guest_room") || t.has("farmstay")) return "villa";
  if (t.has("hostel")) return "hostel";
  if (t.has("motel")) return "motel";
  if (t.has("bed_and_breakfast") || t.has("guest_house")) return "guest_house";
  if (t.has("extended_stay_hotel")) return "extended_stay";
  if (t.has("hotel")) return "hotel";
  return "other_accommodation";
}

/** Google address components, as returned by the Places API. */
export interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface AddressParts {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
}

/**
 * Pull structured parts out of `addressComponents`.
 *
 * Google does not always populate `locality` — a resort outside any
 * municipality has none — so the city falls back through `postal_town` and then
 * the second-level administrative area. Better a slightly coarse city than a
 * null one, since city is what the destination rollup groups by.
 */
export function extractAddress(components: readonly AddressComponent[] = []): AddressParts {
  const pick = (type: string, short = false): string | null => {
    const c = components.find((x) => (x.types ?? []).includes(type));
    if (!c) return null;
    const v = short ? c.shortText : c.longText;
    return v && v.trim() ? v.trim() : null;
  };
  return {
    city: pick("locality") ?? pick("postal_town") ?? pick("administrative_area_level_2"),
    region: pick("administrative_area_level_1"),
    country: pick("country"),
    countryCode: pick("country", true),
    postalCode: pick("postal_code"),
  };
}

/**
 * A row of `places_accommodation`.
 *
 * Note what is absent: no rating, no photo, no phone, no summary. Those are
 * fetched live by place ID when a card opens. The absence is the compliance
 * boundary, expressed as a type.
 */
export interface AccommodationRow {
  place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  google_types: string[];
  primary_type: string | null;
  property_type: PropertyType;
  formatted_address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  postal_code: string | null;
  business_status: string | null;
  discovered_in: string | null;
  content_fetched_at: string;
  content_expires_at: string;
}

/** What a discovery run produces, before it becomes a row. */
export interface DiscoveredPlace {
  googlePlaceId: string;
  name: string;
  latitude: number;
  longitude: number;
  googleTypes?: string[];
  primaryType?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  businessStatus?: string | null;
  discoveredIn?: string | null;
}

/**
 * Turn a discovered place into a row, or reject it.
 *
 * Returns null rather than throwing, because a loader processing a thousand
 * records should skip one bad entry and report it, not abort the batch. Every
 * rejection here is something that would otherwise become a marker standing on
 * a lie: no id (undedupable), no name (an unlabelled dot), or a coordinate that
 * is missing, non-finite or off the globe (a pin in the wrong place, or at Null
 * Island).
 */
export function toRow(
  p: DiscoveredPlace,
  now: Date = new Date()
): AccommodationRow | null {
  const id = (p.googlePlaceId ?? "").trim();
  if (id.length < 8 || id.length > 512) return null;

  const name = (p.name ?? "").trim();
  if (!name || name.length > 300) return null;

  const { latitude: lat, longitude: lng } = p;
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return null;
  }

  const types = (p.googleTypes ?? []).slice(0, 32);
  const cc = (p.countryCode ?? "").trim();

  const fetched = now.toISOString();
  const expires = new Date(now.getTime() + CONTENT_TTL_DAYS * 86_400_000).toISOString();

  const clip = (v: string | null | undefined, max: number): string | null => {
    const s = (v ?? "").trim();
    return s ? s.slice(0, max) : null;
  };

  return {
    place_id: id,
    name,
    latitude: lat,
    longitude: lng,
    google_types: types,
    primary_type: clip(p.primaryType, 64),
    property_type: classifyPropertyType(types),
    formatted_address: clip(p.formattedAddress, 500),
    city: clip(p.city, 160),
    region: clip(p.state, 160),
    country: clip(p.country, 120),
    // The column constrains this to two letters; anything else is dropped
    // rather than sent to be rejected by Postgres mid-batch.
    country_code: /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : null,
    postal_code: clip(p.postalCode, 32),
    business_status: clip(p.businessStatus, 32),
    discovered_in: clip(p.discoveredIn, 120),
    content_fetched_at: fetched,
    content_expires_at: expires,
  };
}

/**
 * May this row still be served?
 *
 * The read path calls this on everything it loads. A row past its window is not
 * a stale fact to be shown with a caveat — it is content we are no longer
 * permitted to hold, so it is withheld and the map gets sparser until a refresh
 * run repopulates it.
 */
export function isServable(row: { content_expires_at: string }, now: Date = new Date()): boolean {
  const t = Date.parse(row.content_expires_at);
  // An unparseable expiry is treated as expired. The safe direction: a row we
  // cannot reason about is one we should not be serving.
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

/**
 * Properties that must never appear as bookable.
 *
 * A missing status is NOT treated as closed — Google omits the field on plenty
 * of live properties, and dropping those would silently thin the map. Only an
 * explicit closure counts.
 */
export function isBookable(row: { business_status: string | null }): boolean {
  return row.business_status !== "CLOSED_PERMANENTLY" && row.business_status !== "CLOSED_TEMPORARILY";
}

/**
 * Summary for a destination card, computed from rows rather than asserted.
 *
 * Returns counts per type and the total. It deliberately does NOT return an
 * average price or a nightly rate: nothing in this layer holds one, Google
 * publishes none, and a card is better with four honest numbers than five where
 * one is invented.
 */
export function summarize(rows: readonly AccommodationRow[]): {
  total: number;
  byType: Record<PropertyType, number>;
} {
  const byType = {
    hotel: 0, resort: 0, villa: 0, hostel: 0,
    motel: 0, guest_house: 0, extended_stay: 0, other_accommodation: 0,
  } as Record<PropertyType, number>;

  let total = 0;
  for (const r of rows) {
    if (!isBookable(r)) continue; // a closed hotel is not inventory
    byType[r.property_type] += 1;
    total += 1;
  }
  return { total, byType };
}
