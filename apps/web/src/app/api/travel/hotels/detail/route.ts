import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  findHotel,
  placeDetails,
  googlePlacesConfigured,
  photoProxyUrl,
  GOOGLE_ATTRIBUTION,
  type GooglePlace,
} from "@/lib/hotels/googlePlaces";

export const dynamic = "force-dynamic";

// GET /api/travel/hotels/detail — Google Places content for ONE hotel.
//
// Called when a user opens a hotel, never when the map paints. The map's
// markers come from OSM; this is the panel behind one of them.
//
// NOTHING HERE IS PERSISTED. Google's Places policy allows storing the place ID
// and nothing else, so the response is assembled per request and the route
// tells caches to keep it out of shared storage. `placeId` is the one field a
// caller may durably keep.
//
// The client never sees the API key: photos come back as paths on our own
// /photo proxy, and `attribution` is included so no surface can render this
// content and forget the required credit.

export interface HotelDetailResponse {
  source: "google_places";
  attribution: string;
  place: (Omit<GooglePlace, "photos"> & { photos: { url: string; credit?: string }[] }) | null;
  /** Absent price is a fact about the API, not a failure — Places has no
   *  nightly rates, and saying so stops a caller inferring one from silence. */
  pricing: { available: false; reason: string };
}

export async function GET(req: NextRequest) {
  // Each miss is a billed upstream call at the Enterprise SKU, so this is
  // tighter than an ordinary read endpoint.
  const limited = await rateLimitOr429(req, "travel.hotels.detail", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  // A place ID identifies the property outright, so it is preferred over the
  // name whenever the caller has one. The curated dataset holds 495 of them.
  const placeId = (sp.get("placeId") ?? "").trim();
  const query = (sp.get("q") ?? "").trim();
  if (!placeId && (!query || query.length > 200)) {
    return NextResponse.json(
      { error: "placeId, or q (1-200 chars), is required" },
      { status: 400 }
    );
  }

  if (!googlePlacesConfigured()) {
    return NextResponse.json(
      { error: "Hotel detail is unavailable", detail: "GOOGLE_PLACES_API_KEY is not set" },
      { status: 503 }
    );
  }

  // Optional bias to where OSM says the hotel is. Both or neither — a lone
  // latitude cannot bias anything.
  const latRaw = Number(sp.get("lat"));
  const lngRaw = Number(sp.get("lng"));
  const hasBias =
    Number.isFinite(latRaw) &&
    Number.isFinite(lngRaw) &&
    latRaw >= -90 &&
    latRaw <= 90 &&
    lngRaw >= -180 &&
    lngRaw <= 180;

  // BY ID FIRST, AND FALL BACK RATHER THAN FAIL. Looking up the stored ID is
  // exact and cheaper than a text search, and it is the only thing that works
  // when Google holds the property under a different name than the curated one
  // — the case that produced "No matching place found" for a hotel that was
  // both on the map and in Google.
  //
  // The fallback matters too: a place ID can be retired when a business is
  // merged or relisted, and a dead ID should degrade to a name search rather
  // than to an empty panel.
  const place =
    (placeId ? await placeDetails(placeId) : null) ??
    (query
      ? await findHotel({
          query,
          latitude: hasBias ? latRaw : undefined,
          longitude: hasBias ? lngRaw : undefined,
          detail: true,
        })
      : null);

  const body: HotelDetailResponse = {
    source: "google_places",
    attribution: GOOGLE_ATTRIBUTION,
    place: place
      ? {
          ...place,
          photos: place.photos.slice(0, 8).map((p) => ({
            url: photoProxyUrl(p.name, 800),
            credit: p.authorAttributions?.[0]?.displayName,
          })),
        }
      : null,
    pricing: {
      available: false,
      reason: "Google Places does not expose nightly hotel rates",
    },
  };

  return NextResponse.json(body, {
    // private: a shared cache holding Places content is exactly the stored copy
    // the policy prohibits.
    headers: { "Cache-Control": "private, no-store" },
  });
}
