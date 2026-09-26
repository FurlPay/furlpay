import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sbRpc, supabaseBackend, SupabaseFunctionMissing } from "@/lib/supabase";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/travel/hotels/tiles/:z/:x/:y — Mapbox Vector Tiles from PostGIS.
//
// Replaces the GeoJSON path (/api/travel/hotels/map), which serialises points
// as JSON and caps at RENDER_BUDGET = 400 — enough for a neighbourhood and
// useless for a city. A binary MVT carries thousands of points in a fraction
// of the bytes, and MapLibre uploads it straight to GPU vertex buffers.
//
// HOW THE BINARY GETS HERE
// ST_AsMVT returns bytea, and this deployment reaches Postgres only through
// PostgREST — there is no pg pool in this repo, so the blueprint's
// `getDbPool()` does not exist. Migration 0015 defines hotels_mvt(z,x,y) which
// base64-encodes the tile inside Postgres; this route decodes it once and
// serves the bytes.
//
// PUBLIC AND UNAUTHENTICATED, deliberately: a tile is map furniture, the same
// for every viewer, and requiring a session would make the map unusable before
// login. So it is rate limited (AGENTS.md rule 2) and the SQL function exposes
// only display columns — never direct_booking_url, which is commercial data.
// ---------------------------------------------------------------------------

/** Web Mercator tops out here; beyond ~18 there is nothing left to resolve. */
const MAX_ZOOM = 20;

const TILE_HEADERS: Record<string, string> = {
  "Content-Type": "application/vnd.mapbox-vector-tile",
  // Tiles are a pure function of (z,x,y) and the registry, which changes on an
  // ingest cadence measured in days. A long edge cache with a revalidation
  // window is exactly right; a short one would re-hit Postgres for bytes that
  // did not change.
  "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
};

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const limited = await rateLimitOr429(request, "hotel.tiles", { limit: 300, windowMs: 60_000 });
  if (limited) return limited;

  const { z: rawZ, x: rawX, y: rawY } = await props.params;

  const z = Number(rawZ);
  const x = Number(rawX);
  const y = Number(rawY);

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return NextResponse.json({ error: "invalid_tile", detail: "z, x and y must be integers." }, { status: 400 });
  }
  if (z < 0 || z > MAX_ZOOM) {
    return NextResponse.json({ error: "invalid_tile", detail: `z must be between 0 and ${MAX_ZOOM}.` }, { status: 400 });
  }

  // x and y must lie inside the tile grid FOR THIS ZOOM — there are 2^z tiles
  // per axis. The blueprint checks only that they parse, which lets
  // /tiles/2/999999/999999 through: ST_TileEnvelope happily computes an
  // envelope somewhere off the map and Postgres does a pointless index scan
  // for every such request. That is a free amplification primitive, so the
  // bound is enforced before any query runs.
  const axisLimit = 2 ** z;
  if (x < 0 || x >= axisLimit || y < 0 || y >= axisLimit) {
    return NextResponse.json(
      { error: "invalid_tile", detail: `x and y must be between 0 and ${axisLimit - 1} at z=${z}.` },
      { status: 400 }
    );
  }

  if (supabaseBackend !== "supabase") {
    // No database on this deployment. An empty tile would render as "there are
    // no hotels anywhere", which is a claim; 503 is the honest answer.
    return NextResponse.json(
      { error: "service_unavailable", detail: "Hotel tiles require the Supabase backend." },
      { status: 503 }
    );
  }

  try {
    const base64 = await sbRpc<string>("hotels_mvt", { z, x, y });

    // Empty string = the tile is genuinely empty (the SQL coalesces NULL away).
    if (!base64) return new NextResponse(null, { status: 204, headers: TILE_HEADERS });

    const buf = Buffer.from(base64, "base64");
    if (buf.length === 0) return new NextResponse(null, { status: 204, headers: TILE_HEADERS });

    return new NextResponse(new Uint8Array(buf), { status: 200, headers: TILE_HEADERS });
  } catch (e) {
    if (e instanceof SupabaseFunctionMissing) {
      // Migration 0015 has not been applied. Distinct from an empty tile and
      // from a query failure — an operator reading this knows exactly what to
      // run, instead of wondering why the map is blank.
      log.error("hotels_mvt is missing — migration 0015 not applied", { z, x, y });
      return NextResponse.json(
        { error: "service_unavailable", detail: "Hotel tile function is not installed on this database." },
        { status: 503 }
      );
    }
    log.error("hotel tile generation failed", { z, x, y, error: (e as Error).message });
    return NextResponse.json({ error: "tile_failed" }, { status: 500 });
  }
}
