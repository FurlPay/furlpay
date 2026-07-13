import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listTrips, tripBucket } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";

// GET /api/travel/trips — the caller's trips, grouped upcoming / past / cancelled.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const all = listTrips(auth.account.user.id);
  return NextResponse.json({
    upcoming: all.filter((t) => tripBucket(t) === "upcoming"),
    past: all.filter((t) => tripBucket(t) === "past"),
    cancelled: all.filter((t) => tripBucket(t) === "cancelled"),
  });
}
