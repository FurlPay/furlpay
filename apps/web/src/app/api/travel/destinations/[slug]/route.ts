import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getDestination, generateStays, generateFlights, generateActivities } from "@/lib/travel/data";

// GET /api/travel/destinations/[slug] — destination details plus curated
// top stays, flights and activities for the destination page.
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const destination = getDestination(params.slug);
  if (!destination) {
    return NextResponse.json({ error: "Unknown destination." }, { status: 404 });
  }
  return NextResponse.json({
    destination,
    topStays: generateStays(destination.name, { count: 6, minStars: 4 }).slice(0, 3),
    topFlights: generateFlights("LHR", destination.name.slice(0, 3), "").slice(0, 3),
    topActivities: generateActivities(destination.name).slice(0, 3),
    source: "demo",
  });
}
