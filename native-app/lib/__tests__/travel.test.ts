import { CASHBACK_RATE, quoteStay, TRAVEL_RATES } from "../travel";

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
