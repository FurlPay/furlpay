// ---------------------------------------------------------------------------
// /api/travel/book — the money boundary. Drives the REAL route handler. Proves:
//   C1  the client cannot set the charged amount; the server re-derives it
//   C1  amountUsd is bounded and the body is Zod-validated
//   H1  a repeated idempotencyKey books at most once (timeout/double-tap safe)
//   M3  the confirmation cashback equals the checkout cashback (canonical quote)
// No Postgres needed — the demo store + in-memory kv fallback are exercised.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as bookPOST } from "@/app/api/travel/book/route";
import { generateStays, deriveRooms, quoteStay } from "@/lib/travel/data";

// Each request gets a unique client IP so the route's 10/10min per-IP limiter
// gives every call its own bucket — the tests exercise booking logic, not the
// limiter. An idempotency replay must reuse the SAME ip so it's a true replay.
function req(body: unknown, ip = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`) {
  return new NextRequest("https://furlpay.com/api/travel/book", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const book = async (body: unknown, ip?: string) => {
  const res = await bookPOST(req(body, ip));
  return { status: res.status, json: await res.json() };
};

// The exact property + room the native property screen would hand to checkout.
const CITY = "Lisbon";
const stay = generateStays(CITY, { count: 16 })[0];
const room0 = deriveRooms(stay)[0];

describe("C1 — the server owns the price", () => {
  it("re-derives the amount from propertyId+roomIndex and IGNORES a tampered total", async () => {
    const nights = 3;
    const expected = quoteStay(room0.nightlyUsd * nights);
    const { status, json } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      nights,
      source: "travala",
      // An in-bounds but WRONG total (an underpay attempt) — must be ignored
      // because propertyId+roomIndex is the price authority. (An out-of-bounds
      // total is separately rejected by Zod .max — next test.)
      amountUsd: 1,
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(200);
    expect(json.booking.amountUsd).toBe(expected.totalUsd);
    expect(json.booking.amountUsd).not.toBe(1);
    expect(json.booking.quote).toEqual(expected);
  });

  it("rejects an out-of-bounds amountUsd on the legacy path (Zod .max)", async () => {
    const { status, json } = await book({ amountUsd: 1_000_000, source: "travala", idempotencyKey: randomUUID() });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_booking");
  });

  it("rejects a non-positive amountUsd", async () => {
    const { status } = await book({ amountUsd: -5, source: "travala", idempotencyKey: randomUUID() });
    expect(status).toBe(400);
  });

  it("400s when no price authority is supplied at all", async () => {
    const { status, json } = await book({ source: "travala", idempotencyKey: randomUUID() });
    expect(status).toBe(400);
    expect(json.error).toBe("amount_required");
  });

  it("404s an unknown propertyId instead of trusting a client price", async () => {
    const { status, json } = await book({
      propertyId: "stay_deadbeef_99",
      city: CITY,
      roomIndex: 0,
      amountUsd: 500,
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(404);
    expect(json.error).toBe("property_not_found");
  });

  it("400s an out-of-range roomIndex", async () => {
    const { status } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 7, // only 3 rooms exist
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(400);
  });

  it("prices the legacy subtotal path server-side (total = quoteStay(subtotal))", async () => {
    const { status, json } = await book({ subtotalUsd: 300, source: "legacy", idempotencyKey: randomUUID() });
    expect(status).toBe(200);
    expect(json.booking.amountUsd).toBe(quoteStay(300).totalUsd);
  });
});

describe("nights are authoritative from the dates, and bounded", () => {
  it("prices by the nights implied by checkIn/checkOut, not a mismatched nights field", async () => {
    // dates say 5 nights; the nights field lies (1). The server must charge 5.
    const expected = quoteStay(room0.nightlyUsd * 5);
    const { status, json } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      nights: 1,
      checkIn: "2026-07-18",
      checkOut: "2026-07-23",
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(200);
    expect(json.booking.amountUsd).toBe(expected.totalUsd);
    expect(json.booking.trip.nights).toBe(5);
  });

  it("clamps a far-future checkOut so it can't inflate the total past 30 nights", async () => {
    const capped = quoteStay(room0.nightlyUsd * 30);
    const { json } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      checkIn: "2026-07-18",
      checkOut: "2030-07-18", // ~1460 nights
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(json.booking.amountUsd).toBe(capped.totalUsd);
    expect(json.booking.trip.nights).toBe(30);
  });

  it("falls back to the nights field when no dates are supplied", async () => {
    const expected = quoteStay(room0.nightlyUsd * 4);
    const { json } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      nights: 4,
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(json.booking.amountUsd).toBe(expected.totalUsd);
  });
});

describe("H1 — idempotency: a booking happens at most once", () => {
  it("a replayed idempotencyKey returns the SAME booking, not a new one", async () => {
    const key = randomUUID();
    const body = { propertyId: stay.id, city: CITY, roomIndex: 0, nights: 3, source: "travala", idempotencyKey: key };
    const first = await book(body);
    const replay = await book(body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.json.booking.id).toBe(first.json.booking.id); // same trip, not a duplicate
  });

  it("distinct keys produce distinct bookings", async () => {
    const base = { propertyId: stay.id, city: CITY, roomIndex: 0, nights: 3, source: "travala" };
    const a = await book({ ...base, idempotencyKey: randomUUID() });
    const b = await book({ ...base, idempotencyKey: randomUUID() });
    expect(a.json.booking.id).not.toBe(b.json.booking.id);
  });
});

describe("M3 — cashback shown at checkout equals cashback on the receipt", () => {
  it("authorization.cashbackUsd is the canonical quote cashback (off subtotal+taxes)", async () => {
    const nights = 2;
    const q = quoteStay(room0.nightlyUsd * nights);
    const { json } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      nights,
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(json.booking.authorization.cashbackUsd).toBe(q.cashbackUsd);
    expect(json.booking.trip.cashbackUsd).toBe(q.cashbackUsd);
  });
});

describe("input validation (M4)", () => {
  it("strips/rejects an over-long name rather than storing it", async () => {
    const { status } = await book({
      propertyId: stay.id,
      city: CITY,
      roomIndex: 0,
      name: "x".repeat(500), // exceeds the 120 cap
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(400);
  });
});
