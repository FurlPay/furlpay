import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { priceOsmHotel, type HotelPrice, type HotelSearchContext } from "@/lib/hotels/pricing";
import { duffelMode } from "@/lib/travel/duffel";

export const dynamic = "force-dynamic";

// POST /api/travel/hotels/price — the rate for ONE hotel the user pointed at.
//
// WHY PER-HOTEL AND NOT PER-VIEWPORT: a viewport holds thousands of hotels and
// a user looks at a handful. Pricing the viewport would be thousands of upstream
// calls to render information nobody asked for. The map draws instantly from
// OSM; this route is what a hover costs.
//
// The response is a STATE, never a bare number. "no rate available" and "we
// haven't looked yet" are different facts and the UI has to be able to say so
// without either becoming a price.

/** Bounded so a caller cannot ask for a 2-year stay or 500 rooms. Duffel
 *  documents check-in up to 330 days out and stays up to 99 nights. */
const ContextSchema = z.object({
  osmId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  city: z.string().max(120).optional(),
  countryCode: z.string().max(2).optional(),
  brand: z.string().max(120).optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(9),
  children: z.array(z.number().int().min(0).max(17)).max(9).optional(),
  rooms: z.number().int().min(1).max(9),
  currency: z.string().length(3).optional(),
});

export interface HotelPriceResponse extends HotelPrice {
  osmId: string;
  /** Surfaced so the client cannot be the thing that decides whether a price is
   *  live. The server owns this. */
  duffelMode: "test" | "live" | "unknown";
}

const MAX_STAY_NIGHTS = 99;
const MAX_CHECKIN_DAYS_AHEAD = 330;
const DAY_MS = 86_400_000;

export async function POST(req: NextRequest) {
  // A hover-driven endpoint is the easiest thing on the map to abuse, and every
  // miss costs an upstream call, so the budget is tight.
  const limited = await rateLimitOr429(req, "travel.hotels.price", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const parsed = await validateBody(req, ContextSchema);
  if (parsed instanceof NextResponse) return parsed;

  // Date sanity beyond the regex: a well-formed date can still be nonsense.
  const inMs = Date.parse(`${parsed.checkIn}T00:00:00Z`);
  const outMs = Date.parse(`${parsed.checkOut}T00:00:00Z`);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  const nights = Math.round((outMs - inMs) / DAY_MS);
  if (nights < 1 || nights > MAX_STAY_NIGHTS) {
    return NextResponse.json(
      { error: `Stay must be between 1 and ${MAX_STAY_NIGHTS} nights` },
      { status: 400 }
    );
  }
  const daysAhead = Math.round((inMs - Date.now()) / DAY_MS);
  if (daysAhead > MAX_CHECKIN_DAYS_AHEAD) {
    return NextResponse.json(
      { error: `Check-in must be within ${MAX_CHECKIN_DAYS_AHEAD} days` },
      { status: 400 }
    );
  }

  const ctx: HotelSearchContext = {
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    adults: parsed.adults,
    children: parsed.children ?? [],
    rooms: parsed.rooms,
    currency: parsed.currency,
  };

  const price = await priceOsmHotel(
    {
      id: parsed.osmId,
      name: parsed.name,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      city: parsed.city,
      countryCode: parsed.countryCode,
      brand: parsed.brand,
    },
    ctx
  );

  const body: HotelPriceResponse = { ...price, osmId: parsed.osmId, duffelMode: duffelMode() };
  return NextResponse.json(body);
}
