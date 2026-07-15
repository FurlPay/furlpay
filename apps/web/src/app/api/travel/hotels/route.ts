import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { curatedHotels } from "@/lib/travel/discover";
import { generateStays, STAY_INVENTORY_COUNT } from "@/lib/travel/data";
import { searchDuffelStays } from "@/lib/travel/duffel";

// GET /api/travel/hotels — curated 4–5★ hotel collections by destination.
// ?city=<name> returns top-rated hotels for that city instead (live Duffel
// Stays with real property photos when the key is set).
export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");
  if (city) {
    const live = await searchDuffelStays(city);
    if (live?.length) {
      const hotels = live.filter((h) => h.stars >= 4).slice(0, 12);
      if (hotels.length) return NextResponse.json({ city, count: hotels.length, hotels, source: "duffel" });
    }
    const hotels = generateStays(city, { minStars: 4, count: STAY_INVENTORY_COUNT }).sort(
      (a, b) => b.rating - a.rating
    );
    return NextResponse.json({ city, count: hotels.length, hotels, source: "demo" });
  }
  const collections = curatedHotels(3);
  return NextResponse.json({
    count: collections.reduce((n, c) => n + c.hotels.length, 0),
    collections,
    source: "demo",
  });
}
