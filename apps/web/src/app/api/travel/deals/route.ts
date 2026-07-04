import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { featuredDeals } from "@/lib/travel/data";

// GET /api/travel/deals — featured flash deals for the travel hub.
export async function GET() {
  return NextResponse.json({ deals: featuredDeals(), source: "demo" });
}
