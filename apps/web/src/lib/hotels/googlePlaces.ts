import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Google Places API (New) — on-demand hotel detail.
//
// WHAT THIS IS FOR: enriching ONE hotel a user has actually opened. Names,
// ratings, review counts, editorial summaries and photography — the things OSM
// has no opinion about.
//
// WHAT IT IS EMPHATICALLY NOT FOR, and the module refuses to make easy:
//
//   1. BULK CRAWLING. There is no endpoint that enumerates. Nearby Search
//      returns at most 20 results with NO pagination; Text Search caps at 60
//      across all pages. Sweeping a coordinate grid would need millions of
//      calls and would still miss the 21st hotel in every dense district. OSM
//      is the global layer; this is a lookup.
//
//   2. BUILDING A LOCAL DATABASE. Google's Places policy permits storing the
//      place ID and nothing else — ratings, photos, addresses and summaries may
//      not be pre-fetched, cached or stored. So nothing here writes to kv or
//      Postgres, and `cache: "no-store"` is set on every request. The single
//      durable value is `placeId`, which callers may persist.
//
//   3. RENDERING ON A NON-GOOGLE MAP. Places content displayed on a map must be
//      displayed on a Google map; shown outside a map it needs visible Google
//      attribution. GOOGLE_ATTRIBUTION below is exported so a surface cannot
//      render this data and forget.
//
// BILLING. The X-Goog-FieldMask decides the SKU, and a request bills at the
// HIGHEST tier any field in the mask belongs to. That is why two masks exist
// rather than one convenient superset: asking for `rating` and
// `editorialSummary` moves a call from ~$32/1k to ~$40/1k, and the free
// allowance for the top tier is only 1,000 calls a month.
// ---------------------------------------------------------------------------

const PLACES_BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 15_000;

/** Required wherever Places content appears without a Google map. */
export const GOOGLE_ATTRIBUTION = "Powered by Google";

/**
 * Cheapest useful mask: identity and position only (Essentials tier).
 * Use when all you need is to resolve a name to a place ID or a coordinate.
 */
export const MASK_ESSENTIALS = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
].join(",");

/**
 * Everything the product actually shows on a hotel detail panel.
 * Verified field-by-field against a live response — every name here came back
 * populated for a real property, rather than being copied from a doc example.
 */
export const MASK_DETAIL = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
  "places.editorialSummary",
  "places.types",
  "places.primaryType",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

export interface GooglePlacePhoto {
  /** Resource name, e.g. "places/{id}/photos/{ref}". NOT cacheable — Google
   *  documents that photo names expire, so it must be re-fetched, never stored. */
  name: string;
  widthPx?: number;
  heightPx?: number;
  /** Required attribution for the contributor who took the photo. */
  authorAttributions?: { displayName?: string; uri?: string }[];
}

export interface GooglePlace {
  /** The ONE field that may be persisted. */
  placeId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  /** 1.0-5.0. */
  rating?: number;
  userRatingCount?: number;
  /** Google's price band enum, e.g. "PRICE_LEVEL_MODERATE". Kept as the raw
   *  enum rather than a symbol count so that PRICE_LEVEL_UNSPECIFIED — which
   *  Google does return — stays separable from the field being absent. */
  priceLevel?: string;
  editorialSummary?: string;
  types: string[];
  primaryType?: string;
  websiteUri?: string;
  phone?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  photos: GooglePlacePhoto[];
}

export function googlePlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

function coords(loc: unknown): { latitude?: number; longitude?: number } {
  if (!loc || typeof loc !== "object") return {};
  const l = loc as { latitude?: unknown; longitude?: unknown };
  const lat = Number(l.latitude);
  const lng = Number(l.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return {};
  if (lat === 0 && lng === 0) return {}; // Null Island means "unknown"
  return { latitude: lat, longitude: lng };
}

function toPlace(raw: unknown): GooglePlace | null {
  const p = raw as Record<string, any>;
  const id = typeof p?.id === "string" ? p.id : "";
  const name = p?.displayName?.text;
  if (!id || typeof name !== "string" || !name) return null;

  const rating = Number(p.rating);
  const count = Number(p.userRatingCount);

  return {
    placeId: id,
    name,
    formattedAddress: typeof p.formattedAddress === "string" ? p.formattedAddress : undefined,
    ...coords(p.location),
    rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : undefined,
    userRatingCount: Number.isFinite(count) && count >= 0 ? count : undefined,
    editorialSummary:
      typeof p.editorialSummary?.text === "string" ? p.editorialSummary.text : undefined,
    types: Array.isArray(p.types) ? p.types.filter((t: unknown) => typeof t === "string") : [],
    primaryType: typeof p.primaryType === "string" ? p.primaryType : undefined,
    websiteUri: typeof p.websiteUri === "string" ? p.websiteUri : undefined,
    phone:
      typeof p.internationalPhoneNumber === "string" ? p.internationalPhoneNumber : undefined,
    businessStatus: typeof p.businessStatus === "string" ? p.businessStatus : undefined,
    googleMapsUri: typeof p.googleMapsUri === "string" ? p.googleMapsUri : undefined,
    photos: Array.isArray(p.photos)
      ? p.photos
          .filter((ph: any) => typeof ph?.name === "string")
          .map((ph: any) => ({
            name: ph.name,
            widthPx: Number.isFinite(Number(ph.widthPx)) ? Number(ph.widthPx) : undefined,
            heightPx: Number.isFinite(Number(ph.heightPx)) ? Number(ph.heightPx) : undefined,
            authorAttributions: Array.isArray(ph.authorAttributions)
              ? ph.authorAttributions.slice(0, 3).map((a: any) => ({
                  displayName: a?.displayName,
                  uri: a?.uri,
                }))
              : undefined,
          }))
      : [],
  };
}

async function placesPost(
  path: string,
  body: unknown,
  fieldMask: string
): Promise<any | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  // A ref'd timer, deliberately: AbortSignal.timeout() is unref'd in Node, so a
  // hung request would never fire its own timeout when nothing else is pending.
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PLACES_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The key travels in a header, never a query string — a URL ends up in
        // logs, proxies and Referer headers.
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Places content may not be cached. This is a policy requirement, not a
      // performance choice.
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("google.places.http", { status: res.status, path });
      return null;
    }
    return await res.json();
  } catch (e) {
    log.warn("google.places.failed", { path, error: (e as Error).message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find a hotel by name, optionally biased to where we already know it is.
 *
 * `locationBias` matters more than it looks: "The Oberoi" matches properties in
 * several cities, and biasing to the OSM coordinate is what makes the top hit
 * the right building rather than the most famous one.
 */
export async function findHotel(opts: {
  query: string;
  latitude?: number;
  longitude?: number;
  /** Bias radius in metres. Google allows up to 50,000. */
  radiusM?: number;
  detail?: boolean;
}): Promise<GooglePlace | null> {
  if (!opts.query.trim()) return null;

  const body: Record<string, unknown> = {
    textQuery: opts.query,
    maxResultCount: 1,
    includedType: "hotel",
  };
  if (opts.latitude !== undefined && opts.longitude !== undefined) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.latitude, longitude: opts.longitude },
        radius: Math.min(50_000, Math.max(1, opts.radiusM ?? 2_000)),
      },
    };
  }

  const json = await placesPost(
    "/places:searchText",
    body,
    opts.detail ? MASK_DETAIL : MASK_ESSENTIALS
  );
  const first = json?.places?.[0];
  return first ? toPlace(first) : null;
}

/**
 * Hotels near a coordinate.
 *
 * CEILING: Nearby Search returns at most 20 results and has no pagination, so
 * this is "what is around here", never "everything that is here". Callers that
 * need completeness must use the OSM layer.
 */
export const NEARBY_MAX_RESULTS = 20;
export const NEARBY_MAX_RADIUS_M = 50_000;

export async function hotelsNearby(opts: {
  latitude: number;
  longitude: number;
  radiusM?: number;
  maxResults?: number;
  detail?: boolean;
}): Promise<GooglePlace[] | null> {
  if (!Number.isFinite(opts.latitude) || !Number.isFinite(opts.longitude)) return null;

  const json = await placesPost(
    "/places:searchNearby",
    {
      includedTypes: ["hotel", "resort_hotel"],
      maxResultCount: Math.min(NEARBY_MAX_RESULTS, Math.max(1, opts.maxResults ?? 10)),
      locationRestriction: {
        circle: {
          center: { latitude: opts.latitude, longitude: opts.longitude },
          radius: Math.min(NEARBY_MAX_RADIUS_M, Math.max(1, opts.radiusM ?? 1_500)),
        },
      },
    },
    opts.detail ? MASK_DETAIL : MASK_ESSENTIALS
  );
  if (!json) return null;
  return (json.places ?? [])
    .map(toPlace)
    .filter((p: GooglePlace | null): p is GooglePlace => p !== null);
}

/**
 * One place, looked up by the ID we already hold.
 *
 * WHY THIS EXISTS AND WHY IT IS PREFERRED. The detail panel used to re-run a
 * TEXT SEARCH for a hotel the resolver had already identified, which fails
 * exactly where the name is the unreliable part. "Sofitel Legend Old Cataract
 * Aswan" is listed by Google as "Old Cataract, Aswan"; searching the curated
 * name found nothing and the panel reported "No matching place found" for a
 * property whose place ID was sitting in the dataset the whole time.
 *
 * It is also cheaper and exact: Place Details bills below Text Search, and a
 * place ID resolves to one place rather than to whatever a string ranked first.
 * The place ID is the single Places field the policy permits storing, and this
 * is what makes storing it worth anything.
 */
export async function placeDetails(
  placeId: string,
  detail = true
): Promise<GooglePlace | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  // The ID reaches a URL path. A caller-supplied string must not be able to
  // escape into another endpoint.
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(placeId)) {
    log.warn("google.places.details.badid", {});
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Place Details returns ONE place, so the mask has no "places." prefix.
    const mask = (detail ? MASK_DETAIL : MASK_ESSENTIALS)
      .split(",")
      .map((f) => f.replace(/^places\./, ""))
      .join(",");

    const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": mask,
      },
      signal: controller.signal,
      // Places content may not be cached. Policy, not performance.
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("google.places.details.http", { status: res.status });
      return null;
    }
    return toPlace(await res.json());
  } catch (e) {
    log.warn("google.places.details.failed", { error: (e as Error).message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A displayable URL for a place photo.
 *
 * Proxied through our own server rather than handed to the browser, because the
 * Places media endpoint takes the API key as a query parameter and putting that
 * in an <img src> would publish the key to every visitor.
 */
export function photoProxyUrl(photoName: string, maxWidthPx = 800): string {
  const w = Math.min(4800, Math.max(1, Math.round(maxWidthPx)));
  return `/api/travel/hotels/photo?name=${encodeURIComponent(photoName)}&w=${w}`;
}

/** Resolve a photo resource name to the URI Google serves it from. */
export async function resolvePhotoUri(
  photoName: string,
  maxWidthPx = 800
): Promise<string | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  // Guard the path segment: this value reaches a URL, and a caller-supplied
  // string must not be able to escape into another endpoint.
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) {
    log.warn("google.places.photo.badname", {});
    return null;
  }

  const w = Math.min(4800, Math.max(1, Math.round(maxWidthPx)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${PLACES_BASE}/${photoName}/media?maxWidthPx=${w}&skipHttpRedirect=true&key=${key}`,
      { signal: controller.signal, cache: "no-store" }
    );
    if (!res.ok) {
      log.warn("google.places.photo.http", { status: res.status });
      return null;
    }
    const json = (await res.json()) as { photoUri?: string };
    return typeof json.photoUri === "string" ? json.photoUri : null;
  } catch (e) {
    log.warn("google.places.photo.failed", { error: (e as Error).message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
