import { log } from "@/lib/log";
import {
  CITY_COORDS,
  Flight,
  FlightLeg,
  FlightSegment,
  Stay,
  StayType,
  CarRental,
  CarCategory,
  carModelPhoto,
  nights as nightsBetween,
} from "./data";

// Live flight search via Duffel (mid-2026 the one self-serve top-tier supplier:
// Amadeus Self-Service sunsets 2026-07-17, Kiwi Tequila is closed to new
// partners). Free duffel_test_ tokens return sandbox offers with the exact
// production schema, so the UI renders real API data end-to-end.
// Returns null when no key is set or the request fails — callers fall back to
// the deterministic demo generator so search never breaks.

const BASE = process.env.DUFFEL_API_BASE || "https://api.duffel.com";

const CABIN_MAP: Record<Flight["cabin"], string> = {
  Economy: "economy",
  Premium: "premium_economy",
  Business: "business",
  First: "first",
};

function hhmm(iso?: string): string {
  const m = String(iso ?? "").match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "—";
}

function minutesBetween(a?: string, b?: string): number {
  const start = Date.parse(a ?? "");
  const end = Date.parse(b ?? "");
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

// Duffel durations are ISO 8601 (e.g. "PT8H10M"). Departure/arrival timestamps
// are local wall-clock times, so subtracting them silently drops the timezone
// shift (LHR→JFK would show ~3h instead of ~8h) — always prefer the duration
// field and only fall back to timestamp math when it's absent.
function iso8601Minutes(duration?: string): number {
  const m = String(duration ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// ---------------------------------------------------------------------------
// Environment guard for the Duffel credential.
//
// Duffel tokens are environment-scoped: a duffel_test_ token only reaches test
// mode (sandbox airlines, including Duffel's synthetic "Duffel Airways"), and a
// duffel_live_ token only reaches live mode, where CREATING AN ORDER BOOKS A
// REAL SEAT AND INCURS A REAL FINANCIAL OBLIGATION.
//
// Nothing previously distinguished them: duffel.ts read DUFFEL_API_KEY and used
// whatever it found. Both directions of that mistake are bad, and asymmetric:
//   test token in production  -> customers pay real money for sandbox bookings
//                                that no airline will honour
//   live token in dev/CI      -> a test run books, and is billed for, real
//                                flights. This is the expensive direction.
//
// The money layer already fails closed like this (settle() hard-stops on
// NODE_ENV=production, createEvmSettler() returns null without a key). Travel
// had no equivalent, despite being the subsystem that can create an obligation
// to a third party. This closes that asymmetry.
// ---------------------------------------------------------------------------

type DuffelMode = "test" | "live" | "unknown";

export function duffelKeyMode(key: string | undefined): DuffelMode {
  if (key?.startsWith("duffel_test_")) return "test";
  if (key?.startsWith("duffel_live_")) return "live";
  return "unknown";
}

/**
 * Return the Duffel key only when it is valid for THIS environment.
 * Returns null otherwise, which every caller already handles by falling back
 * to the deterministic demo generator — so search degrades instead of breaking.
 */
function duffelKey(): string | null {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) return null;

  const mode = duffelKeyMode(key);
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && mode !== "live") {
    log.error("DUFFEL_API_KEY is not a live token — refusing to use it in production", {
      mode,
      detail: "Test tokens only reach sandbox airlines. Customers would pay for bookings no airline honours.",
    });
    return null;
  }
  if (!isProd && mode === "live") {
    log.error("DUFFEL_API_KEY is a LIVE token outside production — refusing to use it", {
      nodeEnv: process.env.NODE_ENV ?? "(unset)",
      detail: "A live token creates REAL, BILLABLE airline bookings. Use a duffel_test_ token here.",
    });
    return null;
  }
  if (mode === "unknown") {
    log.error("DUFFEL_API_KEY has an unrecognised prefix — refusing to use it", {
      detail: "Expected duffel_test_ or duffel_live_. An unidentifiable token cannot be proven safe.",
    });
    return null;
  }
  return key;
}

// ── Flights ──────────────────────────────────────────────────────────────────

export interface FlightSearchRequest {
  from: string;
  to: string;
  departDate: string;
  /** Present → a return trip (two slices). */
  returnDate?: string;
  adults?: number;
  /** Duffel requires an age for every passenger under 18. */
  childAges?: number[];
  cabin?: Flight["cabin"];
  /** Duffel `max_connections` per slice: 0 = nonstop only. Default 1. */
  maxConnections?: 0 | 1 | 2;
}

function legOf(slice: any): FlightLeg {
  const segs: any[] = Array.isArray(slice?.segments) ? slice.segments : [];
  const segments: FlightSegment[] = segs.map((s) => ({
    carrier: String(s?.marketing_carrier?.name ?? s?.operating_carrier?.name ?? "Airline"),
    carrierCode: String(s?.marketing_carrier?.iata_code ?? ""),
    flightNumber: `${s?.marketing_carrier?.iata_code ?? ""}${s?.marketing_carrier_flight_number ?? ""}`,
    from: String(s?.origin?.iata_code ?? ""),
    to: String(s?.destination?.iata_code ?? ""),
    departAt: String(s?.departing_at ?? ""),
    arriveAt: String(s?.arriving_at ?? ""),
    durationMin: iso8601Minutes(s?.duration) || minutesBetween(s?.departing_at, s?.arriving_at),
    aircraft: s?.aircraft?.name || undefined,
    operatedBy:
      s?.operating_carrier?.name && s?.operating_carrier?.name !== s?.marketing_carrier?.name ? String(s.operating_carrier.name) : undefined,
  }));
  // Connection time = next departure − this arrival. Both are LOCAL times at
  // the SAME airport, so the subtraction is valid (unlike across timezones).
  const layovers = segments.slice(0, -1).map((s, i) => ({ airport: s.to, minutes: minutesBetween(s.arriveAt, segments[i + 1].departAt) }));
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    from: first?.from ?? String(slice?.origin?.iata_code ?? ""),
    to: last?.to ?? String(slice?.destination?.iata_code ?? ""),
    departAt: first?.departAt ?? "",
    arriveAt: last?.arriveAt ?? "",
    durationMin:
      iso8601Minutes(slice?.duration) || segments.reduce((n, s) => n + s.durationMin, 0) + layovers.reduce((n, l) => n + l.minutes, 0),
    stops: Math.max(0, segments.length - 1),
    segments,
    layovers,
  };
}

/** Bags the airline states for the FIRST passenger on the first segment.
 *  undefined when the offer says nothing — never a guess. */
function bagsOf(o: any): Flight["bags"] {
  const list: any[] = o?.slices?.[0]?.segments?.[0]?.passengers?.[0]?.baggages;
  if (!Array.isArray(list)) return undefined;
  const sum = (t: string) => list.filter((b) => b?.type === t).reduce((n, b) => n + (Number(b?.quantity) || 0), 0);
  return { checked: sum("checked"), carryOn: sum("carry_on") };
}

function bagsLabel(b: Flight["bags"]): string {
  if (!b) return "Bags not stated by airline";
  const parts = [];
  if (b.carryOn) parts.push(`${b.carryOn} carry-on`);
  if (b.checked) parts.push(`${b.checked} checked`);
  return parts.length ? parts.join(" + ") : "No bags included";
}

function allowed(cond: any): boolean | undefined {
  return typeof cond?.allowed === "boolean" ? cond.allowed : undefined;
}

/** Map one Duffel offer onto Flight. Pure; exported for tests. */
export function mapDuffelOffer(o: any, cabin: Flight["cabin"] = "Economy"): Flight | null {
  const legs = (Array.isArray(o?.slices) ? o.slices : []).map(legOf).filter((l: FlightLeg) => l.segments.length);
  const amount = Number(o?.total_amount);
  if (!o?.id || !legs.length || !Number.isFinite(amount) || amount <= 0) return null;
  const out = legs[0];
  const bags = bagsOf(o);
  return {
    id: String(o.id),
    carrier: String(o?.owner?.name ?? out.segments[0].carrier),
    carrierCode: String(o?.owner?.iata_code ?? out.segments[0].carrierCode),
    from: out.from,
    to: out.to,
    date: out.departAt.slice(0, 10),
    departTime: hhmm(out.departAt),
    arriveTime: hhmm(out.arriveAt),
    // Whole trip: both legs on a return.
    durationMin: legs.reduce((n: number, l: FlightLeg) => n + l.durationMin, 0),
    stops: Math.max(...legs.map((l: FlightLeg) => l.stops)),
    cabin,
    logoUrl: o?.owner?.logo_symbol_url ?? undefined,
    priceUsd: Math.round(amount * 100) / 100,
    currency: typeof o?.total_currency === "string" ? o.total_currency : undefined,
    baggage: bagsLabel(bags),
    bags,
    refundable: allowed(o?.conditions?.refund_before_departure),
    changeable: allowed(o?.conditions?.change_before_departure),
    expiresAt: typeof o?.expires_at === "string" ? o.expires_at : undefined,
    legs,
  };
}

/**
 * Offer request with every offer returned (no price-sort-and-truncate: the
 * caller ranks the full set). Return trips are two slices; children are
 * passengers with an age, as Duffel requires.
 */
export async function searchDuffelFlightOffers(req: FlightSearchRequest): Promise<Flight[] | null> {
  const apiKey = duffelKey();
  if (!apiKey || !req.from || !req.to || !req.departDate) return null;
  const cabin = req.cabin ?? "Economy";
  const from = req.from.toUpperCase();
  const to = req.to.toUpperCase();
  const slices = [{ origin: from, destination: to, departure_date: req.departDate }];
  if (req.returnDate) slices.push({ origin: to, destination: from, departure_date: req.returnDate });
  const passengers = [
    ...Array.from({ length: Math.max(1, Math.min(req.adults ?? 1, 9)) }, () => ({ type: "adult" as const })),
    ...(req.childAges ?? []).slice(0, 8).map((age) => ({ age: Math.max(0, Math.min(17, Math.round(age))) })),
  ];
  try {
    // supplier_timeout: Duffel's documented range is 2-60 s (default 20 s).
    // 15 s keeps a slow airline from holding the whole page.
    const res = await fetch(`${BASE}/air/offer_requests?return_offers=true&supplier_timeout=15000`, {
      method: "POST",
      headers: DUFFEL_HEADERS(apiKey),
      body: JSON.stringify({
        data: {
          slices,
          passengers,
          cabin_class: CABIN_MAP[cabin] ?? "economy",
          max_connections: req.maxConnections ?? 1,
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("duffel.flights.http", { status: res.status });
      return null;
    }
    const json: any = await res.json();
    const offers: any[] = json?.data?.offers ?? [];
    const mapped = offers.map((o) => mapDuffelOffer(o, cabin)).filter((f): f is Flight => !!f);
    return mapped.length ? mapped : null;
  } catch (e) {
    log.warn("duffel.flights.failed", { error: (e as Error).message });
    return null;
  }
}

/** One-way, one adult — the original signature, kept for existing callers. */
export async function searchDuffelFlights(
  from: string,
  to: string,
  date: string,
  cabin: Flight["cabin"] = "Economy",
): Promise<Flight[] | null> {
  return searchDuffelFlightOffers({ from, to, departDate: date, cabin });
}

// ── Duffel Stays: live hotels with real property photos ─────────────────────

const GRADIENT_FALLBACK = [
  "from-sky-500/40 to-indigo-600/40",
  "from-fuchsia-500/40 to-purple-700/40",
  "from-emerald-500/40 to-teal-700/40",
  "from-amber-500/40 to-orange-700/40",
  "from-rose-500/40 to-pink-700/40",
];

function toStayType(raw?: string): StayType {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("resort")) return "Resort";
  if (t.includes("villa")) return "Villa";
  if (t.includes("apart")) return "Apartment";
  if (t.includes("hostel")) return "Hostel";
  return "Hotel";
}

/**
 * Validate supplier coordinates before they reach a map.
 *
 * Returns an empty object when the pair is missing or out of range, so the
 * Stay simply has no position rather than a wrong one. The 0,0 case is
 * rejected explicitly: it is Null Island, and it is what a supplier sends when
 * it means "unknown" — rendering a hotel there is worse than omitting it,
 * because a marker in the Gulf of Guinea looks like data rather than absence.
 */
function coordsOf(raw: unknown): { latitude?: number; longitude?: number } {
  if (!raw || typeof raw !== "object") return {};
  const g = raw as { latitude?: unknown; longitude?: unknown };
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return {};
  if (lat === 0 && lng === 0) return {};
  return { latitude: lat, longitude: lng };
}

// ── Coordinate-first Stays primitives ──────────────────────────────────────
//
// WHY THIS EXISTS. Duffel's Stays search has always taken
// `location.geographic_coordinates` + `location.radius`; the old
// searchDuffelStays only used CITY_COORDS to *derive* that pair, which capped
// the whole product at the cities we happened to have anchors for. That was an
// application limit, never an API one. These primitives take the coordinate
// directly, so any point on earth is searchable and the city helper below
// becomes a convenience wrapper rather than the gate.

export type { DuffelMode };

/** The configured token's mode, safe to expose — it reveals no secret and the
 *  UI needs it to avoid presenting sandbox inventory as bookable. */
export function duffelMode(): DuffelMode {
  return duffelKeyMode(process.env.DUFFEL_API_KEY);
}

export type DuffelGuest = { type: "adult" } | { type: "child"; age: number };

/** Duffel documents radius in kilometres, integer, 1-100. */
const RADIUS_MIN_KM = 1;
const RADIUS_MAX_KM = 100;

export interface DuffelStayQuery {
  latitude: number;
  longitude: number;
  /** Kilometres. Clamped to Duffel's documented 1-100. */
  radiusKm?: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  /** Ages of accompanying children; Duffel requires an age per child guest. */
  children?: number[];
  rooms?: number;
}

/**
 * One accommodation from a Stays search.
 *
 * EVERY SUPPLIER FIELD IS OPTIONAL, deliberately. The legacy `Stay` type
 * requires `stars`, `rating` and `reviews` as plain numbers, which is why the
 * old mapper filled them with `?? 4` and `4.5` — inventing a star class and a
 * review score for properties Duffel said nothing about. Here, absent means
 * absent, and the UI renders nothing rather than a number nobody measured.
 */
export interface DuffelStayRate {
  accommodationId: string;
  searchResultId: string;
  name: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  countryCode?: string;
  /** Duffel `rating`: star class, integer 1-5. */
  stars?: number;
  /** Duffel `review_score`: 1.0-10.0 on Duffel's own scale, NOT rescaled here. */
  reviewScore?: number;
  chain?: string;
  brand?: string;
  photo?: string;
  /** Total for the whole stay, as Duffel priced it. Per-night is derived by
   *  the caller that knows the night count. */
  cheapestTotalAmount?: number;
  cheapestCurrency?: string;
  /** When Duffel's quoted price stops being valid. */
  expiresAt?: string;
}

export interface DuffelStayResponse {
  results: DuffelStayRate[];
  meta: {
    source: "duffel";
    mode: DuffelMode;
    /** ISO timestamp of the upstream call, so freshness wording can be honest. */
    fetchedAt: string;
    /** True ONLY against a live token. Test-mode inventory is Duffel's sandbox
     *  and must never be labelled a live price. */
    isLiveSearch: boolean;
    nights: number;
  };
}

function clampRadius(km: number | undefined): number {
  const n = Math.round(Number(km ?? 5));
  if (!Number.isFinite(n)) return 5;
  return Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, n));
}

/** Default window, used when the caller has no search context yet. */
function defaultDates(checkIn?: string, checkOut?: string): [string, string] {
  const inDate = checkIn || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const outDate = checkOut || new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
  return [inDate, outDate];
}

function buildGuests(adults: number, children: number[]): DuffelGuest[] {
  const out: DuffelGuest[] = [];
  for (let i = 0; i < Math.max(1, Math.min(adults, 9)); i++) out.push({ type: "adult" });
  for (const age of children.slice(0, 9)) {
    const a = Math.max(0, Math.min(17, Math.round(Number(age))));
    if (Number.isFinite(a)) out.push({ type: "child", age: a });
  }
  return out;
}

function numOrUndef(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Stays search around an arbitrary coordinate.
 *
 * Returns null on missing key or any failure, matching the convention every
 * caller in this file already handles.
 */
export async function searchDuffelStaysByLocation(
  q: DuffelStayQuery,
): Promise<DuffelStayResponse | null> {
  const apiKey = duffelKey();
  if (!apiKey) return null;
  if (!Number.isFinite(q.latitude) || !Number.isFinite(q.longitude)) return null;
  if (q.latitude < -90 || q.latitude > 90 || q.longitude < -180 || q.longitude > 180) return null;

  const [inDate, outDate] = defaultDates(q.checkIn, q.checkOut);
  const n = nightsBetween(inDate, outDate);
  const mode = duffelKeyMode(apiKey);

  try {
    const res = await fetch(`${BASE}/stays/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          check_in_date: inDate,
          check_out_date: outDate,
          rooms: Math.max(1, Math.min(Number(q.rooms ?? 1), 9)),
          guests: buildGuests(q.adults ?? 2, q.children ?? []),
          location: {
            radius: clampRadius(q.radiusKm),
            geographic_coordinates: { latitude: q.latitude, longitude: q.longitude },
          },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("duffel.stays.search.http", { status: res.status });
      return null;
    }
    const json: any = await res.json();
    const raw: any[] = json?.data?.results ?? [];

    const results: DuffelStayRate[] = raw.map((r: any): DuffelStayRate => {
      const a = r?.accommodation ?? {};
      const coords = coordsOf(a?.location?.geographic_coordinates);
      const stars = Number(a?.rating);
      return {
        accommodationId: String(a?.id ?? ""),
        searchResultId: String(r?.id ?? ""),
        name: String(a?.name ?? ""),
        ...coords,
        city: a?.location?.address?.city_name || undefined,
        countryCode: a?.location?.address?.country_code || undefined,
        stars: Number.isFinite(stars) && stars >= 1 && stars <= 5 ? Math.round(stars) : undefined,
        reviewScore: numOrUndef(a?.review_score),
        chain: a?.chain?.name || undefined,
        brand: a?.brand?.name || undefined,
        photo: a?.photos?.[0]?.url || undefined,
        cheapestTotalAmount: numOrUndef(r?.cheapest_rate_total_amount),
        cheapestCurrency: r?.cheapest_rate_currency || undefined,
        expiresAt: r?.expires_at || undefined,
      };
    }).filter((x) => x.accommodationId && x.name);

    return {
      results,
      meta: {
        source: "duffel",
        mode,
        fetchedAt: new Date().toISOString(),
        isLiveSearch: mode === "live",
        nights: n,
      },
    };
  } catch (e) {
    log.warn("duffel.stays.search.failed", { error: (e as Error).message });
    return null;
  }
}

export interface DuffelAccommodation {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  countryCode?: string;
  stars?: number;
  chain?: string;
  brand?: string;
}

/**
 * The accommodation catalog: GET /stays/accommodation, which lists supplier
 * properties near a coordinate WITHOUT dates or pricing.
 *
 * Its role is candidate discovery for matching an OSM hotel to a Duffel
 * property — not a replacement for the OSM layer. Duffel documents radius as
 * 1-100 km and limit as 1-200 with cursor pagination.
 */
export async function duffelAccommodationCatalog(opts: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  limit?: number;
  after?: string;
}): Promise<{ items: DuffelAccommodation[]; nextCursor?: string } | null> {
  const apiKey = duffelKey();
  if (!apiKey) return null;
  if (!Number.isFinite(opts.latitude) || !Number.isFinite(opts.longitude)) return null;

  const params = new URLSearchParams({
    latitude: String(opts.latitude),
    longitude: String(opts.longitude),
    radius: String(clampRadius(opts.radiusKm)),
    limit: String(Math.min(200, Math.max(1, Math.round(Number(opts.limit ?? 50))))),
  });
  if (opts.after) params.set("after", opts.after);

  try {
    const res = await fetch(`${BASE}/stays/accommodation?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("duffel.accommodation.http", { status: res.status });
      return null;
    }
    const json: any = await res.json();
    const items: DuffelAccommodation[] = (json?.data ?? []).map((a: any) => {
      const stars = Number(a?.rating);
      return {
        id: String(a?.id ?? ""),
        name: String(a?.name ?? ""),
        ...coordsOf(a?.location?.geographic_coordinates),
        city: a?.location?.address?.city_name || undefined,
        countryCode: a?.location?.address?.country_code || undefined,
        stars: Number.isFinite(stars) && stars >= 1 && stars <= 5 ? Math.round(stars) : undefined,
        chain: a?.chain?.name || undefined,
        brand: a?.brand?.name || undefined,
      };
    }).filter((x: DuffelAccommodation) => x.id && x.name);

    return { items, nextCursor: json?.meta?.after || undefined };
  } catch (e) {
    log.warn("duffel.accommodation.failed", { error: (e as Error).message });
    return null;
  }
}

/**
 * Live accommodation search for one of the known search-anchor cities.
 *
 * CONVENIENCE WRAPPER ONLY. It resolves a city name to a coordinate and then
 * calls searchDuffelStaysByLocation. Nothing in the map path may depend on it —
 * the map works from viewport coordinates and has no city whitelist.
 */
export async function searchDuffelStays(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
): Promise<Stay[] | null> {
  const apiKey = duffelKey();
  const coords = CITY_COORDS[city];
  if (!apiKey || !coords) return null;
  const [inDate, outDate] = defaultDates(checkIn, checkOut);
  const n = nightsBetween(inDate, outDate);

  const resp = await searchDuffelStaysByLocation({
    latitude: coords.lat,
    longitude: coords.lng,
    radiusKm: 15,
    checkIn: inDate,
    checkOut: outDate,
    adults: guests,
  });
  if (!resp || !resp.results.length) return null;

  // Adapting the honest DuffelStayRate onto the legacy `Stay`, whose stars /
  // rating / reviews are required numbers. Where Duffel said nothing we emit 0
  // rather than the old `?? 4` and `4.5`, which invented a star class and a
  // review score for properties nobody had rated. Consumers already treat 0 as
  // "no data" (the map drops unpriced stays), so this removes a fabrication
  // without changing the shape every existing caller depends on.
  return resp.results
    .map((r, i): Stay => ({
      id: r.accommodationId,
      name: r.name,
      brand: r.chain ?? r.brand ?? "",
      city,
      country: r.countryCode ?? "",
      type: toStayType(r.name),
      stars: r.stars ?? 0,
      // Duffel scores out of 10; Stay.rating is out of 5.
      rating: r.reviewScore !== undefined ? Math.round((r.reviewScore / 2) * 10) / 10 : 0,
      reviews: 0,
      nightlyUsd:
        r.cheapestTotalAmount !== undefined
          ? Math.round((r.cheapestTotalAmount / Math.max(1, n)) * 100) / 100
          : 0,
      image: GRADIENT_FALLBACK[i % GRADIENT_FALLBACK.length],
      photo: r.photo,
      latitude: r.latitude,
      longitude: r.longitude,
      amenities: [],
      roomsLeft: 0,
      freeCancellation: false,
      eco: false,
    }))
    .filter((s) => s.nightlyUsd > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 16);
}

// ── Duffel Cars: live rentals across 40+ brands (launched April 2026) ───────
//
// Same token and conventions as flights/stays: null on missing key, unknown
// city or any failure — callers fall back to the demo generator. Duffel does
// not document the full rate schema publicly, so the mapper reads every field
// defensively and drops rates it can't price.

// Quotes move with supplier inventory; cache briefly so paging/filtering the
// same search doesn't burn through the API quota. 60s TTL per (city, dates).
const CARS_CACHE_TTL_MS = 60_000;
const g = globalThis as unknown as { __duffelCarsCache?: Map<string, { at: number; cars: CarRental[] }> };
const carsCache = (): Map<string, { at: number; cars: CarRental[] }> => (g.__duffelCarsCache ??= new Map());

function toCarCategory(raw?: string): CarCategory {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("suv") || t.includes("crossover")) return "SUV";
  if (t.includes("lux") || t.includes("premium") || t.includes("executive")) return "Luxury";
  if (t.includes("van") || t.includes("mini") && t.includes("bus") || t.includes("people")) return "Van";
  if (t.includes("econ") || t.includes("mini") || t.includes("small")) return "Economy";
  return "Compact";
}

function toFuel(raw?: string): CarRental["fuel"] {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("elect") || t === "ev") return "Electric";
  if (t.includes("hybrid")) return "Hybrid";
  if (t.includes("diesel")) return "Diesel";
  return "Petrol";
}

export async function searchDuffelCars(
  city: string,
  pickUp?: string,
  dropOff?: string,
): Promise<CarRental[] | null> {
  const apiKey = duffelKey();
  const coords = CITY_COORDS[city];
  if (!apiKey || !coords) return null;
  const pickDate = pickUp || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const dropDate = dropOff || new Date(Date.parse(pickDate) + 3 * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(1, nightsBetween(pickDate, dropDate));

  const cacheKey = `${city}:${pickDate}:${dropDate}`;
  const hit = carsCache().get(cacheKey);
  if (hit && Date.now() - hit.at < CARS_CACHE_TTL_MS) return hit.cars;

  try {
    const res = await fetch(`${BASE}/cars/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          pickup_date: pickDate,
          pickup_time: "10:00",
          dropoff_date: dropDate,
          dropoff_time: "10:00",
          pickup_location: {
            radius: 10,
            geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
          },
          dropoff_location: {
            radius: 10,
            geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
          },
          driver: { age: 30, residence_country_code: "US" },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const rates: any[] = json?.data?.results ?? json?.data?.rates ?? json?.data ?? [];
    if (!Array.isArray(rates) || !rates.length) return null;

    const cars = rates
      .map((r, i): CarRental => {
        const v = r?.vehicle ?? r?.car ?? {};
        const name = String(v.name ?? v.model ?? "Rental car");
        // "Toyota RAV4 or similar" → make "Toyota", model "RAV4 or similar"-trimmed
        const cleaned = name.replace(/\s+or similar.*$/i, "").trim();
        const [make, ...rest] = cleaned.split(" ");
        const total = Number(r?.total_amount ?? r?.price?.amount ?? 0);
        const transmission = String(v.transmission ?? "").toLowerCase().includes("man") ? "Manual" : "Automatic";
        return {
          id: String(r.id ?? `duffel_car_${i}`),
          make: make || "Rental",
          model: rest.join(" ") || "car",
          category: toCarCategory(v.category ?? v.class ?? v.acriss_code),
          seats: Number(v.seats ?? 5) || 5,
          doors: Number(v.doors ?? 4) || 4,
          transmission,
          fuel: toFuel(v.fuel_type ?? v.fuel),
          dailyUsd: Math.round((total / days) * 100) / 100,
          supplier: String(r?.supplier?.name ?? r?.vendor?.name ?? "Rental partner"),
          supplierRating: Number(r?.supplier?.rating ?? 8.5) || 8.5,
          freeCancellation: String(r?.payment_type ?? "").toLowerCase() !== "prepaid",
          unlimitedMileage: Boolean(r?.unlimited_mileage ?? String(r?.mileage?.type ?? "").includes("unlimited")),
          insurance: r?.insurance_included ? "Full cover" : "Basic",
          image: GRADIENT_FALLBACK[i % GRADIENT_FALLBACK.length],
          // Supplier photo when present; else our hand-verified model photo.
          photo: v.photo_url ?? v.image_url ?? carModelPhoto(cleaned),
        };
      })
      .filter((c) => c.dailyUsd > 0)
      .sort((a, b) => a.dailyUsd - b.dailyUsd)
      .slice(0, 18);

    if (!cars.length) return null;
    carsCache().set(cacheKey, { at: Date.now(), cars });
    return cars;
  } catch {
    return null;
  }
}

// --- reprice + booking (Duffel Stays) ----------------------------------------
// Inventory pricing is volatile, so the booking flow is search → quote → book:
// the quote re-validates the rate in real time before any money moves, and the
// booking is funded from the pre-funded Duffel Balance (no card processing).
// Both return null on any failure so callers fall back to the demo path.

export interface DuffelStayQuote {
  quoteId: string;
  totalAmount: number;
  currency: string;
}

export interface DuffelStayBooking {
  bookingId: string;
  reference: string; // confirmation / locator code from the accommodation
  status: string;
}

const DUFFEL_HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Duffel-Version": "v2",
  "Content-Type": "application/json",
  Accept: "application/json",
});

/** Re-validate a rate right before checkout (POST /stays/quotes). */
export async function createDuffelStayQuote(rateId: string): Promise<DuffelStayQuote | null> {
  const apiKey = duffelKey();
  if (!apiKey || !rateId) return null;
  try {
    const res = await fetch(`${BASE}/stays/quotes`, {
      method: "POST",
      headers: DUFFEL_HEADERS(apiKey),
      body: JSON.stringify({ data: { rate_id: rateId } }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const q = json?.data;
    if (!q?.id) return null;
    return {
      quoteId: String(q.id),
      totalAmount: Number(q.total_amount ?? 0),
      currency: String(q.total_currency ?? "USD"),
    };
  } catch {
    return null;
  }
}

/** Book a validated quote against the Duffel Balance (POST /stays/bookings). */
export async function createDuffelStayBooking(opts: {
  quoteId: string;
  guest: { givenName: string; familyName: string };
  email: string;
  phone?: string;
}): Promise<DuffelStayBooking | null> {
  const apiKey = duffelKey();
  if (!apiKey || !opts.quoteId) return null;
  try {
    const res = await fetch(`${BASE}/stays/bookings`, {
      method: "POST",
      headers: DUFFEL_HEADERS(apiKey),
      body: JSON.stringify({
        data: {
          quote_id: opts.quoteId,
          guests: [{ given_name: opts.guest.givenName, family_name: opts.guest.familyName }],
          email: opts.email,
          phone_number: opts.phone ?? "+15550000000",
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const b = json?.data;
    if (!b?.id) return null;
    return {
      bookingId: String(b.id),
      reference: String(b.reference ?? b.confirmation_number ?? b.id),
      status: String(b.status ?? "confirmed"),
    };
  } catch {
    return null;
  }
}
