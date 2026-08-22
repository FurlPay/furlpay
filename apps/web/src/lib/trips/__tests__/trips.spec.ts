import { describe, expect, it } from "vitest";
import { barcodeBars } from "../barcode";
import { DEMO_TRIP, formatAmount } from "../demoTrip";

// The barcode is rendered on the server and hydrated on the client. If its bar
// widths were not a pure function of the value, React would find a different
// SVG on hydration and throw the boarding pass away. These tests are the reason
// `barcodeBars` may never reach for Math.random().
describe("barcodeBars", () => {
  it("returns the same pattern for the same value", () => {
    const a = barcodeBars("GE352-19A-Arthur Fleck");
    const b = barcodeBars("GE352-19A-Arthur Fleck");
    expect(a).toEqual(b);
  });

  it("returns a different pattern for a different value", () => {
    const a = barcodeBars("GE352-19A-Arthur Fleck");
    const b = barcodeBars("GE352-19B-Arthur Fleck");
    expect(a).not.toEqual(b);
  });

  it("emits only positive integer widths inside the drawable range", () => {
    for (const w of barcodeBars(DEMO_TRIP.flight.number)) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(4);
    }
  });

  it("keeps a stable bar count so the aspect ratio does not drift", () => {
    expect(barcodeBars("x")).toHaveLength(116);
  });
});

describe("formatAmount", () => {
  it("always renders two decimal places", () => {
    // 486.2 must not print as "$486.2" on a boarding receipt.
    expect(formatAmount(486.2)).toBe("$486.20");
    expect(formatAmount(1200)).toBe("$1,200.00");
  });
});

describe("DEMO_TRIP", () => {
  it("carries every field the boarding pass renders", () => {
    const { flight, passenger, payment } = DEMO_TRIP;
    for (const v of [
      flight.number,
      flight.aircraft,
      flight.originCode,
      flight.originCity,
      flight.destinationCode,
      flight.destinationCity,
      flight.boardingTime,
      flight.departureTime,
      flight.arrivalTime,
      flight.gate,
      flight.seat,
      passenger.name,
    ]) {
      expect(v).toBeTruthy();
    }
    expect(payment.amount).toBeGreaterThan(0);
    expect(payment.rewardsRate).toBeGreaterThan(0);
  });

  it("keeps the live progress a fraction of the route", () => {
    expect(DEMO_TRIP.live.progress).toBeGreaterThanOrEqual(0);
    expect(DEMO_TRIP.live.progress).toBeLessThanOrEqual(1);
  });
});
