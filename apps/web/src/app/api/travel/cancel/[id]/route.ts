import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip, updateTrip } from "@/lib/travel/store";

// POST /api/travel/cancel/:id — cancel a booking and process the refund.
// Demo: marks cancelled and refunds to the FurlPay balance. A live build applies
// the supplier's cancellation policy and issues an on-chain / VCN refund.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const trip = getTrip(params.id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.status === "cancelled") {
    return NextResponse.json({ error: "Trip already cancelled" }, { status: 400 });
  }
  const refundStatus =
    trip.source === "travala" ? "Refunded in USDC to your wallet" : "Refunded to FurlPay balance";
  const updated = updateTrip(params.id, { status: "cancelled", refundStatus });
  return NextResponse.json({ cancelled: true, refundStatus, trip: updated });
}
