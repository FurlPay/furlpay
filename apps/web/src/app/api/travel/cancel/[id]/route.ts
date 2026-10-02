import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip, updateTrip } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { demoOnlyUnavailable } from "@/lib/demoGate";

// POST /api/travel/cancel/:id — cancel a booking and process the refund.
// Demo: marks cancelled and refunds to the FurlPay balance. A live build applies
// the supplier's cancellation policy and issues an on-chain / VCN refund.
//
// Scoped to the caller — cancelling is destructive and refund-bearing, so a
// booking id belonging to someone else must 404, never cancel.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  // No supplier cancellation and no refund rail exist: this only relabels the
  // trip and tells the user "Refunded …" while no money moves. Refused in
  // production until a real provider cancellation and refund replace it.
  const gate = demoOnlyUnavailable(
    "Travel cancellation",
    "Cancellation is not connected to a travel provider or refund rail yet; nothing would be cancelled or refunded."
  );
  if (gate) return gate;
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
