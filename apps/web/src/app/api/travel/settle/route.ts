import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip, updateTrip } from "@/lib/travel/store";

// POST /api/travel/settle — verify on-chain payment (x402 proof) and confirm the
// trip. Demo: accepts any proof and marks the trip confirmed. A live build calls
// the FurlPay x402 facilitator /verify + /settle.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.bookingId ?? body.tripId ?? "");
  const trip = getTrip(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const settled = updateTrip(id, { status: "confirmed" });
  return NextResponse.json({ verified: true, settled: true, trip: settled });
}
