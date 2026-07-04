import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { curatedHotels } from "@/lib/travel/discover";
import { generateStays } from "@/lib/travel/data";

// GET /api/travel/hotels — curated 4–5★ hotel collections by destination.
// ?city=<name> returns top-rated hotels for that city instead.
export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");
  if (city) {
    const hotels = generateStays(city, { minStars: 4, count: 12 }).sort((a, b) => b.rating - a.rating);
    return NextResponse.json({ city, count: hotels.length, hotels, source: "demo" });
  }
  const collections = curatedHotels(3);
  return NextResponse.json({
    count: collections.reduce((n, c) => n + c.hotels.length, 0),
    collections,
    source: "demo",
  });
}
