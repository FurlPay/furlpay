import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { DESTINATION_CATEGORIES, DESTINATIONS, destinationsByCategory } from "@/lib/travel/data";

// GET /api/travel/destinations — destination categories + curated destinations.
// Optional ?category=<slug> filters destinations to one category.
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  const destinations = category ? destinationsByCategory(category) : DESTINATIONS;
  return NextResponse.json({ categories: DESTINATION_CATEGORIES, destinations });
}
