import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { ITINERARIES, getItinerary } from "@/lib/travel/discover";
import { CASHBACK_RATE } from "@/lib/travel/data";

// GET /api/travel/itineraries — bookable day-by-day itineraries.
// ?slug=<slug> returns the full plan for one itinerary.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (slug) {
    const itinerary = getItinerary(slug);
    if (!itinerary) return NextResponse.json({ error: "Unknown itinerary." }, { status: 404 });
    return NextResponse.json({
      itinerary,
      estCashbackUsdc: Math.round(itinerary.budgetUsd * CASHBACK_RATE * 100) / 100,
      bookUrl: `/travel/stays?city=${encodeURIComponent(itinerary.city)}`,
    });
  }
  return NextResponse.json({
    count: ITINERARIES.length,
    itineraries: ITINERARIES.map(({ plan, ...rest }) => ({
      ...rest,
      stops: plan.reduce((n, d) => n + d.items.length, 0),
      estCashbackUsdc: Math.round(rest.budgetUsd * CASHBACK_RATE * 100) / 100,
    })),
  });
}
