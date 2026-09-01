import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Places Autocomplete (New) — global destination and property search.
//
// WHAT THIS FIXES. The map's suggestion list is built from whatever the last
// viewport response returned, which is correct as far as it goes: every row is
// somewhere the map can actually go, and every count beside one is real. But it
// means the search box can only find what is already on screen. Typing "Paris"
// while looking at the Indian Ocean returns nothing, because Paris is not in
// the current response — and to the person typing, a search box that answers
// nothing is indistinguishable from a broken one.
//
// This module supplies the other half: anywhere on earth, whether or not the
// map is currently looking at it. The local list stays first in the dropdown,
// because a curated property we hold data for is a better answer than a generic
// place, and this fills in underneath.
//
// ── NOTHING HERE IS STORED ─────────────────────────────────────────────────
// Autocomplete output is Places content, and the Places policy exempts only the
// place ID from its caching restrictions. So predictions are never written to
// kv or Postgres, `cache: "no-store"` is set on every request, and the response
// this module hands back is passed straight through to a dropdown that is
// discarded when it closes. The only value a caller may durably keep is the
// place ID.
//
// ── SESSION TOKENS ARE THE COST CONTROL ────────────────────────────────────
// Autocomplete bills per REQUEST unless the requests are grouped into a
// session. Someone typing "Burj Al Arab" produces up to a dozen keystroke
// requests; without a session token that is a dozen billable calls for one
// search. With one, the whole run plus the Details call that closes it bills as
// a single session. The token must therefore be generated once per search, sent
// on every keystroke of that search, and passed to the Details call that
// follows — then thrown away. Reusing one across searches is the same mistake
// as not having one.
//
// ── PREDICTIONS HAVE NO COORDINATES ────────────────────────────────────────
// Autocomplete returns an id and text, never a position. Moving the camera to a
// picked place therefore needs one Place Details call, and that call is why the
// session token exists. It asks for `location` and `viewport` and nothing else:
// those are Essentials-tier fields, the cheapest SKU, and asking for a rating
// here would silently move the whole session to a dearer tier for a number the
// dropdown does not display.
// ---------------------------------------------------------------------------

const PLACES_BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 8_000;

/** Autocomplete has to feel instant, so it gets a shorter budget than the
 *  detail lookups in googlePlaces.ts — a suggestion that arrives after the next
 *  keystroke is worse than no suggestion, because it replaces a list the reader
 *  had already started scanning. */
const AUTOCOMPLETE_TIMEOUT_MS = 4_000;

/**
 * Fields for the prediction list. `structuredFormat` splits a prediction into a
 * main line and a secondary one ("Jumeirah Burj Al Arab" / "Dubai, UAE") which
 * is exactly the shape the existing dropdown renders, so taking it from Google
 * avoids parsing a formatted string back apart.
 */
const AUTOCOMPLETE_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text",
  "suggestions.placePrediction.structuredFormat",
  "suggestions.placePrediction.types",
].join(",");

/** Essentials tier: position only. See the note above about SKU drift. */
const RESOLVE_MASK = ["id", "location", "viewport", "displayName"].join(",");

export interface PlaceSuggestion {
  /** The one field a caller may persist. */
  placeId: string;
  /** Primary line — the place's own name. */
  label: string;
  /** Secondary line — usually city and country. */
  sublabel: string;
  /** Google place types, so the caller can tell a hotel from a city. */
  types: string[];
}

export interface ResolvedPlace {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * The place's own bounds, when Google publishes them.
   *
   * This is what makes picking a destination feel right. A city is not a point:
   * flying to Paris' centroid at a fixed zoom either buries the reader in one
   * arrondissement or leaves them above northern France. Fitting the viewport
   * frames the actual place, and a hotel — whose viewport is a single building —
   * still gets a sensible close zoom from the same code path.
   */
  bounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}

export function autocompleteConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

/**
 * `AbortSignal.timeout()` is unref'd in Node, so a hung socket would never fire
 * its own timeout when nothing else keeps the event loop alive. Same reasoning
 * as osmHotels.ts; the ref'd timer is the one that actually fires.
 */
async function postJson<T>(
  path: string,
  body: unknown,
  mask: string,
  timeoutMs: number
): Promise<T | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${PLACES_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": mask,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Places content may not be cached. This is not a performance choice.
      cache: "no-store",
    });
    if (!res.ok) {
      // The body carries Google's own reason (quota, key restriction, bad
      // argument). It is logged and never returned to the browser, which gets a
      // generic failure — an upstream error message is an information leak and
      // is useless to a reader anyway.
      log.warn("places.autocomplete.http", { path, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn("places.autocomplete.error", { path, err: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface RawSuggestion {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    types?: string[];
  };
}

/**
 * Suggestions for `input`, biased toward `near` when the map has a position.
 *
 * BIASING, NOT RESTRICTING. `locationBias` prefers nearby results without
 * excluding distant ones. Restricting would mean someone looking at Kerala
 * could not search for Kyoto, which is the exact failure this module exists to
 * remove. Bias only breaks ties — "Springfield" resolves to the one near the
 * reader rather than an arbitrary one.
 */
export async function autocompletePlaces(opts: {
  input: string;
  sessionToken: string;
  near?: { latitude: number; longitude: number };
  signal?: AbortSignal;
}): Promise<PlaceSuggestion[] | null> {
  const input = opts.input.trim();
  // One character matches most of the planet and bills for the privilege.
  if (input.length < 2) return [];

  const body: Record<string, unknown> = {
    input,
    sessionToken: opts.sessionToken,
    // Accommodation and geography. Without this a hotel search competes with
    // every restaurant and petrol station sharing the name.
    includedPrimaryTypes: ["lodging", "locality", "administrative_area_level_1", "country"],
  };

  if (opts.near) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.near.latitude, longitude: opts.near.longitude },
        // Wide on purpose: this is a tiebreaker, not a filter.
        radius: 50_000.0,
      },
    };
  }

  const json = await postJson<{ suggestions?: RawSuggestion[] }>(
    "/places:autocomplete",
    body,
    AUTOCOMPLETE_MASK,
    AUTOCOMPLETE_TIMEOUT_MS
  );
  if (!json) return null;

  const out: PlaceSuggestion[] = [];
  for (const s of json.suggestions ?? []) {
    const p = s.placePrediction;
    // A prediction with no id cannot be resolved to a position later, so it
    // could only ever be a dead row in the list.
    if (!p?.placeId) continue;
    const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    if (!main) continue;
    out.push({
      placeId: p.placeId,
      label: main,
      sublabel: p.structuredFormat?.secondaryText?.text ?? "",
      types: p.types ?? [],
    });
  }
  return out;
}

/**
 * Turn a picked prediction into somewhere the camera can go.
 *
 * Takes the SAME session token the predictions were fetched with — that is what
 * closes the session and makes the whole search bill once.
 */
export async function resolvePlace(opts: {
  placeId: string;
  sessionToken: string;
}): Promise<ResolvedPlace | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `${PLACES_BASE}/places/${encodeURIComponent(opts.placeId)}` +
      `?sessionToken=${encodeURIComponent(opts.sessionToken)}`;
    const res = await fetch(url, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": RESOLVE_MASK },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("places.resolve.http", { status: res.status });
      return null;
    }
    const j = (await res.json()) as {
      id?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
      viewport?: {
        low?: { latitude?: number; longitude?: number };
        high?: { latitude?: number; longitude?: number };
      };
    };

    const lat = j.location?.latitude;
    const lng = j.location?.longitude;
    // Guarded rather than trusted: a NaN reaching the camera throws the map to
    // Null Island, and nothing downstream would explain why.
    if (
      typeof lat !== "number" || typeof lng !== "number" ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      return null;
    }

    const lo = j.viewport?.low;
    const hi = j.viewport?.high;
    const bounds =
      lo && hi &&
      typeof lo.latitude === "number" && typeof lo.longitude === "number" &&
      typeof hi.latitude === "number" && typeof hi.longitude === "number" &&
      hi.latitude > lo.latitude && hi.longitude > lo.longitude
        ? {
            minLat: lo.latitude,
            minLng: lo.longitude,
            maxLat: hi.latitude,
            maxLng: hi.longitude,
          }
        : undefined;

    return {
      placeId: j.id ?? opts.placeId,
      name: j.displayName?.text ?? "",
      latitude: lat,
      longitude: lng,
      bounds,
    };
  } catch (err) {
    log.warn("places.resolve.error", { err: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this prediction a place to stay, rather than a place to go?
 *
 * Drives which group a row lands in. `lodging` is the primary type Google gives
 * accommodation; the specific ones are listed because a property can carry
 * `resort_hotel` or `hotel` without `lodging` surviving the field mask.
 */
const LODGING_TYPES = new Set([
  "lodging", "hotel", "resort_hotel", "motel", "guest_house",
  "bed_and_breakfast", "extended_stay_hotel", "budget_japanese_inn",
  "campground", "cottage", "farmstay", "hostel", "inn", "japanese_inn",
  "private_guest_room", "rv_park",
]);

export function isLodging(types: string[]): boolean {
  return types.some((t) => LODGING_TYPES.has(t));
}
