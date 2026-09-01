import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
// GET /api/travel/deals — featured flash deals for the travel hub.
//
// A deal is a claim about money: this price, down from that one, for a limited
// time. featuredDeals() invented all three — the property, the rate and the
// discount — so every "42% off" was a number with nothing behind it. That is
// the most dangerous shape of fabrication in the product, because a struck-out
// price is a comparison a person acts on.
//
// A real deal needs a live rate to discount FROM and a live rate to discount
// TO. Production's Duffel credential is a test token, so we have neither, and
// there is no honest deal to show. The hub renders its empty state.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.deals", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({
    deals: [],
    source: "unavailable",
    unavailableReason: "no_live_rate_provider",
  });
}
