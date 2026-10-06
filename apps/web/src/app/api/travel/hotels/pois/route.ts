import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { osmPoisNear } from "@/lib/travel/osmPois";

export const dynamic = "force-dynamic";
/** The lookup has its own 8 s budget; this only stops a stuck function. */
export const maxDuration = 15;

// GET /api/travel/hotels/pois?lat=&lng= — named places within ~900 m of a hotel
// (restaurants, cafes, attractions, museums, shopping, stations), from
// OpenStreetMap. Asked only when the reader opens "What's nearby"; never part
// of map load. `status: "unavailable"` means Overpass did not answer inside the
// budget — distinct from `ok` with no places.
//
// Public and read-only. Tighter budget than the map: every miss is a request to
// a volunteer-run Overpass instance.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.hotels.pois", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }
  const result = await osmPoisNear(Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4);
  return NextResponse.json(
    { ...result, source: "OpenStreetMap contributors (ODbL)" },
    { headers: result.status === "ok" ? { "Cache-Control": "public, max-age=3600" } : { "Cache-Control": "no-store" } }
  );
}
