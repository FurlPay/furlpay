import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { featuredDeals } from "@/lib/travel/data";

// GET /api/travel/deals — featured flash deals for the travel hub.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.deals", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({ deals: featuredDeals(), source: "demo" });
}
