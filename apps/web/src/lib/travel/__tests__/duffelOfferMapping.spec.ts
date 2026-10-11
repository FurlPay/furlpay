import { describe, expect, it } from "vitest";
import { mapDuffelOffer } from "@/lib/travel/duffel";

// A fixture in the shape of Duffel's documented Offer schema
// (duffel.com/docs/api/v2/offers): a return trip, outbound with one stop.
const seg = (o: string, d: string, dep: string, arr: string, dur: string, num: string, bags?: unknown[]) => ({
  origin: { iata_code: o },
  destination: { iata_code: d },
  departing_at: dep,
  arriving_at: arr,
  duration: dur,
  marketing_carrier: { name: "British Airways", iata_code: "BA" },
  marketing_carrier_flight_number: num,
  operating_carrier: { name: "British Airways" },
  aircraft: { name: "Airbus A350" },
  passengers: bags ? [{ baggages: bags }] : [],
});

const offer = {
  id: "off_0000Test",
  total_amount: "812.40",
  total_currency: "GBP",
  expires_at: "2026-11-01T10:20:00Z",
  owner: { name: "British Airways", iata_code: "BA", logo_symbol_url: "https://assets.duffel.com/img/airlines/BA.svg" },
  conditions: {
    refund_before_departure: { allowed: false, penalty_amount: null, penalty_currency: null },
    change_before_departure: { allowed: true, penalty_amount: "75.00", penalty_currency: "GBP" },
  },
  slices: [
    {
      duration: "PT13H5M",
      segments: [
        seg("LHR", "DOH", "2026-11-10T08:30:00", "2026-11-10T17:20:00", "PT6H50M", "125", [
          { type: "checked", quantity: 2 },
          { type: "carry_on", quantity: 1 },
        ]),
        seg("DOH", "SIN", "2026-11-10T19:05:00", "2026-11-11T07:40:00", "PT7H35M", "8"),
      ],
    },
    { duration: "PT14H0M", segments: [seg("SIN", "LHR", "2026-11-20T23:15:00", "2026-11-21T06:15:00", "PT14H0M", "12")] },
  ],
};

describe("mapDuffelOffer", () => {
  const f = mapDuffelOffer(offer, "Economy")!;

  it("keeps the offer currency instead of assuming USD", () => {
    expect(f.priceUsd).toBe(812.4);
    expect(f.currency).toBe("GBP");
  });

  it("reads bags from the airline's baggages, not from the stop count", () => {
    expect(f.bags).toEqual({ checked: 2, carryOn: 1 });
    expect(f.baggage).toBe("1 carry-on + 2 checked");
  });

  it("says bags are not stated when the offer carries no baggages", () => {
    const g = mapDuffelOffer({ ...offer, slices: [{ ...offer.slices[1] }] })!;
    expect(g.bags).toBeUndefined();
    expect(g.baggage).toBe("Bags not stated by airline");
  });

  it("maps refund/change conditions", () => {
    expect(f.refundable).toBe(false);
    expect(f.changeable).toBe(true);
  });

  it("builds both legs with segments, flight numbers and layovers", () => {
    expect(f.legs).toHaveLength(2);
    expect(f.legs![0].stops).toBe(1);
    expect(f.legs![0].segments.map((s) => s.flightNumber)).toEqual(["BA125", "BA8"]);
    expect(f.legs![0].layovers).toEqual([{ airport: "DOH", minutes: 105 }]);
    expect(f.legs![1].stops).toBe(0);
  });

  it("uses ISO durations (timezone-safe) and sums both legs", () => {
    expect(f.legs![0].durationMin).toBe(13 * 60 + 5);
    expect(f.durationMin).toBe(13 * 60 + 5 + 14 * 60);
    expect(f.from).toBe("LHR");
    expect(f.to).toBe("SIN");
    expect(f.departTime).toBe("08:30");
  });

  it("rejects offers with no price or no segments", () => {
    expect(mapDuffelOffer({ ...offer, total_amount: "0" })).toBeNull();
    expect(mapDuffelOffer({ ...offer, slices: [] })).toBeNull();
    expect(mapDuffelOffer({})).toBeNull();
  });
});
