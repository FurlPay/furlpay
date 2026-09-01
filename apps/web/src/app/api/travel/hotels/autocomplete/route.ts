import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  autocompletePlaces,
  autocompleteConfigured,
  isLodging,
  resolvePlace,
} from "@/lib/hotels/placesAutocomplete";

export const dynamic = "force-dynamic";

// GET /api/travel/hotels/autocomplete
//
//   ?q=burj al&session=<token>[&lat=&lng=]   -> predictions
//   ?placeId=<id>&session=<token>            -> that place's position
//
// TWO ACTIONS, ONE ROUTE, because they are two halves of one billable session
// and splitting them across files makes it easy to forget that the token has to
// be the same on both. The route enforces that shape: neither action works
// without a session token.
//
// WHY THE KEY IS NOT IN THE BROWSER. Places Autocomplete can be called from the
// client, and a lot of tutorials do exactly that. It requires shipping an API
// key to every visitor, where a referrer restriction is the only thing standing
// between it and someone else's bill. Proxying costs one hop and keeps the key
// server-side, which is the same reason /photo exists.
//
// NOTHING IS STORED. Predictions are Places content and the policy exempts only
// the place ID from its caching restrictions, so this route reads nothing from
// and writes nothing to kv or Postgres. Its responses are also marked
// `no-store`, because a shared cache holding Places content is storage by
// another name.

/** Autocomplete fires per keystroke, so the budget is per-minute generous but
 *  still bounded — one visitor cannot turn a search box into a bill. */
const PREDICT_LIMIT = { limit: 120, windowMs: 60_000 };
/** Resolution happens once per completed search, so it needs far less. */
const RESOLVE_LIMIT = { limit: 40, windowMs: 60_000 };

/** Google's session tokens are UUIDs. Validating the shape keeps an arbitrary
 *  string out of an upstream query parameter. */
const SESSION_RE = /^[0-9a-fA-F-]{8,64}$/;

const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const session = (sp.get("session") ?? "").trim();
  const placeId = (sp.get("placeId") ?? "").trim();

  if (!SESSION_RE.test(session)) {
    return NextResponse.json(
      { error: "A session token is required" },
      { status: 400, headers: NO_STORE }
    );
  }

  // Configuration is checked before rate limiting so an unconfigured deployment
  // answers honestly rather than spending a visitor's budget to say nothing.
  if (!autocompleteConfigured()) {
    // 503, not 500: the search box is unavailable, the map is fine. The client
    // falls back to its local viewport suggestions on this.
    return NextResponse.json(
      { error: "Search is unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }

  // --- resolve a picked prediction -----------------------------------------
  if (placeId) {
    const limited = await rateLimitOr429(req, "travel.hotels.autocomplete.resolve", RESOLVE_LIMIT);
    if (limited) return limited;

    // Place IDs are opaque but bounded; refuse anything that is not one before
    // it reaches a URL.
    if (placeId.length > 512 || !/^[A-Za-z0-9_\-]+$/.test(placeId)) {
      return NextResponse.json({ error: "Invalid place" }, { status: 400, headers: NO_STORE });
    }

    const place = await resolvePlace({ placeId, sessionToken: session });
    if (!place) {
      return NextResponse.json(
        { error: "Could not locate that place" },
        { status: 502, headers: NO_STORE }
      );
    }
    return NextResponse.json({ place }, { headers: NO_STORE });
  }

  // --- predictions ----------------------------------------------------------
  const limited = await rateLimitOr429(req, "travel.hotels.autocomplete", PREDICT_LIMIT);
  if (limited) return limited;

  const q = (sp.get("q") ?? "").slice(0, 200);

  // Bias toward where the map is looking, when the client says. Malformed
  // numbers are dropped rather than rejected — a bad bias is a worse ranking,
  // not a failed search, and failing the whole request over it would be a
  // strictly worse outcome for the reader.
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const near =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ? { latitude: lat, longitude: lng }
      : undefined;

  const suggestions = await autocompletePlaces({ input: q, sessionToken: session, near });

  if (suggestions === null) {
    // Upstream failed. Distinguished from "no matches" so the client can leave
    // its local suggestions on screen instead of rendering an empty list, which
    // would read as "there is no such place".
    return NextResponse.json(
      { error: "Search is temporarily unavailable", suggestions: [] },
      { status: 502, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      // Split here rather than in the component: the caller renders two groups
      // and this is the only place that knows what Google's type vocabulary
      // means.
      properties: suggestions.filter((s) => isLodging(s.types)),
      destinations: suggestions.filter((s) => !isLodging(s.types)),
      // Required wherever Places content is shown without a Google map.
      attribution: "Powered by Google",
    },
    { headers: NO_STORE }
  );
}
