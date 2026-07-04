import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listTrips, tripBucket } from "@/lib/travel/store";

// GET /api/travel/trips — the user's trips, grouped upcoming / past / cancelled.
export async function GET() {
  const all = listTrips();
  return NextResponse.json({
    upcoming: all.filter((t) => tripBucket(t) === "upcoming"),
    past: all.filter((t) => tripBucket(t) === "past"),
    cancelled: all.filter((t) => tripBucket(t) === "cancelled"),
  });
}
