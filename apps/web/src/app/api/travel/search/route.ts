import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { generateStays, generateFlights, nights, StayType, Flight } from "@/lib/travel/data";

// POST /api/travel/search — search travel inventory.
// Body: { type: "stays"|"flights"|"cars"|"activities", city, checkIn, checkOut,
//         maxNightlyUsd?, minStars?, propertyType?, guests? }
// Returns stays today; flights/cars/activities are stubbed for the next phase.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = body.type ?? "stays";

  if (kind === "stays") {
    const stays = generateStays(body.city ?? "", {
      maxNightlyUsd: body.maxNightlyUsd ? Number(body.maxNightlyUsd) : undefined,
      minStars: body.minStars ? Number(body.minStars) : undefined,
      type: body.propertyType as StayType | undefined,
      count: 16,
    });
    const n = nights(body.checkIn, body.checkOut);
    return NextResponse.json({
      type: "stays",
      city: body.city ?? "",
      nights: n,
      count: stays.length,
      results: stays,
      source: "demo",
    });
  }

  if (kind === "flights") {
    const flights: Flight[] = generateFlights(
      body.from ?? "",
      body.to ?? "",
      body.date ?? "",
      (body.cabin as Flight["cabin"]) ?? "Economy",
    );
    return NextResponse.json({ type: "flights", count: flights.length, results: flights, source: "demo" });
  }

  return NextResponse.json({ type: kind, results: [], note: "Coming soon in the next phase.", source: "demo" });
}
