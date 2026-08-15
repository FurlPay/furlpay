import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { generateRestaurants } from "@/lib/travel/discover";

// GET /api/travel/restaurants?city=<name>&crypto=1 — restaurant discovery with
// crypto-acceptance flags (settle the bill in USDC via a FurlPay VCN).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.restaurants", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const city = req.nextUrl.searchParams.get("city") ?? "";
  let restaurants = generateRestaurants(city, 14);
  if (req.nextUrl.searchParams.get("crypto") === "1") {
    restaurants = restaurants.filter((r) => r.cryptoAccepted);
  }
  return NextResponse.json({ city: city || "Anywhere", count: restaurants.length, restaurants, source: "demo" });
}
