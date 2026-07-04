import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { generateStays, toToken } from "@/lib/travel/data";

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

  // Room options derived from the base rate.
  const rooms = [
    { name: "Standard Room", multiplier: 1, cancellable: stay.freeCancellation },
    { name: "Deluxe King Room", multiplier: 1.25, cancellable: true },
    { name: `${stay.type === "Resort" ? "Ocean" : "City"} View Suite`, multiplier: 1.7, cancellable: true },
  ].map((r) => {
    const nightlyUsd = Math.round(stay.nightlyUsd * r.multiplier * 100) / 100;
    return { ...r, nightlyUsd, nightlyUsdc: nightlyUsd, nightlySol: toToken(nightlyUsd, "SOL") };
  });

  return NextResponse.json({ property: stay, rooms, cashbackPct: 2, rateLockMinutes: 15, source: "demo" });
}
