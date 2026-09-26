import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { GOOGLE_ATTRIBUTION } from "@/lib/hotels/googlePlaces";
import {
  MAX_DISCOVERY_SPAN,
  MAX_RESULTS,
  dedupeByPlaceId,
  discoverInViewport,
  isValidViewport,
  placesConfigured,
  viewportSpan,
} from "@/lib/places/viewportDiscovery";

// ---------------------------------------------------------------------------
// POST /api/places/discover
//
// Viewport-aware discovery for the map. The browser sends the bounds it is
// currently showing; this answers with the places inside them.
//
// SERVER-SIDE ON PURPOSE
// ======================
// GOOGLE_PLACES_API_KEY never reaches the browser. The Maps JavaScript API
// needs a *separate*, referrer-restricted public key to draw the map; this
// key is API-restricted to Places and stays here. Shipping one key that does
// both would put a server credential in client source.
//
// It also means field masks — which decide the billing SKU — are chosen by us
// rather than by whatever the client asks for.
// ---------------------------------------------------------------------------

const Bounds = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
});

const Body = z.object({
  viewport: Bounds,
  kinds: z.array(z.enum(["hotels", "restaurants"])).min(1).max(2).default(["hotels"]),
  /** Free-text narrowing from the "Name contains" field. */
  query: z.string().trim().max(120).optional(),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).optional(),
});

export async function POST(req: NextRequest) {
  // Each call is a billed Places request, so this is tighter than the
  // middleware baseline. The client also debounces on map idle.
  const limited = await rateLimitOr429(req, "places.discover", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  if (!placesConfigured()) {
    // A configuration failure, reported as one. The map renders an explicit
    // state rather than an empty result that looks like "no hotels here".
    return NextResponse.json(
      {
        error: "places_not_configured",
        message: "Place discovery is unavailable: GOOGLE_PLACES_API_KEY is not set.",
      },
      { status: 503 }
    );
  }

  const { viewport, query, maxResults } = body;
  const kinds = body.kinds ?? (["hotels"] as const);

  if (!isValidViewport(viewport)) {
    return NextResponse.json({ error: "invalid_viewport" }, { status: 400 });
  }
  if (viewportSpan(viewport) > MAX_DISCOVERY_SPAN) {
    // Refused rather than answered badly. At continental zoom the API would
    // return ~20 essentially arbitrary places, which the map would draw as
    // though they were the hotels in that area.
    return NextResponse.json(
      {
        error: "viewport_too_large",
        message: "Zoom in to search this area.",
        maxSpanSqDeg: MAX_DISCOVERY_SPAN,
      },
      { status: 422 }
    );
  }

  const results = await Promise.all(
    kinds.map(async (kind) => {
      const r = await discoverInViewport({ viewport, kind, query, maxResults, signal: req.signal });
      return [kind, r] as const;
    })
  );

  const payload: Record<string, unknown> = {
    // Required wherever Places content is shown. Do not strip.
    attribution: GOOGLE_ATTRIBUTION,
  };
  let anyFailed = false;

  for (const [kind, r] of results) {
    if (r === null) {
      anyFailed = true;
      // null means "could not ask", which is NOT the same as "none here".
      payload[kind] = { places: [], unavailable: true, truncated: false };
      continue;
    }
    payload[kind] = {
      places: dedupeByPlaceId(r.places),
      unavailable: false,
      truncated: r.truncated,
    };
  }

  payload.degraded = anyFailed;
  return NextResponse.json(payload, {
    // Places content must not be cached beyond Google's policy window.
    headers: { "Cache-Control": "private, max-age=0, no-store" },
  });
}
