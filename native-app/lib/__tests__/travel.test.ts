import {
  CASHBACK_RATE,
  addDays,
  deriveRooms,
  formatStayDate,
  nightsBetween,
  quoteStay,
  TRAVEL_RATES,
  type Stay,
} from "../travel";

// The native checkout ESTIMATE (quoteStay) mirrors the server's quoteStay
// (apps/web/src/lib/travel/data.ts) field-for-field, so the pre-payment display
// matches the amount the server actually charges. These fixtures are computed
// by that server math. The authoritative charge is still the server's response.

describe("quoteStay — server parity (StayQuote shape)", () => {
  it("10% taxes, 2% cashback off (subtotal + taxes), rounded to cents at each step", () => {
    // $540 subtotal (the web checkout's own fallback amount)
    expect(quoteStay(540)).toEqual({
      subtotalUsd: 540,
      taxesUsd: 54,
      cashbackUsd: 11.88,
      totalUsd: 582.12,
    });
  });

  it("survives an awkward floating-point subtotal without fractional-cent drift", () => {
    const { subtotalUsd, taxesUsd, cashbackUsd, totalUsd } = quoteStay(333.33);
    expect(subtotalUsd).toBe(333.33);
    expect(taxesUsd).toBe(33.33);
    expect(cashbackUsd).toBe(7.33); // round(366.66 * 0.02 * 100)/100
    expect(totalUsd).toBe(359.33);
    for (const v of [subtotalUsd, taxesUsd, cashbackUsd, totalUsd]) {
      expect(Math.round(v * 100) / 100).toBe(v); // clean cents on every invoice line
    }
  });

  it("cashback is 2% of (subtotal + taxes), the same base the confirmation shows", () => {
    const { taxesUsd, cashbackUsd } = quoteStay(1000);
    expect(cashbackUsd).toBe(Math.round((1000 + taxesUsd) * CASHBACK_RATE * 100) / 100);
  });

  it("total = subtotal + taxes − cashback", () => {
    const q = quoteStay(742.5);
    expect(q.totalUsd).toBe(Math.round((q.subtotalUsd + q.taxesUsd - q.cashbackUsd) * 100) / 100);
  });

  it("display FX table matches the web RATES", () => {
    expect(TRAVEL_RATES.USDC).toBe(1);
    expect(TRAVEL_RATES.SOL).toBeCloseTo(1 / 175);
    expect(TRAVEL_RATES.BTC).toBeCloseTo(1 / 96000);
  });
});

// The property screen renders rooms from the cached Stay via deriveRooms
// instead of re-fetching /property. That is only safe if native deriveRooms is
// byte-identical to the server's (apps/web/src/lib/travel/data.ts): the server
// re-derives the SAME room at book time from propertyId + roomIndex. Fixtures
// below are computed from the server formula (mult 1 / 1.25 / 1.7; nightlySol =
// round2(nightlyUsd / 175)).

const stay = (over: Partial<Stay>): Stay =>
  ({
    id: "stay_x_0",
    name: "Test",
    brand: "Independent",
    city: "Bali",
    country: "—",
    type: "Hotel",
    stars: 4,
    rating: 4.5,
    reviews: 100,
    nightlyUsd: 200,
    image: "",
    amenities: [],
    roomsLeft: 5,
    freeCancellation: true,
    eco: false,
    ...over,
  }) as Stay;

describe("deriveRooms — server parity", () => {
  it("Hotel: 3 rooms at 1x / 1.25x / 1.7x with a City View Suite", () => {
    expect(deriveRooms(stay({ nightlyUsd: 200, type: "Hotel", freeCancellation: true }))).toEqual([
      { name: "Standard Room", multiplier: 1, cancellable: true, nightlyUsd: 200, nightlyUsdc: 200, nightlySol: 1.14 },
      { name: "Deluxe King Room", multiplier: 1.25, cancellable: true, nightlyUsd: 250, nightlyUsdc: 250, nightlySol: 1.43 },
      { name: "City View Suite", multiplier: 1.7, cancellable: true, nightlyUsd: 340, nightlyUsdc: 340, nightlySol: 1.94 },
    ]);
  });

  it("Resort: the suite is an Ocean View Suite; Standard inherits freeCancellation", () => {
    const rooms = deriveRooms(stay({ nightlyUsd: 180, type: "Resort", freeCancellation: false }));
    expect(rooms[0]).toMatchObject({ name: "Standard Room", cancellable: false, nightlyUsd: 180 });
    expect(rooms[2].name).toBe("Ocean View Suite");
    expect(rooms[1].nightlyUsd).toBe(225);
    expect(rooms[2].nightlyUsd).toBe(306);
  });

  it("rounds every derived rate to clean cents (no fractional-cent drift)", () => {
    for (const r of deriveRooms(stay({ nightlyUsd: 187.37 }))) {
      expect(Math.round(r.nightlyUsd * 100) / 100).toBe(r.nightlyUsd);
      expect(Math.round(r.nightlySol * 100) / 100).toBe(r.nightlySol);
    }
  });
});

// Stay-date math powers the property screen's date strip + nights stepper and
// must match the server's night count (apps/web nights()). Pure, UTC, no Intl
// (Hermes ships Intl incomplete — a locale formatter would differ on device).
describe("stay date helpers", () => {
  it("addDays crosses month and year boundaries in UTC", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-07-18", 0)).toBe("2026-07-18");
  });

  it("nightsBetween returns whole nights, and >= 1 for invalid/reversed ranges", () => {
    expect(nightsBetween("2026-07-18", "2026-07-21")).toBe(3);
    expect(nightsBetween("2026-07-18", "2026-07-19")).toBe(1);
    expect(nightsBetween("2026-07-21", "2026-07-18")).toBe(1); // reversed → floor of 1
    expect(nightsBetween("garbage", "2026-07-21")).toBe(1);
  });

  it("checkOut = addDays(checkIn, nights) round-trips through nightsBetween", () => {
    for (const [checkIn, n] of [["2026-07-18", 1], ["2026-02-27", 4], ["2026-12-29", 7]] as const) {
      expect(nightsBetween(checkIn, addDays(checkIn, n))).toBe(n);
    }
  });

  it("formatStayDate is locale-free and stable", () => {
    expect(formatStayDate("2026-07-18")).toBe("Sat, Jul 18");
    expect(formatStayDate("2026-01-01")).toBe("Thu, Jan 1");
  });
});
