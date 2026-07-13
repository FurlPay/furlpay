import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip, updateTrip } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";
import { audit } from "@/lib/audit";

// POST /api/travel/cancel/:id — cancel a booking and process the refund.
// Demo: marks cancelled and refunds to the FurlPay balance. A live build applies
// the supplier's cancellation policy and issues an on-chain / VCN refund.
//
// Scoped to the caller — cancelling is destructive and refund-bearing, so a
// booking id belonging to someone else must 404, never cancel.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const trip = getTrip(params.id, userId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.status === "cancelled") {
    return NextResponse.json({ error: "Trip already cancelled" }, { status: 400 });
  }
  const refundStatus =
    trip.source === "travala" ? "Refunded in USDC to your wallet" : "Refunded to FurlPay balance";
  const updated = updateTrip(params.id, userId, { status: "cancelled", refundStatus });
  audit("travel.cancelled", userId, { tripId: params.id, amountUsd: trip.amountUsd });
  return NextResponse.json({ cancelled: true, refundStatus, trip: updated });
}
