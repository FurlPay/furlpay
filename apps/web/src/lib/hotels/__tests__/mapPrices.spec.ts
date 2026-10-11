import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import {
  formatMoney,
  isExpired,
  isShowablePrice,
  nightsOf,
  parseSseEvents,
  priceLabel,
  pricingSubjects,
  rateFromEvent,
  stayFromParams,
  type MapRate,
} from "../mapPrices";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const live = (o: Partial<MapRate> = {}): MapRate => ({
  state: "available",
  perNightAmount: 142.4,
  totalAmount: 427.2,
  currency: "USD",
  nights: 3,
  expiresAt: "2026-10-06T12:10:00Z",
  ...o,
});

describe("price labels", () => {
  it("labels a live, unexpired rate per night in its currency", () => {
    expect(priceLabel(live(), NOW)).toBe("$142");
    expect(priceLabel(live({ currency: "EUR", perNightAmount: 1204 }), NOW)).toBe("€1,204");
    expect(priceLabel(live({ currency: "JPY", perNightAmount: 18400 }), NOW)).toBe("¥18,400");
  });

  it("never labels a missing, sandbox, unavailable or failed rate", () => {
    expect(priceLabel(undefined, NOW)).toBe("");
    expect(priceLabel(live({ state: "sandbox" }), NOW)).toBe("");
    expect(priceLabel({ state: "unavailable" }, NOW)).toBe("");
    expect(priceLabel({ state: "error" }, NOW)).toBe("");
    expect(priceLabel(live({ perNightAmount: undefined }), NOW)).toBe("");
    expect(priceLabel(live({ currency: undefined }), NOW)).toBe("");
    expect(priceLabel(live({ perNightAmount: 0 }), NOW)).toBe("");
  });

  it("drops a quote once its expiry passes", () => {
    const r = live({ expiresAt: "2026-10-06T11:59:59Z" });
    expect(isExpired(r, NOW)).toBe(true);
    expect(isShowablePrice(r, NOW)).toBe(false);
    expect(isExpired(live({ expiresAt: undefined }), NOW)).toBe(false);
  });

  it("still formats an ISO currency Intl may not know", () => {
    expect(formatMoney(120, "USD")).toBe("$120");
    expect(() => formatMoney(120, "XYZ")).not.toThrow();
  });
});

describe("stay dates from the URL", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("accepts a valid stay", () => {
    const s = stayFromParams(q("in=2026-11-12&out=2026-11-15&adults=3"), "2026-10-06");
    expect(s).toEqual({ checkIn: "2026-11-12", checkOut: "2026-11-15", adults: 3 });
    expect(nightsOf(s!)).toBe(3);
  });
  it("rejects past, inverted, zero-night, too-long and too-far stays", () => {
    expect(stayFromParams(q("in=2026-10-01&out=2026-10-03"), "2026-10-06")).toBeNull();
    expect(stayFromParams(q("in=2026-11-15&out=2026-11-12"), "2026-10-06")).toBeNull();
    expect(stayFromParams(q("in=2026-11-12&out=2026-11-12"), "2026-10-06")).toBeNull();
    expect(stayFromParams(q("in=2026-11-01&out=2027-03-01"), "2026-10-06")).toBeNull();
    expect(stayFromParams(q("in=2027-10-01&out=2027-10-03"), "2026-10-06")).toBeNull();
    expect(stayFromParams(q("in=nope&out=2026-11-12"), "2026-10-06")).toBeNull();
  });
  it("defaults an invalid party size to two adults", () => {
    expect(stayFromParams(q("in=2026-11-12&out=2026-11-13&adults=40"), "2026-10-06")?.adults).toBe(2);
  });
});

describe("which hotels to price", () => {
  const pt = (id: string, lat: number, lng: number) => ({ id, latitude: lat, longitude: lng }) as MapPoint;
  const pts = [pt("far", 35.8, 139.9), pt("near", 35.681, 139.767), pt("mid", 35.7, 139.78)];
  const centre = { latitude: 35.6812, longitude: 139.7671 };

  it("orders nearest the centre first and caps the batch", () => {
    expect(pricingSubjects(pts, centre, new Map(), NOW).map((p) => p.id)).toEqual(["near", "mid", "far"]);
    expect(pricingSubjects(pts, centre, new Map(), NOW, 1).map((p) => p.id)).toEqual(["near"]);
  });
  it("skips hotels already answered, but re-asks once a quote expired", () => {
    const known = new Map<string, MapRate>([
      ["near", live()],
      ["mid", live({ expiresAt: "2026-10-06T11:00:00Z" })],
      ["far", { state: "unavailable" }],
    ]);
    expect(pricingSubjects(pts, centre, known, NOW).map((p) => p.id)).toEqual(["mid"]);
  });
});

describe("the rate stream", () => {
  it("parses complete events and keeps the unfinished tail", () => {
    const buf =
      'event: open\ndata: {"total":2}\n\n: ping\n\nevent: rate\ndata: {"hotelId":"a","state":"available"}\n\nevent: rate\ndata: {"hot';
    const { events, rest } = parseSseEvents(buf);
    expect(events.map((e) => e.event)).toEqual(["open", "rate"]);
    expect(rest).toBe('event: rate\ndata: {"hot');
  });
  it("drops a malformed event without ending the stream", () => {
    const { events } = parseSseEvents('event: rate\ndata: {not json\n\nevent: done\ndata: {"resolved":1}\n\n');
    expect(events).toEqual([{ event: "done", data: { resolved: 1 } }]);
  });
  it("normalises rate events and refuses anything that is not one", () => {
    expect(rateFromEvent({ hotelId: "x", state: "available", perNightAmount: 99, currency: "USD" })?.rate.perNightAmount).toBe(99);
    expect(rateFromEvent({ hotelId: "x", state: "weird" })?.rate.state).toBe("error");
    expect(rateFromEvent({ state: "available" })).toBeNull();
    expect(rateFromEvent("nope")).toBeNull();
  });
});
