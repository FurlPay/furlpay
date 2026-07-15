import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { generateStays, deriveRooms } from "@/lib/travel/data";

// GET /api/travel/property/[id]?city=<city> — full property details.
// Inventory is generated deterministically per city, so the city that produced
// the id must be supplied to re-derive the same property.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const city = req.nextUrl.searchParams.get("city") ?? "";
  const stay = generateStays(city, { count: 16 }).find((s) => s.id === params.id);
  if (!stay) {
    return NextResponse.json(
      { error: "Property not found — pass the ?city= used in the original search." },
      { status: 404 },
    );
  }

  // Room options derived from the base rate. deriveRooms() is the SAME helper
  // the booking route uses to re-price at book time, so the rate shown here is
  // exactly the rate the server will charge — no client total is trusted.
  const rooms = deriveRooms(stay);

  return NextResponse.json({ property: stay, rooms, cashbackPct: 2, rateLockMinutes: 15, source: "demo" });
}
