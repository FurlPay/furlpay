import { CASHBACK_RATE, quoteStay, TRAVEL_RATES } from "../travel";

// The native checkout must authorize the SAME amount the web checkout would
// for the same room — quoteStay mirrors apps/web/src/app/travel/checkout/
// page.tsx line for line. These fixtures are computed by that web math.

describe("quoteStay — web checkout parity", () => {
  it("10% taxes, 2% cashback off (rate + taxes), rounded to cents at each step", () => {
    // $540 room (the web checkout's own fallback amount)
    expect(quoteStay(540)).toEqual({ taxes: 54, cashback: 11.88, totalUsd: 582.12 });
  });

  it("survives an awkward floating-point rate", () => {
    const { taxes, cashback, totalUsd } = quoteStay(333.33);
    expect(taxes).toBe(33.33);
    expect(cashback).toBe(7.33); // round(366.66 * 0.02 * 100)/100
    expect(totalUsd).toBe(359.33);
    // Every figure is a clean cents value — no 359.33000000000004 on an invoice.
    for (const v of [taxes, cashback, totalUsd]) {
      expect(Math.round(v * 100) / 100).toBe(v);
    }
  });

  it("cashback actually reduces the total by the advertised 2%", () => {
    const { taxes, cashback } = quoteStay(1000);
    expect(cashback).toBe(Math.round((1000 + taxes) * CASHBACK_RATE * 100) / 100);
  });

  it("display FX table matches the web RATES", () => {
    expect(TRAVEL_RATES.USDC).toBe(1);
    expect(TRAVEL_RATES.SOL).toBeCloseTo(1 / 175);
    expect(TRAVEL_RATES.BTC).toBeCloseTo(1 / 96000);
  });
});
