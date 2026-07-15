import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { z } from "zod";
import {
  authorizeBooking,
  BookingSource,
  CITY_PHOTOS,
  MCC,
  RATES,
  quoteStay,
  deriveRooms,
  generateStays,
} from "@/lib/travel/data";
import { addTrip } from "@/lib/travel/store";
import { mintTicketCnft } from "@/lib/travel/cnft";
import { createDuffelStayQuote, createDuffelStayBooking } from "@/lib/travel/duffel";
import { acquireLock, releaseLock } from "@/lib/locks";
import { kvGet, kvSet } from "@/lib/kv";
import { sendEmail } from "@/lib/email";
import { bookingConfirmationEmail } from "@/lib/emailTemplates";
import { verifySession, tokenFromRequest } from "@/lib/session";
import { hasScope, type McpClaims } from "@/lib/mcp/oauth";
import crypto from "crypto";

// POST /api/travel/book — authorize a booking and record it as a trip.
//
// THE MONEY BOUNDARY. The client never decides the amount charged. Three price
// authorities, in order of preference:
//   1. propertyId + city + roomIndex → the server re-derives the room rate from
//      its own deterministic inventory (the SAME deriveRooms() the property
//      screen rendered) and computes taxes/cashback/total via quoteStay(). Any
//      client-sent amountUsd is ignored. This is what the native app uses.
//   2. rateId → live Duffel reprice (supplier is authoritative).
//   3. subtotalUsd / amountUsd → bounded fallback for the legacy web checkout;
//      quoteStay() still owns the total when a subtotal is given.
//
// Idempotency (H1): a client sends one idempotencyKey per checkout attempt.
// The first success is stored under travel:book:idem:<owner>:<key>; a replay
// (timeout retry, double tap, process-death re-send) returns that SAME booking
// instead of creating a second trip.

const MAX_BOOKING_USD = 100_000;
const IDEM_TTL_SECONDS = 15 * 60;

const BookBody = z
  .object({
    // (1) server-authoritative demo path — identifiers only
    propertyId: z.string().min(1).max(64).optional(),
    city: z.string().min(1).max(80).optional(),
    roomIndex: z.coerce.number().int().min(0).max(9).optional(),
    nights: z.coerce.number().int().min(1).max(30).optional(),
    guests: z.coerce.number().int().min(1).max(16).optional(),
    // (2)/(3) amount paths — bounded
    rateId: z.string().min(1).max(200).optional(),
    subtotalUsd: z.coerce.number().positive().max(MAX_BOOKING_USD).optional(),
    amountUsd: z.coerce.number().positive().max(MAX_BOOKING_USD).optional(),
    source: z.enum(["travala", "legacy"]).optional(),
    mcc: z.string().max(8).optional(),
    // descriptive fields (stored + emailed) — length-capped
    name: z.string().max(120).optional(),
    image: z.string().max(500).optional(),
    method: z.string().max(80).optional(),
    reference: z.string().max(120).optional(),
    checkIn: z.string().max(40).optional(),
    checkOut: z.string().max(40).optional(),
    // idempotency (H1)
    idempotencyKey: z.string().min(8).max(80).optional(),
    // guest details (Duffel live path + confirmation email)
    email: z.string().email().max(200).optional(),
    guestGivenName: z.string().max(80).optional(),
    guestFamilyName: z.string().max(80).optional(),
    phone: z.string().max(40).optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.book", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const parsed = BookBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_booking", detail: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Resolve the owner BEFORE anything else — idempotency is scoped per owner so
  // one user's key can never replay another's booking. Public funnel: an
  // unauthenticated (or under-scoped MCP) caller books anonymously.
  const raw = (await verifySession(tokenFromRequest(req), { durable: true })) as McpClaims | null;
  const claims = raw?.mcp === true && !hasScope(raw, "travel:write") ? null : raw;
  const ownerId = claims?.sub ?? `anon:${crypto.randomUUID()}`;

  // Idempotency replay — return the prior booking untouched, no new trip.
  // The namespace is the STABLE identity (the user id, or the constant "anon"),
  // NOT ownerId: an anonymous caller gets a fresh random ownerId every request,
  // so scoping on ownerId would defeat dedupe for the public funnel. The key
  // itself is a 128-bit client UUID, so "anon" + key does not collide across
  // users and can't be guessed to read someone else's booking.
  const idemKey = body.idempotencyKey
    ? `travel:book:idem:${claims?.sub ?? "anon"}:${body.idempotencyKey}`
    : null;
  if (idemKey) {
    const prior = await kvGet<Record<string, unknown>>(idemKey);
    if (prior) return NextResponse.json(prior, { headers: { "Idempotent-Replay": "true" } });
  }

  // --- price authority -------------------------------------------------------
  let amountUsd: number;
  let quote: ReturnType<typeof quoteStay> | null = null;

  if (body.propertyId && body.city && body.roomIndex !== undefined) {
    // (1) Re-derive the room rate from deterministic inventory. count:16 matches
    // the property route, and property ids encode their pre-filter index, so the
    // same id resolves to the same rate here as on the property screen.
    const stay = generateStays(body.city, { count: 16 }).find((s) => s.id === body.propertyId);
    if (!stay) {
      return NextResponse.json({ error: "property_not_found" }, { status: 404 });
    }
    const room = deriveRooms(stay)[body.roomIndex];
    if (!room) {
      return NextResponse.json({ error: "invalid_room" }, { status: 400 });
    }
    const nights = body.nights ?? 3;
    quote = quoteStay(room.nightlyUsd * nights);
    amountUsd = quote.totalUsd;
  } else if (body.subtotalUsd !== undefined) {
    // (3a) Subtotal given → server owns taxes/cashback/total.
    quote = quoteStay(body.subtotalUsd);
    amountUsd = quote.totalUsd;
  } else if (body.amountUsd !== undefined) {
    // (3b) Legacy web path: a bounded pre-computed total (Zod caps it).
    amountUsd = body.amountUsd;
  } else {
    return NextResponse.json(
      { error: "amount_required", detail: "supply propertyId+city+roomIndex, subtotalUsd, or amountUsd" },
      { status: 400 }
    );
  }

  // Distributed mutex: a double-clicked "Confirm" (or two instances racing on
  // the same itinerary) books once within the window. Scoped to the owner so
  // two users booking the same room don't collide. Idempotency (above) is the
  // durable guard; this only narrows the race.
  const lockName =
    "booking:" +
    crypto
      .createHash("sha256")
      .update(JSON.stringify([ownerId, body.rateId ?? body.propertyId ?? body.reference ?? body.name, body.city, amountUsd, body.checkIn]))
      .digest("hex")
      .slice(0, 32);
  const lockToken = await acquireLock(lockName, 15);
  if (!lockToken) {
    return NextResponse.json({ error: "duplicate_booking_in_flight" }, { status: 409 });
  }
  try {
    // (2) Live Duffel path: reprice the rate right before money moves.
    let duffel: { bookingId: string; reference: string; status: string } | null = null;
    if (body.rateId) {
      const dq = await createDuffelStayQuote(body.rateId);
      if (dq) {
        // The repriced total is authoritative; reject silent price jumps >5%.
        if (dq.totalAmount > amountUsd * 1.05) {
          return NextResponse.json({ error: "price_changed", newAmountUsd: dq.totalAmount }, { status: 409 });
        }
        amountUsd = dq.totalAmount || amountUsd;
        duffel = await createDuffelStayBooking({
          quoteId: dq.quoteId,
          guest: {
            givenName: body.guestGivenName ?? "FurlPay",
            familyName: body.guestFamilyName ?? "Traveler",
          },
          email: body.email ?? "bookings@furlpay.com",
          phone: body.phone,
        });
      }
    }

    const source: BookingSource = body.source === "legacy" ? "legacy" : "travala";
    const authorization = authorizeBooking(amountUsd, source, (body.mcc as (typeof MCC)[keyof typeof MCC]) ?? MCC.LODGING);
    // Canonical cashback: when the server priced the stay, the confirmation's
    // "cashback earned" must equal the checkout's cashback line (both off
    // subtotal+taxes), not authorizeBooking's 2%-of-total. Keeps M3 closed.
    if (quote) authorization.cashbackUsd = quote.cashbackUsd;
    const id = "bk_" + crypto.randomUUID();

    const trip = addTrip({
      id,
      userId: ownerId,
      name: body.name ?? "Your stay",
      city: body.city ?? "—",
      image: body.image ?? "from-sky-500/40 to-indigo-600/40",
      checkIn: body.checkIn ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      checkOut: body.checkOut ?? new Date(Date.now() + 17 * 86_400_000).toISOString().slice(0, 10),
      nights: body.nights ?? 3,
      guests: body.guests ?? 2,
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
      imageUrl: body.image?.startsWith("http") ? body.image : undefined,
    });

    // Confirmation email to the guest when the checkout supplied an address.
    const reference = duffel?.reference ?? body.reference ?? "(unassigned)";
    if (body.email) {
      void sendEmail({
        to: body.email,
        category: "booking",
        idempotencyKey: `booking-${id}`,
        ...bookingConfirmationEmail({
          guestName: body.guestGivenName,
          heroImageUrl: body.image?.startsWith("https://") ? body.image : CITY_PHOTOS[trip.city],
          tripName: trip.name,
          city: trip.city,
          checkIn: trip.checkIn,
          checkOut: trip.checkOut,
          nights: trip.nights,
          guests: trip.guests,
          amountUsd,
          reference,
          method: trip.method,
          cashbackUsd: trip.cashbackUsd,
          stablecoinEquivalent: `${(amountUsd * RATES.XSGD).toFixed(2)} XSGD (MAS-regulated)`,
          receiptNft: trip.ticket?.assetId,
        }),
      });
    }

    const payload = {
      booking: {
        id,
        reference,
        status: duffel ? duffel.status : "authorized",
        duffelBookingId: duffel?.bookingId,
        amountUsd,
        // The authoritative breakdown the client should DISPLAY (never recompute).
        quote,
        source,
        authorization,
        trip,
      },
    };

    // Persist for idempotent replay BEFORE returning, so a client that never
    // sees this response (timeout) gets the same booking on retry.
    if (idemKey) await kvSet(idemKey, payload, IDEM_TTL_SECONDS);

    return NextResponse.json(payload);
  } finally {
    await releaseLock(lockName, lockToken);
  }
}
