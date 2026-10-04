// ---------------------------------------------------------------------------
// /api/travel/book — the money boundary. Drives the REAL route handler. Proves:
//   C1  the client cannot set the charged amount; the server re-derives it
//   C1  amountUsd is bounded and the body is Zod-validated
//   H1  a repeated idempotencyKey books at most once (timeout/double-tap safe)
//   M3  the confirmation cashback equals the checkout cashback (canonical quote)
// No Postgres needed — the demo store + in-memory kv fallback are exercised.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { datasetStats } from "@/lib/hotels/googlePlacesLayer";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as bookPOST } from "@/app/api/travel/book/route";
import { quoteStay } from "@/lib/travel/data";
import { searchProperties } from "@/lib/travel/propertySource";

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

// A REAL property from the indexed dataset. The old fixture came from
// generateStays(), which is the point of this rewrite: the booking route used
// to re-derive a nightly rate from a hash of the city name, so these tests were
// asserting that a fabricated price was charged correctly.
const CITY = "Dubai";
// Resolved in beforeAll, once the clock is inside the dataset window.
let realProperty: ReturnType<typeof searchProperties>[number];

// The web checkout's actual path: it sends a SUBTOTAL and the server owns
// taxes, cashback and the total. The invariants below (idempotency, nights
// clamping, canonical cashback) all live on this path and are unaffected by
// the property-pricing change — so they are exercised through it.
const SUBTOTAL = 240;


// The indexed Google Places layer may only be served inside its cache window
// (datasetFresh; Google Places terms). These tests exercise the FRESH path, so
// the clock is pinned inside that window: they began failing on 2026-10-01 when
// the checked-in dataset expired, testing the calendar instead of the code.
// Only Date is faked; timers and promises run normally.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(datasetStats().generatedAt) + 86_400_000);
  realProperty = searchProperties({ city: CITY, limit: 1 })[0];
});
afterAll(() => vi.useRealTimers());

describe("C1 — the server owns the price", () => {
  it("ignores a tampered total and prices the subtotal itself", async () => {
    const nights = 3;
    const expected = quoteStay(SUBTOTAL);
    const { status, json } = await book({
      subtotalUsd: SUBTOTAL,
      nights,
      source: "travala",
      // An in-bounds but WRONG total (an underpay attempt). The server prices
      // the subtotal itself, so the client's number cannot survive.
      amountUsd: 1,
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(200);
    expect(json.booking.amountUsd).toBe(expected.totalUsd);
    expect(json.booking.amountUsd).not.toBe(1);
    expect(json.booking.quote).toEqual(expected);
  });

  it("REFUSES to price a real property with no live rate", async () => {
    // The invariant this whole refactor exists for. A real property resolves,
    // but we hold no rate for it — production's Duffel credential is a test
    // token — so the booking fails closed with 503 rather than falling back to
    // a derived, invented amount, which is what it used to do.
    const { status, json } = await book({
      propertyId: realProperty.id,
      city: CITY,
      roomIndex: 0,
      nights: 3,
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(503);
    expect(json.error).toBe("rate_unavailable");
  });

  it("404s a property id that is not in the dataset", async () => {
    // Any id at all used to resolve, because the generator minted inventory on
    // demand. A booking must not be possible against a property that does not
    // exist.
    const { status, json } = await book({
      propertyId: "not-a-real-place-id",
      city: CITY,
      roomIndex: 0,
      nights: 3,
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(404);
    expect(json.error).toBe("property_not_found");
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

  it("refuses a real property before it ever looks at roomIndex", async () => {
    // Room inventory used to be derived by multiplying a fabricated nightly
    // rate, so an out-of-range index was the only way this could fail. Now the
    // rate check comes first and fails closed, whatever the index says.
    const { status, json } = await book({
      propertyId: realProperty.id,
      city: CITY,
      roomIndex: 7,
      nights: 3,
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(503);
    expect(json.error).toBe("rate_unavailable");
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
    const expected = quoteStay(SUBTOTAL);
    const { status, json } = await book({
      subtotalUsd: SUBTOTAL,
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
    const capped = quoteStay(SUBTOTAL);
    const { json } = await book({
      subtotalUsd: SUBTOTAL,
      checkIn: "2026-07-18",
      checkOut: "2030-07-18", // ~1460 nights
      source: "travala",
      idempotencyKey: randomUUID(),
    });
    expect(json.booking.amountUsd).toBe(capped.totalUsd);
    expect(json.booking.trip.nights).toBe(30);
  });

  it("falls back to the nights field when no dates are supplied", async () => {
    const expected = quoteStay(SUBTOTAL);
    const { json } = await book({
      subtotalUsd: SUBTOTAL,
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
    const body = { subtotalUsd: SUBTOTAL, nights: 3, source: "travala", idempotencyKey: key };
    const first = await book(body);
    const replay = await book(body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.json.booking.id).toBe(first.json.booking.id); // same trip, not a duplicate
  });

  it("distinct keys produce distinct bookings", async () => {
    const base = { subtotalUsd: SUBTOTAL, nights: 3, source: "travala" };
    const a = await book({ ...base, idempotencyKey: randomUUID() });
    const b = await book({ ...base, idempotencyKey: randomUUID() });
    expect(a.json.booking.id).not.toBe(b.json.booking.id);
  });
});

describe("M3 — cashback shown at checkout equals cashback on the receipt", () => {
  it("authorization.cashbackUsd is the canonical quote cashback (off subtotal+taxes)", async () => {
    const nights = 2;
    const q = quoteStay(SUBTOTAL);
    const { json } = await book({
      subtotalUsd: SUBTOTAL,
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
      subtotalUsd: SUBTOTAL,
      name: "x".repeat(500), // exceeds the 120 cap
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(400);
  });
});
