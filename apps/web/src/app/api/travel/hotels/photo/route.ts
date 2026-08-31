import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { resolvePhotoUri, googlePlacesConfigured } from "@/lib/hotels/googlePlaces";

export const dynamic = "force-dynamic";

// GET /api/travel/hotels/photo?name=places/{id}/photos/{ref}&w=800
//
// WHY A PROXY AND NOT A DIRECT LINK. Google's photo media endpoint takes the
// API key as a QUERY PARAMETER. Putting that URL in an <img src> would ship the
// key to every visitor, where it can be lifted from devtools and spent against
// the account. So the browser asks us, and we hold the key.
//
// The bytes are streamed from Google's CDN rather than buffered here: a hotel
// photo is ~200KB and buffering would put every image through this process's
// heap for no benefit.

/** Google documents 1-4800 for maxWidthPx. */
const MAX_WIDTH = 4800;
const DEFAULT_WIDTH = 800;

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.hotels.photo", {
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!googlePlacesConfigured()) {
    return NextResponse.json({ error: "Photos unavailable" }, { status: 503 });
  }

  const name = req.nextUrl.searchParams.get("name") ?? "";
  // Shape-check before the value reaches a URL. resolvePhotoUri re-validates —
  // this is the cheap rejection, that is the authoritative one.
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid photo name" }, { status: 400 });
  }

  const wRaw = Number(req.nextUrl.searchParams.get("w"));
  const width = Number.isFinite(wRaw)
    ? Math.min(MAX_WIDTH, Math.max(1, Math.round(wRaw)))
    : DEFAULT_WIDTH;

  const uri = await resolvePhotoUri(name, width);
  if (!uri) return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });

  const upstream = await fetch(uri, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Photo unavailable" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  // Only ever hand back an image. Without this the route would relay whatever
  // the upstream returned, content type included.
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Unexpected content type" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      // Photo names expire and Places content may not be stored, so this must
      // not sit in a shared cache. A short private TTL keeps a detail panel from
      // re-fetching the same image while the user reads it, and no longer.
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
