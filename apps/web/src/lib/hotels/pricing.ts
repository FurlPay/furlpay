import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import {
  searchDuffelStaysByLocation,
  duffelMode,
  type DuffelAccommodation,
  type DuffelStayRate,
} from "@/lib/travel/duffel";
import { bestMatch, mayPrice, ESCALATING_RADII_KM, type HotelMatch, type OsmSubject } from "./match";

// ---------------------------------------------------------------------------
// Lazy per-hotel pricing.
//
// THE RULE THAT SHAPES EVERYTHING HERE: the map never prices what it draws.
// A viewport can hold thousands of hotels; pricing them on load would be one
// upstream call per marker, which is slow, expensive, and mostly wasted because
// a user looks at two or three. So markers render from OSM instantly and a rate
// is fetched only for the hotel someone actually points at.
//
// THREE DEFENCES against a hover storm, in order of cheapness:
//   1. TTL cache      - the same hotel and the same search context reuses a rate
//   2. in-flight coalescing - N concurrent askers share ONE upstream request
//   3. escalating radius    - start at 1km, widen only while inconclusive
//
// AND THE HONESTY RULE: a rate is displayed only behind a HIGH-confidence match
// to a Duffel property. A MEDIUM match prices a hotel that might be the one next
// door, which is a fabricated price wearing a real number's clothes.
// ---------------------------------------------------------------------------

/** What the user is actually searching for. A rate is only valid for one of
 *  these - change any field and the cached price is meaningless. */
export interface HotelSearchContext {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number[];
  rooms: number;
  currency?: string;
}

export type PriceState =
  | "loading"
  | "available"
  | "unavailable"
  | "not_checked"
  | "error"
  /** A real Duffel response, but from a test token: sandbox inventory that must
   *  never be presented as a bookable live rate. */
  | "sandbox";

export interface HotelPrice {
  state: PriceState;
  /** Cheapest TOTAL for the stay, as Duffel priced it. */
  totalAmount?: number;
  /** Derived from the total and the night count - never independently sourced. */
  perNightAmount?: number;
  currency?: string;
  nights?: number;
  /** Present only when a price is. */
  duffelAccommodationId?: string;
  searchResultId?: string;
  match?: HotelMatch;
  /** ISO timestamp of the upstream call, so the UI can word freshness honestly. */
  fetchedAt?: string;
  /** When Duffel's quote stops being valid. */
  expiresAt?: string;
}

/** Short by design. A stale rate shown as current is a wrong price, and Duffel
 *  quotes carry their own expiry anyway. */
const PRICE_TTL_SECONDS = 180;

/**
 * Deterministic cache key.
 *
 * Every field that changes the upstream request is in the key. Children are
 * sorted so [5,8] and [8,5] share a cache entry - they are the same booking.
 */
export function priceCacheKey(osmId: string, ctx: HotelSearchContext): string {
  const kids = [...ctx.children].sort((a, b) => a - b).join(".");
  return [
    "duffel:price",
    osmId,
    ctx.checkIn,
    ctx.checkOut,
    `${ctx.adults}a`,
    `${kids || 0}c`,
    `${ctx.rooms}r`,
    ctx.currency ?? "-",
  ].join(":");
}

/** Askers waiting on the same upstream request, keyed exactly as the cache is. */
const inFlight = new Map<string, Promise<HotelPrice>>();

/** A search result carries everything a catalog entry does, so matching can run
 *  against the priced results directly - one upstream call, not two. */
function asCandidate(r: DuffelStayRate): DuffelAccommodation {
  return {
    id: r.accommodationId,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    city: r.city,
    countryCode: r.countryCode,
    stars: r.stars,
    chain: r.chain,
    brand: r.brand,
  };
}

async function fetchPrice(osm: OsmSubject, ctx: HotelSearchContext): Promise<HotelPrice> {
  const mode = duffelMode();
  let lastMatch: HotelMatch | null = null;

  for (const radiusKm of ESCALATING_RADII_KM) {
    const resp = await searchDuffelStaysByLocation({
      latitude: osm.latitude,
      longitude: osm.longitude,
      radiusKm,
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      adults: ctx.adults,
      children: ctx.children,
      rooms: ctx.rooms,
    });

    // null means no key or an upstream failure - distinct from "no inventory".
    if (!resp) {
      log.warn("hotel_map.price.upstream_null", { osmId: osm.id, radiusKm });
      return { state: "error" };
    }
    if (!resp.results.length) continue;

    const match = bestMatch(osm, resp.results.map(asCandidate));
    if (match && (!lastMatch || match.score > lastMatch.score)) lastMatch = match;

    if (!mayPrice(lastMatch)) continue;

    const hit = resp.results.find((r) => r.accommodationId === lastMatch!.duffelAccommodationId);
    if (!hit || hit.cheapestTotalAmount === undefined) continue;

    const nights = resp.meta.nights;
    log.info("hotel_map.price", {
      osmId: osm.id,
      radiusKm,
      confidence: lastMatch!.confidence,
      distanceMeters: lastMatch!.distanceMeters,
      priceFound: true,
      mode,
    });

    return {
      // A real number from a test token is sandbox inventory, and saying so is
      // the only thing that keeps the UI from advertising it as bookable.
      state: mode === "live" ? "available" : "sandbox",
      totalAmount: hit.cheapestTotalAmount,
      perNightAmount:
        Math.round((hit.cheapestTotalAmount / Math.max(1, nights)) * 100) / 100,
      currency: hit.cheapestCurrency,
      nights,
      duffelAccommodationId: hit.accommodationId,
      searchResultId: hit.searchResultId,
      match: lastMatch!,
      fetchedAt: resp.meta.fetchedAt,
      expiresAt: hit.expiresAt,
    };
  }

  // Duffel answered but has nothing we can confidently attach to this hotel.
  // The marker stays on the map: the hotel exists, we just cannot price it.
  log.info("hotel_map.no_inventory", {
    osmId: osm.id,
    confidence: lastMatch?.confidence ?? "UNMATCHED",
  });
  return { state: "unavailable", match: lastMatch ?? undefined };
}

/**
 * Price one OSM hotel, sharing work with anything already asking for it.
 *
 * The in-flight entry is removed in `finally` so a failure does not poison the
 * key - the next asker retries rather than inheriting a rejected promise.
 */
export async function priceOsmHotel(
  osm: OsmSubject,
  ctx: HotelSearchContext
): Promise<HotelPrice> {
  const key = priceCacheKey(osm.id, ctx);

  const cached = await kvGet<HotelPrice>(key).catch(() => null);
  if (cached) {
    log.info("hotel_map.cache_hit", { osmId: osm.id });
    return cached;
  }

  const running = inFlight.get(key);
  if (running) return running;

  log.info("hotel_map.cache_miss", { osmId: osm.id });
  const task = (async () => {
    try {
      const price = await fetchPrice(osm, ctx);
      // Only cache settled answers. "error" is a transient upstream condition
      // and caching it would extend one blip across the whole TTL.
      if (price.state !== "error") {
        await kvSet(key, price, PRICE_TTL_SECONDS).catch(() => {});
      }
      return price;
    } catch (e) {
      log.warn("hotel_map.error", { osmId: osm.id, error: (e as Error).message });
      return { state: "error" as const };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/** Test seam: how many upstream requests are currently shared. */
export function inFlightCount(): number {
  return inFlight.size;
}
