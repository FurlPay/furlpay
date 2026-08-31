import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  placeDetails,
  googlePlacesConfigured,
  photoProxyUrl,
  GOOGLE_ATTRIBUTION,
} from "@/lib/hotels/googlePlaces";

export const dynamic = "force-dynamic";

// GET /api/travel/hotels/preview?placeIds=a,b,c — imagery for a hover card.
//
// WHY A SEPARATE ROUTE FROM /detail. The hover card shows a hero image and up
// to three property thumbnails, which is four places at once. Asking /detail
// four times would burn four requests against a budget sized for ONE hotel a
// user opened deliberately, and a few seconds of hovering would 429 the map.
// One request, one budget, one round trip.
//
// LOOKED UP BY PLACE ID, NEVER SEARCHED. Every id here came from the resolver,
// which already established what these properties are. A text search would
// re-litigate that at a higher SKU and could return a different building.
//
// NOTHING IS STORED. Same policy as /detail: place IDs are durable, everything
// Google returns here is not. Photo resource names expire, so they are proxied
// per request rather than kept, and the response is marked private/no-store.
// The client holds them in memory for the session, which is display, not
// storage — a reload re-fetches.

/** Four is the card: one hero and three thumbnails. */
const MAX_PLACES = 4;

export interface PreviewPlace {
  placeId: string;
  name: string;
  /** Google's own rating. Absent when Google has none — never defaulted to a
   *  number, because a missing rating is not a bad one. */
  rating?: number;
  userRatingCount?: number;
  /** Proxied so the API key never reaches the browser. */
  photoUrl?: string;
  photoCredit?: string;
  editorialSummary?: string;
}

export interface PreviewResponse {
  places: PreviewPlace[];
  /** Ids we asked about and got nothing for, so the client can render a real
   *  gap rather than waiting forever on an image that is not coming. */
  missing: string[];
  attribution: string;
  configured: boolean;
}

export async function GET(req: NextRequest) {
  // Hover-driven, so tighter than an ordinary read route but loose enough that
  // moving across a dense map does not lock the user out of their own UI.
  const limited = await rateLimitOr429(req, "travel.hotels.preview", {
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const raw = (req.nextUrl.searchParams.get("placeIds") ?? "").trim();
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    // Validate before use: these reach a URL path inside placeDetails().
    .filter((s) => /^[A-Za-z0-9_-]{1,255}$/.test(s))
    .slice(0, MAX_PLACES);

  if (!ids.length) {
    return NextResponse.json({ error: "placeIds is required" }, { status: 400 });
  }

  if (!googlePlacesConfigured()) {
    // Not an error. The map is fully usable without imagery, and the card needs
    // to say "no photos configured" rather than spin.
    const body: PreviewResponse = {
      places: [],
      missing: ids,
      attribution: GOOGLE_ATTRIBUTION,
      configured: false,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  }

  const results = await Promise.all(ids.map((id) => placeDetails(id)));

  const places: PreviewPlace[] = [];
  const missing: string[] = [];

  results.forEach((place, i) => {
    if (!place) {
      missing.push(ids[i]);
      return;
    }
    const photo = place.photos[0];
    places.push({
      placeId: place.placeId,
      name: place.name,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      photoUrl: photo ? photoProxyUrl(photo.name, 640) : undefined,
      photoCredit: photo?.authorAttributions?.[0]?.displayName,
      editorialSummary: place.editorialSummary,
    });
  });

  const body: PreviewResponse = {
    places,
    missing,
    attribution: GOOGLE_ATTRIBUTION,
    configured: true,
  };

  return NextResponse.json(body, {
    // A shared cache holding Places content is the stored copy the policy
    // prohibits.
    headers: { "Cache-Control": "private, no-store" },
  });
}
