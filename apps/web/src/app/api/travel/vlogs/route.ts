import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { VLOGS } from "@/lib/travel/discover";

// GET /api/travel/vlogs?city=<name> — curated travel video picks, each with a
// bookable destination link (video → booking, the 2026 conversion pattern).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.vlogs", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const city = req.nextUrl.searchParams.get("city")?.toLowerCase();
  const vlogs = city ? VLOGS.filter((v) => v.city.toLowerCase() === city) : VLOGS;
  return NextResponse.json({
    count: vlogs.length,
    vlogs: vlogs.map((v) => ({ ...v, bookUrl: `/travel/destinations/${v.destinationSlug}` })),
  });
}
