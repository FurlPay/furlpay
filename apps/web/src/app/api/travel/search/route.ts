import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  generateStays,
  generateFlights,
  generateCars,
  generateActivities,
  nights,
  StayType,
  Flight,
  CarCategory,
  ActivityCategory,
} from "@/lib/travel/data";
import { searchDuffelFlights, searchDuffelStays, searchDuffelCars } from "@/lib/travel/duffel";
import { assessResultSet, rankingWeight } from "@/lib/property/intelligence";

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
    const source = stays?.length ? "duffel" : "demo";
    if (!stays?.length) {
      stays = generateStays(body.city ?? "", {
        maxNightlyUsd: body.maxNightlyUsd ? Number(body.maxNightlyUsd) : undefined,
        minStars: body.minStars ? Number(body.minStars) : undefined,
        type: body.propertyType as StayType | undefined,
        count: 16,
      });
    } else {
      if (body.minStars) stays = stays.filter((x) => x.stars >= Number(body.minStars));
      if (body.propertyType) stays = stays.filter((x) => x.type === body.propertyType);
      if (body.maxNightlyUsd) stays = stays.filter((x) => x.nightlyUsd <= Number(body.maxNightlyUsd));
    }
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

    // Trust nudges the order; it does not become the sort key. A cheaper,
    // better-located property must not be buried because its country runs no
    // public register — that would demote everything outside a handful of
    // European jurisdictions.
    const ranked = [...sellable].sort((a, b) => {
      const wa = trustById.get(a.id) ? rankingWeight(trustById.get(a.id)!) : 1;
      const wb = trustById.get(b.id) ? rankingWeight(trustById.get(b.id)!) : 1;
      if (wa !== wb) return wb - wa;
      return 0;
    });

    return NextResponse.json({
      type: "stays",
      city: body.city ?? "",
      nights: n,
      count: ranked.length,
      results: ranked.map((x) => {
        const trust = trustById.get(x.id);
        return {
          ...x,
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
    const cabin = (body.cabin as Flight["cabin"]) ?? "Economy";
    // Live Duffel offers when DUFFEL_API_KEY is set; demo generator otherwise.
    const live = await searchDuffelFlights(body.from ?? "", body.to ?? "", body.date ?? "", cabin);
    if (live?.length) {
      return NextResponse.json({ type: "flights", count: live.length, results: live, source: "duffel" });
    }
    const flights: Flight[] = generateFlights(body.from ?? "", body.to ?? "", body.date ?? "", cabin);
    return NextResponse.json({ type: "flights", count: flights.length, results: flights, source: "demo" });
  }

  if (kind === "cars") {
    const days = nights(body.pickUp ?? body.checkIn, body.dropOff ?? body.checkOut);
    // Live Duffel Cars (40+ brands) when the key is set and the city is a
    // known anchor; demo generator otherwise. Filters apply to both.
    let cars = await searchDuffelCars(body.city ?? "", body.pickUp ?? body.checkIn, body.dropOff ?? body.checkOut);
    const source = cars?.length ? "duffel" : "demo";
    if (!cars?.length) {
      cars = generateCars(body.city ?? "", {
        category: body.category as CarCategory | undefined,
        maxDailyUsd: body.maxDailyUsd ? Number(body.maxDailyUsd) : undefined,
        count: 14,
      });
    } else {
      if (body.category) cars = cars.filter((x) => x.category === body.category);
      if (body.maxDailyUsd) cars = cars.filter((x) => x.dailyUsd <= Number(body.maxDailyUsd));
    }
    return NextResponse.json({ type: "cars", city: body.city ?? "", days, count: cars.length, results: cars, source });
  }

  if (kind === "activities") {
    const activities = generateActivities(body.city ?? "", {
      category: body.category as ActivityCategory | undefined,
      maxPriceUsd: body.maxPriceUsd ? Number(body.maxPriceUsd) : undefined,
    });
    return NextResponse.json({ type: "activities", city: body.city ?? "", count: activities.length, results: activities, source: "demo" });
  }

  return NextResponse.json({ type: kind, results: [], note: "Unknown search type.", source: "demo" }, { status: 400 });
}
