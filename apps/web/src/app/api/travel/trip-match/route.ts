import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { matchTrips } from "@/lib/travel/tripmatch";

const TripMatchSchema = z.object({ query: z.string().trim().min(3, "query must be at least 3 characters").max(2000) });

// POST /api/travel/trip-match — natural-language destination search.
// Body: { query: string } → parsed signals + ranked destination matches.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.trip.match", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // Zod + validateBody: the 100KB body cap applies to this public route too
  // (req.json() read any size before the length check ran).
  const body = await validateBody(req, TripMatchSchema);
  if (body instanceof NextResponse) return body;
  const { signals, matches } = matchTrips(body.query.slice(0, 300));
  // Deterministic keyword match over the curated destination catalogue (no
  // LLM, no live rates): labelled as such rather than as "demo".
  return NextResponse.json({ signals, matches, source: "catalogue" });
}
