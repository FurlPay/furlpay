// ---------------------------------------------------------------------------
// The native travel funnel, end to end, against the REAL route handlers:
//   deal card → hotels(city) → property(id) → book(propertyId, roomIndex)
//
// This is the "click Bali → see Bali hotels → pick a room → book" path the
// native app drives. It proves the id minted by /travel/hotels resolves in
// /travel/property AND in /travel/book (the three use different generateStays
// counts/filters), and that the booked amount matches what the property screen
// showed. A break anywhere here is a dead-end or a 404 mid-booking on device.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as dealsGET } from "@/app/api/travel/deals/route";
import { GET as hotelsGET } from "@/app/api/travel/hotels/route";
import { GET as propertyGET } from "@/app/api/travel/property/[id]/route";
import { POST as bookPOST } from "@/app/api/travel/book/route";
import { quoteStay } from "@/lib/travel/data";

function get(url: string) {
  return new NextRequest(url, { headers: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 255)}.1` } });
}
function bookReq(body: unknown) {
  return new NextRequest("https://furlpay.com/api/travel/book", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.8.${Math.floor(Math.random() * 255)}.1` },
    body: JSON.stringify(body),
  });
}

describe("native travel funnel — click a city, see hotels, book a room", () => {
  it("every featured deal city resolves to hotels (no dead-end card)", async () => {
    const deals = (await (await dealsGET()).json()).deals as Array<{ city: string }>;
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      const res = await hotelsGET(get(`https://furlpay.com/api/travel/hotels?city=${encodeURIComponent(d.city)}`));
      const json = await res.json();
      const list = json.hotels ?? json.collections?.flatMap((c: { hotels: unknown[] }) => c.hotels) ?? [];
      expect(list.length, `no hotels for deal city ${d.city}`).toBeGreaterThan(0);
    }
  });

  it("a hotel id from /hotels resolves in /property AND books at the shown price", async () => {
    const city = "Bali";
    // 1. hotels for the city
    const hotels = (await (await hotelsGET(get(`https://furlpay.com/api/travel/hotels?city=${city}`))).json())
      .hotels as Array<{ id: string; city: string; nightlyUsd: number }>;
    expect(hotels.length).toBeGreaterThan(0);
    const hotel = hotels[0];

    // 2. that id must resolve on the property screen (different generateStays count)
    const propRes = await propertyGET(
      get(`https://furlpay.com/api/travel/property/${hotel.id}?city=${hotel.city}`),
      { params: { id: hotel.id } }
    );
    expect(propRes.status, "property screen 404'd on a hotel the list returned").toBe(200);
    const prop = (await propRes.json()) as { rooms: Array<{ nightlyUsd: number }> };
    expect(prop.rooms.length).toBeGreaterThan(0);

    // 3. book the standard room (index 0), 3 nights — the native property flow
    const nights = 3;
    const roomIndex = 0;
    const expected = quoteStay(prop.rooms[roomIndex].nightlyUsd * nights);
    const booked = await bookPOST(
      bookReq({
        propertyId: hotel.id,
        city: hotel.city,
        roomIndex,
        nights,
        source: "travala",
        name: "Test stay",
        idempotencyKey: randomUUID(),
      })
    );
    expect(booked.status).toBe(200);
    const { booking } = (await booked.json()) as { booking: { amountUsd: number; quote: typeof expected; trip: { city: string } } };
    // The amount booked equals the server-derived total for the room shown.
    expect(booking.amountUsd).toBe(expected.totalUsd);
    expect(booking.quote).toEqual(expected);
    expect(booking.trip.city).toBe(city);
  });

  it("every room index shown on the property screen is bookable", async () => {
    const city = "Tokyo";
    const hotels = (await (await hotelsGET(get(`https://furlpay.com/api/travel/hotels?city=${city}`))).json())
      .hotels as Array<{ id: string; city: string }>;
    const hotel = hotels[0];
    const prop = (await (
      await propertyGET(get(`https://furlpay.com/api/travel/property/${hotel.id}?city=${hotel.city}`), {
        params: { id: hotel.id },
      })
    ).json()) as { rooms: unknown[] };

    for (let roomIndex = 0; roomIndex < prop.rooms.length; roomIndex++) {
      const res = await bookPOST(
        bookReq({ propertyId: hotel.id, city: hotel.city, roomIndex, nights: 3, source: "travala", idempotencyKey: randomUUID() })
      );
      expect(res.status, `room index ${roomIndex} failed to book`).toBe(200);
    }
  });
});
