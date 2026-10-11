import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { searchAirportIndex } from "@/lib/travel/airportSearch";

export const dynamic = "force-dynamic";

// GET /api/travel/airports?q=lon — airport autocomplete over the OurAirports
// index (lib/travel/airportSearch.ts). Public and read-only; rate-limited per
// AGENTS rule 2 at a budget that covers typing (one request per keystroke,
// debounced client-side).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.airports", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 8) || 8;
  return NextResponse.json(
    { airports: searchAirportIndex(q, limit) },
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
  );
}
