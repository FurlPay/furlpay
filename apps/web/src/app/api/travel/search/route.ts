import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
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

// POST /api/travel/search — search travel inventory.
// Body: { type: "stays"|"flights"|"cars"|"activities", city, checkIn, checkOut,
//         maxNightlyUsd?, minStars?, propertyType?, guests?, category? }
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

  if (kind === "cars") {
    const cars = generateCars(body.city ?? "", {
      category: body.category as CarCategory | undefined,
      maxDailyUsd: body.maxDailyUsd ? Number(body.maxDailyUsd) : undefined,
      count: 14,
    });
    const days = nights(body.pickUp ?? body.checkIn, body.dropOff ?? body.checkOut);
    return NextResponse.json({ type: "cars", city: body.city ?? "", days, count: cars.length, results: cars, source: "demo" });
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
