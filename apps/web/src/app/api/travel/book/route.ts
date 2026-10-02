import { NextRequest, NextResponse } from "next/server";
import { findPropertyById } from "@/lib/travel/propertySource";
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

  nights as nightsFromDates,
} from "@/lib/travel/data";
import { addTrip } from "@/lib/travel/store";
import { mintTicketCnft } from "@/lib/travel/cnft";
import { createDuffelStayQuote, createDuffelStayBooking } from "@/lib/travel/duffel";
import { entryRequirements, type EntryRequirement } from "@/lib/travel/entryRequirements";
import { log } from "@/lib/log";
import { acquireLock, releaseLock } from "@/lib/locks";
import { kvGet, kvSet } from "@/lib/kv";
import { sendEmail } from "@/lib/email";
import { bookingConfirmationEmail } from "@/lib/emailTemplates";
import { optionalUser } from "@/lib/authz";
import { demoOnlyUnavailable } from "@/lib/demoGate";
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
    // optional entry-requirements inputs (visa/passport pre-check)
    nationality: z.string().max(40).optional(),
    destinationCountry: z.string().max(40).optional(), // ISO-2, name, or IATA
    passportExpiry: z.string().max(20).optional(), // YYYY-MM-DD
  })
  .strip();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.book", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;
  // The payment authorization below is SIMULATED (authorizeBooking: an
  // "x402_sim_" proof or a random card last-4) and no provider booking is made.
  // In production that would tell a customer "Booking confirmed", record a trip
  // and email a confirmation for a booking that does not exist. Refused there
  // until a real payment rail and booking provider replace it.
  const gate = demoOnlyUnavailable(
    "Travel booking",
    "Booking is not connected to a live payment rail or travel provider yet; nothing would be charged or reserved."
  );
  if (gate) return gate;

  const parsed = BookBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_booking", detail: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Resolve the owner BEFORE anything else — idempotency is scoped per owner so
  // one user's key can never replay another's booking. Public funnel: a caller
  // with NO credential books anonymously, by design.
  //
  // optionalUser, not a bare verifySession: this route spends money, and the
  // hand-rolled resolution it replaces skipped the cross-instance revocation
  // denylist, the deleted-account tombstone and the account lock — a revoked or
  // deleted session booked as though it were live. It also silently downgraded
  // an out-of-scope connector token to an anonymous booking; a caller who
  // presents a dead credential must be REFUSED, not served as though they had
  // presented none.
  //
  // Connector (MCP) tokens are now default-denied here by lib/mcp/routeScopes,
  // which is the documented intent: the only travel:write tool is
  // `book_travel_link`, and it exists precisely so a connector hands the user a
  // deep link instead of booking an irreversible trip autonomously.
  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const claims = auth.kind === "user" ? auth.claims : null;
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

  // Nights are authoritative from the dates when the client sent them (so the
  // charged duration always matches the itinerary shown), else the nights field.
  // Clamped to [1,30] so a far-future checkOut can't inflate the total — the
  // per-night price path below has no other upper bound.
  const bookedNights = Math.min(
    30,
    Math.max(1, body.checkIn && body.checkOut ? nightsFromDates(body.checkIn, body.checkOut) : body.nights ?? 3)
  );

  // --- entry requirements (visa + passport) ----------------------------------
  // Optional, and computed BEFORE any money moves. The visa status is indicative
  // and never blocks — it rides along in the response for the client to surface.
  // The one HARD block is deterministic and unarguable: a passport that has
  // already expired by the departure date cannot be used to travel, so we refuse
  // to create a booking obligation for an impossible trip.
  let entry: EntryRequirement | null = null;
  if (body.nationality && body.destinationCountry) {
    entry = entryRequirements({
      nationality: body.nationality,
      destination: body.destinationCountry,
      passportExpiry: body.passportExpiry,
      departureDate: body.checkIn,
      returnDate: body.checkOut,
    });
    if (body.passportExpiry && body.checkIn) {
      const exp = Date.parse(body.passportExpiry);
      const dep = Date.parse(body.checkIn);
      if (!isNaN(exp) && !isNaN(dep) && exp < dep) {
        // Auditable: record WHY a booking was refused before any charge. No PII
        // beyond country codes + dates (no passport number is ever collected).
        log.warn("travel.book.blocked_passport_expired", {
          owner: claims?.sub ?? "anon",
          nationality: entry?.nationality,
          destination: entry?.destination,
          passportExpiry: body.passportExpiry,
          departure: body.checkIn,
        });
        return NextResponse.json(
          {
            error: "passport_expired",
            detail: "The passport expires before the travel date. Renew it before booking — you were not charged.",
            entry,
          },
          { status: 422 }
        );
      }
    }
  }

  // --- price authority -------------------------------------------------------
  let amountUsd: number;
  let quote: ReturnType<typeof quoteStay> | null = null;

  if (body.propertyId && body.city && body.roomIndex !== undefined) {
    // (1) Price a specific property.
    //
    // This used to re-derive the rate from generateStays() — which meant the
    // amount a booking charged came out of a hash of the city name. The
    // property was fabricated, its nightly rate was fabricated, and the flow
    // could not tell the difference because a fabricated stay satisfies the
    // same type as a real one.
    //
    // Now the id must resolve against the indexed dataset, and the rate must
    // be a real one. We hold no live rates today (Duffel production carries a
    // test token, which lib/hotels/pricing.ts correctly refuses to serve as
    // real), so this path fails closed. That is the intended behaviour: a
    // booking that cannot be priced from a real rate must not be priced at
    // all. The web checkout is unaffected — it sends subtotalUsd below.
    const property = findPropertyById(body.propertyId);
    if (!property) {
      return NextResponse.json({ error: "property_not_found" }, { status: 404 });
    }
    if (!property.rate) {
      return NextResponse.json(
        {
          error: "rate_unavailable",
          message: "No live rate is available for this property.",
          propertyId: property.id,
        },
        { status: 503 }
      );
    }
    quote = quoteStay(property.rate.amount * bookedNights);
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
      nights: bookedNights,
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
        // Non-blocking visa/passport assessment when the client supplied it.
        entry,
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
