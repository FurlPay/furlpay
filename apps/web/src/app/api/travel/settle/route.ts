import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip, updateTrip } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";

// POST /api/travel/settle — verify on-chain payment (x402 proof) and confirm the
// trip. Demo: accepts any proof and marks the trip confirmed. A live build calls
// the FurlPay x402 facilitator /verify + /settle.
//
// Scoped to the caller: settling flips a booking to confirmed, so an id that
// isn't theirs must 404 rather than settle someone else's trip.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const body = await req.json().catch(() => ({}));
  const id = String(body.bookingId ?? body.tripId ?? "");
  const trip = getTrip(id, userId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const settled = updateTrip(id, userId, { status: "confirmed" });
  return NextResponse.json({ verified: true, settled: true, trip: settled });
}
