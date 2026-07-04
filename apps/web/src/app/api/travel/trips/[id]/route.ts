import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip } from "@/lib/travel/store";

// GET /api/travel/trips/:id — a single trip's details (powers booking/[id]).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const trip = getTrip(params.id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ trip });
}
