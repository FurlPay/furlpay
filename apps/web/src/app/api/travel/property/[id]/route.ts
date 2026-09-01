import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { findPropertyById } from "@/lib/travel/propertySource";

// GET /api/travel/property/[id] — one real property from the indexed dataset.
//
// WHAT THIS USED TO DO, AND WHY IT MATTERED. The id was fed to generateStays()
// along with a ?city= parameter, and the "property" was re-derived from a hash
// of that city name. Any id at all resolved, because the generator minted
// inventory on demand — so this endpoint could return a hotel that does not
// exist, with a fabricated rating, review count, star rating and nightly rate,
// and nothing downstream could tell. The booking route then re-derived a price
// from the same seed.
//
// Now the id must exist in the indexed dataset. An unknown id is a 404, which
// is the whole point: a property detail page is where a person decides to
// spend money, and it must not be possible to conjure one.
//
// ?city= is no longer needed — a place id is globally unique — but is accepted
// and ignored so existing links keep working.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "travel.property.id", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const params = await props.params;
  const property = findPropertyById(params.id);

  if (!property) {
    return NextResponse.json({ error: "property_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    property,
    // No room options. deriveRooms() built them by multiplying a fabricated
    // nightly rate, so every "room" was a made-up price with a name attached.
    // Real room inventory comes from a booking provider per search, and we
    // hold no live rate today — production's Duffel credential is a test
    // token, which the pricing layer refuses to serve as real. An empty list
    // is the honest answer; the UI shows the unavailable state.
    rooms: [],
    rate: property.rate,
    rateUnavailableReason: property.rate ? null : "no_live_rate_provider",
    source: property.source,
  });
}
