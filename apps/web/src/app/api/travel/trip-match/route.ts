import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { matchTrips } from "@/lib/travel/tripmatch";

// POST /api/travel/trip-match — natural-language destination search.
// Body: { query: string } → parsed signals + ranked destination matches.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.trip.match", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = String(body?.query ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json({ error: "query must be at least 3 characters" }, { status: 400 });
  }
  const { signals, matches } = matchTrips(query.slice(0, 300));
  return NextResponse.json({ signals, matches, source: "demo" });
}
