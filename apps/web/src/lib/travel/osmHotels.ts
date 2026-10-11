import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// OpenStreetMap hotel geodata via the Overpass API.
//
// WHY THIS EXISTS. Duffel gives prices and photos but only for cities we hold a
// search anchor for, and only with an API key. OSM gives the thing neither the
// demo generator nor an unkeyed deployment has: REAL hotel positions, anywhere
// on earth, for free. That is what a world map needs — a marker has to stand on
// a building that exists.
//
// WHAT IT DOES NOT GIVE. No prices, no availability, no photos. OSM is a
// geographic database, not a booking system. So a hotel sourced here is
// rendered WITHOUT a price rather than with a plausible-looking number — the
// map's job is to show where hotels are, and inventing a rate to fill the pill
// would be the one thing that makes the whole surface untrustworthy.
//
// Licence: ODbL. Attribution to OpenStreetMap contributors is required and is
// rendered by the map's attribution control.
// ---------------------------------------------------------------------------

/**
 * Overpass endpoints, tried in order.
 *
 * WHY A LIST. These are volunteer-run instances with no SLA, and they go down
 * independently — measured from this machine, overpass-api.de was refusing
 * connections outright while a mirror answered the identical query in 9s. With
 * a single endpoint that outage is indistinguishable from "there are no hotels
 * here", which is the one thing the map must never say by accident.
 *
 * The main instance stays first: it is the reference implementation and the
 * best maintained. The mirrors exist so one host being down degrades latency
 * rather than correctness.
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

/**
 * Overpass's own server-side budget, in seconds, embedded in the query.
 * The client budget below MUST exceed it: a client timeout shorter than the
 * server's own means we abort queries that were still legitimately running and
 * report an outage that never happened. That was measured — a 0.05-degree box
 * that normally answers in ~1s was being killed at 12s while the server was
 * still working within its 20s allowance.
 */
const OVERPASS_QUERY_TIMEOUT_S = 16;

/** Client budget per endpoint, deliberately above the server's own. */
const PER_ENDPOINT_TIMEOUT_MS = (OVERPASS_QUERY_TIMEOUT_S + 4) * 1000;

/**
 * Last endpoint that actually answered, tried first next time.
 *
 * WHY THIS MATTERS MORE THAN THE TIMEOUTS. Measured from this machine the
 * primary instance refuses connections outright, so a fixed order paid the full
 * per-endpoint budget on every single uncached request before reaching a mirror
 * that works — around 24 seconds of pure waste per query, which is what made a
 * moderate zoom-out look like an outage.
 *
 * Module-level rather than persisted: it is a latency hint, not state worth
 * storing, and a fresh process rediscovering it costs exactly one slow request.
 */
let preferredEndpoint: string | null = null;

/** Endpoints with the last known-good one first. */
function orderedEndpoints(): readonly string[] {
  if (!preferredEndpoint) return ENDPOINTS;
  return [preferredEndpoint, ...ENDPOINTS.filter((e) => e !== preferredEndpoint)];
}

/** Shared with other Overpass readers (nearby places), so they reuse the same
 *  known-good-first hint rather than rediscovering a dead primary. */
export { orderedEndpoints as orderedOverpassEndpoints };
export function rememberOverpassEndpoint(endpoint: string): void {
  if ((ENDPOINTS as readonly string[]).includes(endpoint)) preferredEndpoint = endpoint;
}

/** Overpass is a shared free service with no SLA. Keep requests few and small,
 *  cache hard, and never retry aggressively — the polite-use policy is the
 *  price of the data being free. */
const CACHE_TTL_SECONDS = 6 * 3600; // OSM hotel geometry changes slowly.

export interface OsmHotel {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** OSM `stars` tag: "5", "5S", "4.5". Free-text in practice. */
  stars?: number;
  brand?: string;
  city?: string;
  country?: string;
  /** tourism=hotel | resort | guest_house | hostel | apartment */
  kind: string;
  website?: string;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** OSM stars are free text. "5S" (superior) counts as 5; anything unparseable
 *  becomes undefined rather than a guess. */
function parseStars(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const m = String(raw).match(/^(\d(?:\.\d)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : undefined;
}

function validCoord(lat: unknown, lng: unknown): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return (
    Number.isFinite(a) && Number.isFinite(b) &&
    a >= -90 && a <= 90 && b >= -180 && b <= 180 &&
    !(a === 0 && b === 0)
  );
}

/**
 * A bbox rounded to ~0.05° so nearby viewports share a cache entry.
 *
 * Without this every pixel of pan is a new key and the cache never hits, which
 * on a shared public API is the difference between polite and abusive.
 */
function cacheKey(b: BBox, minStars: number): string {
  const r = (n: number) => Math.round(n * 20) / 20;
  return `osm:hotels:${r(b.minLat)},${r(b.minLng)},${r(b.maxLat)},${r(b.maxLng)}:s${minStars}`;
}

/** Overpass rejects unbounded queries. Anything larger than this would try to
 *  return the world's hotels, so the caller is told to zoom in instead. */
const MAX_SPAN_DEGREES = 6;

export { MAX_SPAN_DEGREES };

export function bboxTooLarge(b: BBox): boolean {
  return b.maxLat - b.minLat > MAX_SPAN_DEGREES || b.maxLng - b.minLng > MAX_SPAN_DEGREES;
}

/**
 * Hotels inside `bbox` from OSM. Returns null on any failure, so the caller
 * falls back rather than showing an error over a working map.
 *
 * `minStars` filters server-side: at wide zooms only starred properties are
 * worth returning, since drawing every guest house in a metro area is both a
 * slow query and an unreadable map.
 */
export async function osmHotelsInBBox(bbox: BBox, minStars = 0): Promise<OsmHotel[] | null> {
  if (bboxTooLarge(bbox)) return null;

  const key = cacheKey(bbox, minStars);
  const cached = await kvGet<OsmHotel[]>(key).catch(() => null);
  if (cached) return cached;

  // `nwr` covers nodes, ways and relations — a large hotel is mapped as a
  // building outline, not a point, and `out center` gives it a centroid.
  const area = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const starFilter = minStars > 0 ? `["stars"]` : "";
  const query =
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];` +
    `nwr["tourism"~"^(hotel|resort)$"]["name"]${starFilter}(${area});` +
    `out center 200;`;

  let lastError = "";

  for (const endpoint of orderedEndpoints()) {
    const controller = new AbortController();
    // A ref'd timer: AbortSignal.timeout() is unref'd in Node, so a hung socket
    // would never fire its own timeout when nothing else is pending.
    const timer = setTimeout(() => controller.abort(), PER_ENDPOINT_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Some instances sit behind a proxy that content-negotiates and
          // returns 406 when no Accept header is present.
          Accept: "*/*",
          // Overpass asks clients to identify themselves; an anonymous flood is
          // what gets an IP blocked from the public instance.
          "User-Agent": "FurlPay/1.0 (+https://furlpay.com) hotel-map",
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        lastError = `http ${res.status}`;
        log.warn("osm.overpass.http", { endpoint, status: res.status });
        continue;
      }

      const json = (await res.json()) as { elements?: unknown[] };
      const hotels = parseElements(json.elements ?? [], minStars);
      // Remember what worked, so the next request does not re-discover it.
      preferredEndpoint = endpoint;
      await kvSet(key, hotels, CACHE_TTL_SECONDS).catch(() => {});
      return hotels;
    } catch (e) {
      // Timeout, abort, network, malformed JSON — all mean "try the next one".
      lastError = (e as Error).message;
      log.warn("osm.overpass.failed", { endpoint, error: lastError });
    } finally {
      clearTimeout(timer);
    }
  }

  // The hint is deliberately KEPT here.
  //
  // Exhaustion usually means the QUERY was too heavy for anyone to answer in
  // budget, not that the healthy mirror died. Clearing it made the next request
  // re-pay full discovery through a primary that is down — measured as Lisbon
  // 35.3s (discovery), Madrid 3.8s, Rome 3.2s, then one hard query for Berlin
  // reset the hint and Dubai paid 34.3s all over again. Keeping it costs
  // nothing if the endpoint really is gone, since that request fails anyway.
  log.warn("osm.overpass.exhausted", {
    endpoints: ENDPOINTS.length,
    lastError,
    keptPreferred: preferredEndpoint !== null,
  });
  return null;
}

/** Elements -> hotels, dropping anything without a name or a usable position. */
function parseElements(elements: unknown[], minStars: number): OsmHotel[] {
  const hotels: OsmHotel[] = [];
  for (const raw of elements) {
    const e = raw as {
      id?: number; type?: string; lat?: number; lon?: number;
      center?: { lat?: number; lon?: number };
      tags?: Record<string, string>;
    };
    const tags = e.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    // A node carries lat/lon directly; a way/relation carries `center`.
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!validCoord(lat, lng)) continue;

    const stars = parseStars(tags.stars);
    if (minStars > 0 && (stars === undefined || stars < minStars)) continue;

    hotels.push({
      id: `osm_${(e.type ?? "n")[0]}${e.id ?? hotels.length}`,
      name,
      latitude: Number(lat),
      longitude: Number(lng),
      stars,
      brand: tags.brand || undefined,
      city: tags["addr:city"] || undefined,
      country: tags["addr:country"] || undefined,
      kind: tags.tourism ?? "hotel",
      website: tags.website || undefined,
    });
  }
  return hotels;
}
