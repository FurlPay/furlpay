import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { authorizeBooking, BookingSource, MCC } from "@/lib/travel/data";
import { addTrip } from "@/lib/travel/store";

// POST /api/travel/book — authorize a booking and record it as a trip.
// Body: { amountUsd, source, mcc?, reference?, name?, city?, image?,
//         checkIn?, checkOut?, nights?, guests?, method? }
//  - travala → x402/USDC on Base + 2% cashback + 10% cbBTC rebate accrual
//  - legacy  → single-use, MCC-locked Visa virtual card
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body.amountUsd);
  if (!amountUsd || amountUsd <= 0) {
    return NextResponse.json({ error: "amountUsd must be > 0" }, { status: 400 });
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

  return NextResponse.json({
    booking: { id, reference: body.reference ?? "(unassigned)", status: "authorized", amountUsd, source, authorization, trip },
  });
}
