import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { curatedHotels } from "@/lib/travel/discover";
import { searchProperties, isKnownCity } from "@/lib/travel/propertySource";
import { searchDuffelStays } from "@/lib/travel/duffel";
import { datasetStats } from "@/lib/hotels/googlePlacesLayer";

// GET /api/travel/hotels — curated 4–5★ hotel collections by destination.
// ?city=<name> returns top-rated hotels for that city instead (live Duffel
// Stays with real property photos when the key is set).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.hotels", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const city = req.nextUrl.searchParams.get("city");
  if (city) {
    const live = await searchDuffelStays(city);
    if (live?.length) {
      const hotels = live.filter((h) => h.stars >= 4).slice(0, 12);
      if (hotels.length) return NextResponse.json({ city, count: hotels.length, hotels, source: "duffel" });
    }
    // Duffel had nothing (or is not configured). Fall back to the INDEXED
    // dataset, not to invention: this used to call generateStays(city), which
    // meant a city we have never indexed still returned a full page of hotels
    // with plausible names, ratings and nightly rates.
    //
    // searchProperties returns [] for a city we hold no coordinate for, and []
    // for a city we can place but have not indexed. Both are honest, and the
    // UI is expected to show an empty state rather than a populated one.
    const hotels = searchProperties({ city, minRating: 4, limit: 24 });
    return NextResponse.json({
      city,
      count: hotels.length,
      hotels,
      // Distinguishes "we looked and there is nothing" from "we do not know
      // where that is", which a bare empty array cannot express.
      known: isKnownCity(city),
      // The Google Places snapshot may only be served inside its cache window
      // and serves nothing after it. Without this, an expired snapshot reads as
      // "no hotels in this city", which is false. Same signal as /hotels/map.
      googleDataset: datasetStats(),
      source: "indexed_dataset",
    });
  }
  const collections = curatedHotels(3);
  return NextResponse.json({
    count: collections.reduce((n, c) => n + c.hotels.length, 0),
    collections,
    source: "indexed_dataset",
  });
}
