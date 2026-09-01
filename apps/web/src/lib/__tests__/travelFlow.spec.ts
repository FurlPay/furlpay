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
import { findPropertyById } from "@/lib/travel/propertySource";

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

describe("native travel funnel — click a city, see real hotels, price honestly", () => {
  // These tests used to assert that EVERY deal city returned hotels and that a
  // hotel resolved to bookable rooms at a shown price. Both held only because
  // generateStays() minted inventory on demand — a city we had never indexed
  // still produced a full page, and the "price" came from a hash of its name.
  // What follows asserts the honest chain instead.

  it("returns hotels for a city we index, and an empty list for one we do not", async () => {
    const covered = await (
      await hotelsGET(get("https://furlpay.com/api/travel/hotels?city=Dubai"))
    ).json();
    expect(covered.hotels.length).toBeGreaterThan(0);
    expect(covered.source).toBe("indexed_dataset");

    // Cancun is a real destination we hold no indexed properties for. It must
    // come back empty rather than filled — a dead-end card is honest, an
    // invented page of hotels is not.
    const uncovered = await (
      await hotelsGET(get("https://furlpay.com/api/travel/hotels?city=Canc%C3%BAn"))
    ).json();
    expect(uncovered.hotels).toEqual([]);
  });

  it("every returned hotel exists in the indexed dataset", async () => {
    const json = await (
      await hotelsGET(get("https://furlpay.com/api/travel/hotels?city=London"))
    ).json();
    for (const h of json.hotels as Array<{ id: string }>) {
      expect(findPropertyById(h.id), `${h.id} is not in the dataset`).not.toBeNull();
    }
  });

  it("an id from /hotels resolves on /property, with no invented rooms or price", async () => {
    const hotels = (
      await (await hotelsGET(get("https://furlpay.com/api/travel/hotels?city=Dubai"))).json()
    ).hotels as Array<{ id: string }>;
    const hotel = hotels[0];

    const propRes = await propertyGET(get(`https://furlpay.com/api/travel/property/${hotel.id}`), {
      params: { id: hotel.id },
    });
    expect(propRes.status, "property screen 404'd on a hotel the list returned").toBe(200);

    const prop = (await propRes.json()) as {
      property: { rate: unknown };
      rooms: unknown[];
      rateUnavailableReason: string | null;
    };
    // The identity chain still works. The pricing does not pretend to.
    expect(prop.rooms).toEqual([]);
    expect(prop.property.rate).toBeNull();
    expect(prop.rateUnavailableReason).toBe("no_live_rate_provider");
  });

  it("404s a property id that was never in the dataset", async () => {
    const res = await propertyGET(get("https://furlpay.com/api/travel/property/made-up-id"), {
      params: { id: "made-up-id" },
    });
    expect(res.status).toBe(404);
  });

  it("refuses to book a real property while no live rate exists", async () => {
    const hotels = (
      await (await hotelsGET(get("https://furlpay.com/api/travel/hotels?city=Dubai"))).json()
    ).hotels as Array<{ id: string }>;
    const booked = await bookPOST(
      bookReq({
        propertyId: hotels[0].id,
        city: "Dubai",
        roomIndex: 0,
        nights: 3,
        source: "travala",
        name: "Test stay",
        idempotencyKey: randomUUID(),
      })
    );
    expect(booked.status).toBe(503);
    expect((await booked.json()).error).toBe("rate_unavailable");
  });
});
