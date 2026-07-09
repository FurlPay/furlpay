import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { authorizeBooking, BookingSource, MCC } from "@/lib/travel/data";
import { addTrip } from "@/lib/travel/store";
import { mintTicketCnft } from "@/lib/travel/cnft";
import { createDuffelStayQuote, createDuffelStayBooking } from "@/lib/travel/duffel";
import { acquireLock, releaseLock } from "@/lib/locks";
import crypto from "crypto";

// POST /api/travel/book — authorize a booking and record it as a trip.
// Body: { amountUsd, source, mcc?, reference?, name?, city?, image?,
//         checkIn?, checkOut?, nights?, guests?, method? }
//  - travala → x402/USDC on Base + 2% cashback + 10% cbBTC rebate accrual
//  - legacy  → single-use, MCC-locked Visa virtual card
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let amountUsd = Number(body.amountUsd);
  if (!amountUsd || amountUsd <= 0) {
    return NextResponse.json({ error: "amountUsd must be > 0" }, { status: 400 });
  }

  // Distributed mutex: a double-clicked "Confirm" (or two instances racing on
  // the same itinerary) books once. Keyed on the booking's identity.
  const lockName =
    "booking:" +
    crypto
      .createHash("sha256")
      .update(JSON.stringify([body.rateId ?? body.reference ?? body.name, body.city, amountUsd, body.checkIn]))
      .digest("hex")
      .slice(0, 32);
  const lockToken = await acquireLock(lockName, 15);
  if (!lockToken) {
    return NextResponse.json({ error: "duplicate_booking_in_flight" }, { status: 409 });
  }
  try {

  // Live Duffel path: reprice the rate right before money moves (inventory
  // pricing is volatile), then book against the pre-funded Duffel Balance.
  // Any failure falls back to the demo authorization below.
  let duffel: { bookingId: string; reference: string; status: string } | null = null;
  if (typeof body.rateId === "string" && body.rateId) {
    const quote = await createDuffelStayQuote(body.rateId);
    if (quote) {
      // The repriced total is authoritative; reject silent price jumps >5%.
      if (quote.totalAmount > amountUsd * 1.05) {
        return NextResponse.json(
          { error: "price_changed", newAmountUsd: quote.totalAmount },
          { status: 409 }
        );
      }
      amountUsd = quote.totalAmount || amountUsd;
      duffel = await createDuffelStayBooking({
        quoteId: quote.quoteId,
        guest: {
          givenName: String(body.guestGivenName ?? "FurlPay"),
          familyName: String(body.guestFamilyName ?? "Traveler"),
        },
        email: String(body.email ?? "bookings@furlpay.com"),
        phone: typeof body.phone === "string" ? body.phone : undefined,
      });
    }
  }

  const source: BookingSource = body.source === "legacy" ? "legacy" : "travala";
  const authorization = authorizeBooking(amountUsd, source, body.mcc ?? MCC.LODGING);
  const id = "bk_" + Math.random().toString(36).slice(2, 10);

  const trip = addTrip({
    id,
    name: body.name ?? "Your stay",
    city: body.city ?? "—",
    image: body.image ?? "from-sky-500/40 to-indigo-600/40",
    checkIn: body.checkIn ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    checkOut: body.checkOut ?? new Date(Date.now() + 17 * 86_400_000).toISOString().slice(0, 10),
    nights: Number(body.nights) || 3,
    guests: Number(body.guests) || 2,
    amountUsd,
    source,
    method: body.method ?? (source === "travala" ? "USDC · x402 on Base" : `Virtual Visa ••${authorization.card?.last4}`),
    status: "confirmed",
    txHash: authorization.x402 ? "0x" + authorization.x402.proof.replace(/\D/g, "").padEnd(40, "0").slice(0, 40) : undefined,
    cardLast4: authorization.card?.last4,
    cashbackUsd: authorization.cashbackUsd,
    createdAt: new Date().toISOString(),
  });

  // cNFT ticket receipt. Web checkouts have no Solana wallet in-flow, so the
  // voucher mints to the merchant treasury until wallet-linking ships.
  trip.ticket = await mintTicketCnft({
    tripId: trip.id,
    name: `FurlPay Ticket · ${trip.name}`.slice(0, 60),
    owner: process.env.MERCHANT_SOLANA_WALLET || "11111111111111111111111111111111",
    imageUrl: typeof body.image === "string" && body.image.startsWith("http") ? body.image : undefined,
  });

  return NextResponse.json({
    booking: {
      id,
      reference: duffel?.reference ?? body.reference ?? "(unassigned)",
      status: duffel ? duffel.status : "authorized",
      duffelBookingId: duffel?.bookingId,
      amountUsd,
      source,
      authorization,
      trip,
    },
  });
  } finally {
    await releaseLock(lockName, lockToken);
  }
}
