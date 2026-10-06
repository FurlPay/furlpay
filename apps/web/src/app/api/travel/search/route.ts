import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { searchProperties } from "@/lib/travel/propertySource";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  generateStays,
  nights,
  StayType,
  Flight,
} from "@/lib/travel/data";
import { createHash } from "node:crypto";
import {
  duffelMode,
  searchDuffelCars,
  searchDuffelFlightOffers,
  searchDuffelStays,
  type FlightSearchRequest,
} from "@/lib/travel/duffel";
import { highlights, rankFlights, type FlightSort } from "@/lib/travel/flightRanking";
import { kvGet, kvSet } from "@/lib/kv";
import { assessResultSet, rankingWeight } from "@/lib/property/intelligence";
import { rankStays } from "@/lib/travel/ranking";

// POST /api/travel/search — search travel inventory.
// Body: { type: "stays"|"flights"|"cars"|"activities", city, checkIn, checkOut,
//         maxNightlyUsd?, minStars?, propertyType?, guests?, category? }
//
// Public route that can reach the PAID Duffel API, so it is validated (rule 1)
// and rate-limited (rule 2) — otherwise an anonymous caller can burn the API
// quota (and our bill). The schema is permissive on the free-text fields the
// generators already sanitize, but caps every string and bounds every number.

const SearchBody = z
  .object({
    type: z.enum(["stays", "flights", "cars", "activities"]).optional(),
    city: z.string().max(80).optional(),
    from: z.string().max(80).optional(),
    to: z.string().max(80).optional(),
    date: z.string().max(40).optional(),
    checkIn: z.string().max(40).optional(),
    checkOut: z.string().max(40).optional(),
    pickUp: z.string().max(40).optional(),
    dropOff: z.string().max(40).optional(),
    cabin: z.string().max(20).optional(),
    guests: z.coerce.number().int().min(1).max(16).optional(),
    minStars: z.coerce.number().min(1).max(5).optional(),
    maxNightlyUsd: z.coerce.number().positive().max(1_000_000).optional(),
    maxDailyUsd: z.coerce.number().positive().max(1_000_000).optional(),
    maxPriceUsd: z.coerce.number().positive().max(1_000_000).optional(),
    propertyType: z.string().max(30).optional(),
    category: z.string().max(30).optional(),
    // flights
    returnDate: z.string().max(40).optional(),
    adults: z.coerce.number().int().min(1).max(9).optional(),
    childAges: z.array(z.coerce.number().int().min(0).max(17)).max(8).optional(),
    maxStops: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    sort: z.enum(["best", "cheapest", "fastest"]).optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.search", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, SearchBody);
  if (body instanceof NextResponse) return body;
  const kind = body.type ?? "stays";

  if (kind === "stays") {
    const n = nights(body.checkIn, body.checkOut);
    // Live Duffel Stays (real properties + photos) when the key is set and the
    // city is a known anchor; demo generator otherwise. Filters apply to both.
    let stays = await searchDuffelStays(body.city ?? "", body.checkIn, body.checkOut, Number(body.guests) || 2);
    const source = "duffel";
    if (!stays?.length) {
      // Bookable stays are BOOKABLE — they carry a live rate someone will
      // honour. This used to fall through to generateStays(), so a city Duffel
      // could not answer returned sixteen invented hotels at invented prices.
      //
      // We do hold 16,014 real properties, but they are indexed records with
      // no rate, and putting them here would answer "what can I book tonight
      // for this price" with "here are some buildings". They are served by
      // /api/travel/hotels and the map, which do not promise a bookable rate.
      // `indexedAlternatives` tells the caller how many exist so it can offer
      // that route instead of an empty page.
      const alternatives = searchProperties({ city: body.city ?? "", limit: 1 });
      return NextResponse.json({
        type: "stays",
        city: body.city ?? "",
        nights: n,
        count: 0,
        results: [],
        source: "unavailable",
        unavailableReason: duffelMode() === "live" ? "no_offers" : "no_live_provider",
        indexedAlternatives: alternatives.length > 0,
      });
    }
    if (body.minStars) stays = stays.filter((x) => x.stars >= Number(body.minStars));
    if (body.propertyType) stays = stays.filter((x) => x.type === body.propertyType);
    if (body.maxNightlyUsd) stays = stays.filter((x) => x.nightlyUsd <= Number(body.maxNightlyUsd));
    // ---- Property intelligence ------------------------------------------
    //
    // Runs over the WHOLE result set, not per property: duplicates and price
    // outliers are only visible with the set in hand. A property whose
    // registration the issuing authority contradicts is withheld from sale —
    // that is the only condition that removes inventory, because suppressing
    // on a weaker signal would quietly delist legitimate hosts.
    //
    // Never fails the search. If the assessment throws, every property keeps
    // its place unbadged: a bug in our trust code must not empty a results
    // page.
    let trustById = new Map<string, Awaited<ReturnType<typeof assessResultSet>> extends Map<string, infer V> ? V : never>();
    try {
      trustById = await assessResultSet(
        stays.map((x) => ({
          id: x.id,
          name: x.name,
          city: x.city,
          country: x.country,
          nightlyUsd: x.nightlyUsd,
          stars: x.stars,
          rating: x.rating,
          reviews: x.reviews,
          provider: source,
        }))
      );
    } catch {
      /* unbadged results beat no results */
    }

    const sellable = stays.filter((x) => !trustById.get(x.id)?.suppress);

    // Ranked on quality, value, trust and fit — see lib/travel/ranking.ts.
    //
    // The headline behaviour: ratings are Bayesian-shrunk by review count, so a
    // 5.0 from two reviews cannot outrank a 4.6 from three thousand. A brand-new
    // listing with two friendly reviews is exactly what a fraudulent one looks
    // like, and a raw-average sort promotes it.
    const ranked = rankStays(sellable, {
      preferences: {
        maxNightlyUsd: body.maxNightlyUsd ? Number(body.maxNightlyUsd) : undefined,
        minStars: body.minStars ? Number(body.minStars) : undefined,
      },
      trustWeight: (id) => {
        const trust = trustById.get(id);
        return trust ? rankingWeight(trust) : 1;
      },
    });

    return NextResponse.json({
      type: "stays",
      city: body.city ?? "",
      nights: n,
      count: ranked.length,
      results: ranked.map(({ stay: x, adjustedRating, effectiveNightlyUsd }) => {
        const trust = trustById.get(x.id);
        return {
          ...x,
          /** The rating after shrinking for review count. Differs from
           *  `rating` on purpose, and is what the order was computed from. */
          adjustedRating: Math.round(adjustedRating * 100) / 100,
          /** Per-night cost after cashback — what the traveller actually pays. */
          effectiveNightlyUsd,
          // Only what a traveller should see. The evidence array, the score and
          // the contradiction list stay server-side: a precise percentage
          // beside a price reads as a quality rating, which is not what it is.
          trust: trust?.badge ? { ...trust.badge, checkedAt: trust.checkedAt } : null,
        };
      }),
      source,
      /** How many properties the trust layer withheld. Reported so an empty
       *  page is explainable rather than mysterious. */
      withheld: stays.length - sellable.length,
    });
  }

  if (kind === "flights") {
    const cabin: Flight["cabin"] = (["Economy", "Premium", "Business", "First"] as const).includes(body.cabin as Flight["cabin"])
      ? (body.cabin as Flight["cabin"])
      : "Economy";
    const iata = /^[A-Za-z]{3}$/;
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const from = (body.from ?? "").trim().toUpperCase();
    const to = (body.to ?? "").trim().toUpperCase();
    const departDate = body.date ?? "";
    const returnDate = body.returnDate || undefined;
    if (!iata.test(from) || !iata.test(to) || from === to) {
      return NextResponse.json({ error: "from and to must be two different 3-letter airport codes" }, { status: 400 });
    }
    if (!isoDate.test(departDate) || (returnDate && (!isoDate.test(returnDate) || returnDate < departDate))) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD, and returnDate on or after it" }, { status: 400 });
    }
    const request: FlightSearchRequest = {
      from,
      to,
      departDate,
      returnDate,
      cabin,
      adults: body.adults ?? 1,
      childAges: body.childAges ?? [],
      maxConnections: body.maxStops ?? 1,
    };

    // Offers are cached only until the airlines stop honouring them: the TTL
    // is the earliest `expires_at` in the set minus a minute, capped at ten
    // minutes. A cache that outlived the offers would quote dead prices. The
    // cache is an optimisation only — a KV failure falls through to Duffel.
    const cacheKey = `travel:flights:v2:${createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 32)}`;
    let live: Flight[] | null = null;
    let cached = false;
    try {
      const hit = await kvGet<Flight[]>(cacheKey);
      if (hit?.length && hit.every((f) => !f.expiresAt || Date.parse(f.expiresAt) > Date.now() + 60_000)) {
        live = hit;
        cached = true;
      }
    } catch {
      /* cache unavailable */
    }
    if (!live) {
      live = await searchDuffelFlightOffers(request);
      if (live?.length) {
        const earliest = Math.min(...live.map((f) => (f.expiresAt ? Date.parse(f.expiresAt) : Infinity)));
        const ttl = Math.floor(Math.min(600_000, earliest - Date.now() - 60_000) / 1000);
        if (ttl >= 30) kvSet(cacheKey, live, ttl).catch(() => {});
      }
    }
    if (live?.length) {
      const sort: FlightSort = body.sort ?? "best";
      const ranked = rankFlights(live, sort);
      return NextResponse.json({
        type: "flights",
        count: ranked.length,
        results: ranked,
        highlights: highlights(live),
        sort,
        source: "duffel",
        // Test-mode offers are Duffel's sandbox and must never be shown as a
        // live, bookable price.
        isLiveSearch: duffelMode() === "live",
        cached,
      });
    }
    // No fallback. This used to call generateFlights(), which invented
    // carriers, times and fares from a hash of the route — so a search Duffel
    // could not answer returned a full page of flights that do not exist, at
    // prices nobody quoted, and the only tell was `source: "demo"` in a field
    // the UI does not render.
    return NextResponse.json({
      type: "flights",
      count: 0,
      results: [],
      source: "unavailable",
      unavailableReason: duffelMode() === "live" ? "no_offers" : "no_live_provider",
    });
  }

  if (kind === "cars") {
    const days = nights(body.pickUp ?? body.checkIn, body.dropOff ?? body.checkOut);
    // Live Duffel Cars (40+ brands) when the key is set and the city is a
    // known anchor; demo generator otherwise. Filters apply to both.
    let cars = await searchDuffelCars(body.city ?? "", body.pickUp ?? body.checkIn, body.dropOff ?? body.checkOut);
    if (!cars?.length) {
      // Same as flights: generateCars() minted vehicles and daily rates from a
      // seed. An empty result is the honest answer when the supplier has none.
      return NextResponse.json({
        type: "cars",
        city: body.city ?? "",
        days,
        count: 0,
        results: [],
        source: "unavailable",
        unavailableReason: duffelMode() === "live" ? "no_offers" : "no_live_provider",
      });
    }
    if (body.category) cars = cars.filter((x) => x.category === body.category);
    if (body.maxDailyUsd) cars = cars.filter((x) => x.dailyUsd <= Number(body.maxDailyUsd));
    return NextResponse.json({
      type: "cars",
      city: body.city ?? "",
      days,
      count: cars.length,
      results: cars,
      source: "duffel",
    });
  }

  if (kind === "activities") {
    // There is no activities provider integrated at all — unlike flights,
    // stays and cars, this never had one, so generateActivities() was the ONLY
    // source. Every tour, price and duration on the activities page was
    // invented. Until a real supplier is wired, the honest answer is nothing.
    return NextResponse.json({
      type: "activities",
      city: body.city ?? "",
      count: 0,
      results: [],
      source: "unavailable",
      unavailableReason: "no_provider_integrated",
    });
  }

  return NextResponse.json({ type: kind, results: [], note: "Unknown search type." }, { status: 400 });
}
