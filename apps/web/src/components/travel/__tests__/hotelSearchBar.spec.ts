import { describe, expect, it } from "vitest";
import {
  MAX_CHECKIN_DAYS_AHEAD,
  MAX_CHILD_AGE,
  MAX_STAY_NIGHTS,
  defaultHotelSearch,
  validateHotelSearch,
  type HotelSearch,
} from "@/lib/hotels/hotelSearch";

// ---------------------------------------------------------------------------
// The search bar's validation exists to stop the UI composing a request that
// /api/travel/hotels/price would reject. That makes these tests a check on
// AGREEMENT between two files, not on arithmetic: if the route's ContextSchema
// or its date-sanity block moves and this does not, the bar starts offering
// searches that 400. The boundary cases below are the exact edges the route
// draws, so a drift shows up here rather than in production.
//
// `today` is always passed explicitly. Nothing in this suite reads the clock,
// so it cannot start failing at midnight or in another timezone.
// ---------------------------------------------------------------------------

const TODAY = "2026-06-15";

const base: HotelSearch = {
  destination: "Dubai",
  checkIn: "2026-06-20",
  checkOut: "2026-06-23",
  adults: 2,
  children: [],
  rooms: 1,
};

const v = (patch: Partial<HotelSearch> = {}) =>
  validateHotelSearch({ ...base, ...patch }, TODAY);

describe("validateHotelSearch", () => {
  it("accepts a well-formed search", () => {
    expect(v()).toBeNull();
  });

  describe("destination", () => {
    it("requires one", () => {
      expect(v({ destination: "" })).toBe("Choose a destination");
    });

    it("does not accept whitespace as one", () => {
      expect(v({ destination: "   " })).toBe("Choose a destination");
    });
  });

  describe("dates", () => {
    it("rejects a check-out before check-in", () => {
      expect(v({ checkOut: "2026-06-19" })).toBe("Check-out must be after check-in");
    });

    it("rejects a zero-night stay", () => {
      expect(v({ checkOut: "2026-06-20" })).toBe("Check-out must be after check-in");
    });

    it("accepts exactly one night", () => {
      expect(v({ checkIn: "2026-06-20", checkOut: "2026-06-21" })).toBeNull();
    });

    it("accepts a stay of exactly the maximum", () => {
      // 99 nights is allowed by the route; 100 is not. Both edges are asserted
      // so an off-by-one in either direction is caught.
      const checkOut = new Date(Date.UTC(2026, 5, 20));
      checkOut.setUTCDate(checkOut.getUTCDate() + MAX_STAY_NIGHTS);
      expect(v({ checkOut: checkOut.toISOString().slice(0, 10) })).toBeNull();
    });

    it("rejects a stay one night over the maximum", () => {
      const checkOut = new Date(Date.UTC(2026, 5, 20));
      checkOut.setUTCDate(checkOut.getUTCDate() + MAX_STAY_NIGHTS + 1);
      expect(v({ checkOut: checkOut.toISOString().slice(0, 10) })).toBe(
        `Stay must be ${MAX_STAY_NIGHTS} nights or fewer`
      );
    });

    it("rejects a check-in in the past", () => {
      expect(v({ checkIn: "2026-06-14", checkOut: "2026-06-16" })).toBe(
        "Check-in cannot be in the past"
      );
    });

    it("accepts a check-in today", () => {
      expect(v({ checkIn: TODAY, checkOut: "2026-06-16" })).toBeNull();
    });

    it("accepts a check-in at exactly the booking horizon", () => {
      const at = new Date(Date.UTC(2026, 5, 15));
      at.setUTCDate(at.getUTCDate() + MAX_CHECKIN_DAYS_AHEAD);
      const checkIn = at.toISOString().slice(0, 10);
      at.setUTCDate(at.getUTCDate() + 1);
      expect(v({ checkIn, checkOut: at.toISOString().slice(0, 10) })).toBeNull();
    });

    it("rejects a check-in one day past the horizon", () => {
      const at = new Date(Date.UTC(2026, 5, 15));
      at.setUTCDate(at.getUTCDate() + MAX_CHECKIN_DAYS_AHEAD + 1);
      const checkIn = at.toISOString().slice(0, 10);
      at.setUTCDate(at.getUTCDate() + 1);
      expect(v({ checkIn, checkOut: at.toISOString().slice(0, 10) })).toBe(
        `Check-in must be within ${MAX_CHECKIN_DAYS_AHEAD} days`
      );
    });

    it("rejects a date that is not a date", () => {
      expect(v({ checkIn: "not-a-date" })).toBe("Choose your dates");
    });

    it("skips only the horizon check when today is unknown", () => {
      // Before mount the clock has not been read. A search that is otherwise
      // fine must still validate, so the button is not dead on first paint —
      // but the stay-length rule still applies.
      const farFuture = { checkIn: "2099-01-01", checkOut: "2099-01-03" };
      expect(validateHotelSearch({ ...base, ...farFuture }, null)).toBeNull();
      expect(
        validateHotelSearch({ ...base, checkIn: "2099-01-03", checkOut: "2099-01-01" }, null)
      ).toBe("Check-out must be after check-in");
    });
  });

  describe("occupancy", () => {
    it("rejects more rooms than adults", () => {
      // The server would take it. A room with nobody in it still cannot be
      // booked, so the bar refuses it before anyone gets that far.
      expect(v({ rooms: 3, adults: 2 })).toBe("Each room needs at least one adult");
    });

    it("accepts one adult per room", () => {
      expect(v({ rooms: 2, adults: 2 })).toBeNull();
    });

    it("rejects an out-of-range child age", () => {
      expect(v({ children: [MAX_CHILD_AGE + 1] })).toBe("Check the children's ages");
    });

    it("accepts an infant at age zero", () => {
      expect(v({ children: [0] })).toBeNull();
    });

    it("accepts a child at exactly the maximum age", () => {
      expect(v({ children: [MAX_CHILD_AGE] })).toBeNull();
    });

    it("rejects too many adults", () => {
      expect(v({ adults: 10, rooms: 1 })).toBe("Up to 9 adults");
    });

    it("rejects too many children", () => {
      expect(v({ children: Array(10).fill(8) })).toBe("Up to 9 children");
    });
  });
});

describe("defaultHotelSearch", () => {
  it("produces a search that its own validator accepts", () => {
    // The seed must never be born invalid — that would render the bar with the
    // action already disabled and no explanation.
    const d = defaultHotelSearch("Dubai");
    expect(validateHotelSearch(d, null)).toBeNull();
  });

  it("carries the destination through", () => {
    expect(defaultHotelSearch("Lisbon").destination).toBe("Lisbon");
  });

  it("defaults to a one-night stay starting tomorrow", () => {
    const d = defaultHotelSearch();
    const nights =
      (Date.parse(`${d.checkOut}T00:00:00Z`) - Date.parse(`${d.checkIn}T00:00:00Z`)) / 86_400_000;
    expect({ nights, rooms: d.rooms, children: d.children }).toEqual({
      nights: 1,
      rooms: 1,
      children: [],
    });
  });

  it("emits dates the price route's regex accepts", () => {
    const d = defaultHotelSearch();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    expect({ in: iso.test(d.checkIn), out: iso.test(d.checkOut) }).toEqual({
      in: true,
      out: true,
    });
  });
});
