import { NextRequest, NextResponse } from "next/server";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { getDestination, generateStays, generateFlights, generateActivities } from "@/lib/travel/data";

// GET /api/travel/destinations/[slug] — destination details plus curated
// top stays, flights and activities for the destination page.
export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const limited = await rateLimitOr429(req, "travel.destinations.slug", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const params = await props.params;
  const destination = getDestination(params.slug);
  if (!destination) {
    return NextResponse.json({ error: "Unknown destination." }, { status: 404 });
  }
  // The destination itself is curated catalogue content. The stays, flights
  // and activities below are GENERATED (invented prices): production omits them.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({
      destination,
      topStays: [],
      topFlights: [],
      topActivities: [],
      listings: "unavailable",
      listingsReason: "No live rates are held for destination pages; search uses the real providers.",
    });
  }
  return NextResponse.json({
    destination,
    topStays: generateStays(destination.name, { count: 6, minStars: 4 }).slice(0, 3),
    topFlights: generateFlights("LHR", destination.name.slice(0, 3), "").slice(0, 3),
    topActivities: generateActivities(destination.name).slice(0, 3),
    source: "demo",
  });
}
