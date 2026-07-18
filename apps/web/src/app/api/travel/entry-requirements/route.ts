import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { entryRequirements } from "@/lib/travel/entryRequirements";

// POST /api/travel/entry-requirements — indicative visa + passport-validity check
// for a nationality → destination trip. Read-only (no state), but the passport
// expiry it accepts is mild PII, so it's a POST body rather than a query string.
//
// Public route → rate limited (rule 2). Body validated with Zod (rule 1).

const Body = z
  .object({
    // Accept ISO-2, a country name, or (for destination) an IATA code — the
    // engine resolves all three. Kept permissive here; resolution owns validity.
    nationality: z.string().min(2).max(40),
    destination: z.string().min(2).max(40),
    passportExpiry: z.string().max(20).optional(), // YYYY-MM-DD
    departureDate: z.string().max(20).optional(),
    returnDate: z.string().max(20).optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.entryRequirements", { limit: 40, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const result = entryRequirements(body);
  if (!result) {
    return NextResponse.json(
      {
        error: "unresolved_country",
        detail:
          "Couldn't resolve nationality or destination to a known country. Use an ISO-2 code (e.g. US, IN), a country name, or an IATA airport code for the destination.",
      },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}
