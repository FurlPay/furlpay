// Bank fee comparison — the numbers that go on a public page naming real banks.
//
// These tests exist as much for legal defensibility as for correctness. The
// spec this was built from asserted "CommBank: 3.5% + $30 wire", which is
// wrong in FurlPay's favour on both halves. The cases below pin the VERIFIED
// figures so a future edit cannot quietly restore the flattering ones.

import { describe, it, expect } from "vitest";
import {
  calculateTransferComparison,
  ComparisonInputError,
  ESTIMATE_DISCLOSURE,
  marginBpsFor,
  PROVIDERS,
} from "@/lib/calculators/bankFeeComparison";

/** Indicative AUD->USD. Supplied by the caller; never hardcoded in the lib. */
const AUD_USD = 0.67;

function compare(over: Partial<Parameters<typeof calculateTransferComparison>[0]> = {}) {
  return calculateTransferComparison({
    amount: 5000,
    fromCurrency: "AUD",
    toCurrency: "USD",
    referenceRate: AUD_USD,
    ...over,
  });
}

describe("the corrections that matter", () => {
  it("charges CommBank NOTHING upfront online — not the $30 the brief claimed", () => {
    // CBA waived the online IMT fee in June 2023. $30 is in-branch only, and
    // publishing it as the online price would be false advertising.
    const cba = compare().providers.find((p) => p.id === "cba")!;
    expect(cba.upfrontFee).toBe(0);
  });

  it("still applies $30 in branch, where it is real", () => {
    const cba = compare({ channel: "branch" }).providers.find((p) => p.id === "cba")!;
    expect(cba.upfrontFee).toBe(30);
  });

  it("charges Westpac $0 to send foreign currency online but $20 to send AUD", () => {
    const foreign = compare({ sendCurrencyMode: "foreign" }).providers.find((p) => p.id === "westpac")!;
    const aud = compare({ sendCurrencyMode: "aud" }).providers.find((p) => p.id === "westpac")!;
    expect(foreign.upfrontFee).toBe(0);
    expect(aud.upfrontFee).toBe(20);
  });

  it("waives the ANZ $9 above A$10,000", () => {
    const under = compare({ amount: 5000 }).providers.find((p) => p.id === "anz")!;
    const over = compare({ amount: 20_000 }).providers.find((p) => p.id === "anz")!;
    expect(under.upfrontFee).toBe(9);
    expect(over.upfrontFee).toBe(0);
  });

  it("omits a provider entirely for a channel it does not offer", () => {
    // Wise has no branch. A $0 branch fee would render "free in branch",
    // which is a service it does not sell.
    const branch = compare({ channel: "branch" });
    expect(branch.providers.find((p) => p.id === "wise")).toBeUndefined();
  });
});

describe("FX margin varies by corridor, not just by bank", () => {
  it("prices CommBank differently to USD than to GBP", () => {
    // ~2.5% AUD->USD vs ~3.2% AUD->GBP. One number per bank would be wrong by
    // 0.7pp — $140 on a $20,000 transfer.
    const cba = PROVIDERS.find((p) => p.id === "cba")!;
    expect(marginBpsFor(cba.margin, "AUD", "USD")).toBe(250);
    expect(marginBpsFor(cba.margin, "AUD", "GBP")).toBe(320);
  });

  it("falls back to the bank default for an unsampled corridor", () => {
    const cba = PROVIDERS.find((p) => p.id === "cba")!;
    expect(marginBpsFor(cba.margin, "AUD", "SGD")).toBe(320);
  });

  it("is case-insensitive about currency codes", () => {
    const anz = PROVIDERS.find((p) => p.id === "anz")!;
    expect(marginBpsFor(anz.margin, "aud", "usd")).toBe(310);
  });

  it("flows the corridor margin into the spread charged", () => {
    const toUsd = compare({ toCurrency: "USD" }).providers.find((p) => p.id === "cba")!;
    const toGbp = compare({ toCurrency: "GBP" }).providers.find((p) => p.id === "cba")!;
    expect(toUsd.fxSpreadFee).toBe(125); // 5000 * 2.50%
    expect(toGbp.fxSpreadFee).toBe(160); // 5000 * 3.20%
  });
});

describe("FurlPay's own numbers are held to the same standard", () => {
  it("charges network gas rather than claiming zero fees", () => {
    // "$0 fees" would be the same sin this file exists to avoid, aimed inward.
    const fp = compare().furlpay;
    expect(fp.upfrontFee).toBeGreaterThan(0);
    expect(fp.fxSpreadFee).toBe(0);
    expect(fp.totalFees).toBe(0.01);
  });

  it("marks its own gas estimate as an estimate", () => {
    expect(compare().furlpay.fxConfidence).toBe("estimated");
  });
});

describe("savings framing", () => {
  it("computes savings against CommBank on the same channel", () => {
    const r = compare();
    const cba = r.providers.find((p) => p.id === "cba")!;
    expect(r.furlpay.savingsVsCba).toBe(Number((cba.totalFees - r.furlpay.totalFees).toFixed(2)));
    expect(r.furlpay.savingsVsCba).toBeGreaterThan(0);
  });

  it("expresses percentage saved as a share of the BANK'S FEES, not of the transfer", () => {
    // "You save 99%" unqualified reads as 99% of the money sent. It is 99% of
    // what the bank would have taken.
    const r = compare();
    expect(r.furlpay.percentageSaved).toBeGreaterThan(90);
    expect(r.furlpay.percentageSaved).toBeLessThanOrEqual(100);
  });

  it("holds across transfer sizes", () => {
    for (const amount of [100, 5000, 50_000]) {
      const r = compare({ amount });
      const cba = r.providers.find((p) => p.id === "cba")!;
      expect(cba.totalFees).toBeGreaterThan(r.furlpay.totalFees);
      expect(r.furlpay.recipientGets).toBeGreaterThan(cba.recipientGets);
    }
  });
});

describe("same-currency transfers take no spread from anyone", () => {
  it("zeroes every FX spread when no conversion happens", () => {
    const r = compare({ fromCurrency: "AUD", toCurrency: "AUD", referenceRate: 1 });
    for (const p of r.providers) {
      expect(p.fxSpreadFee).toBe(0);
      expect(p.fxMarginBps).toBe(0);
    }
    expect(r.furlpay.fxSpreadFee).toBe(0);
    // The wire fee still applies — only the conversion disappears.
    const westpac = r.providers.find((p) => p.id === "westpac")!;
    expect(westpac.upfrontFee).toBe(20);
  });
});

describe("transparency contract", () => {
  it("marks every bank FX figure as estimated, never published", () => {
    for (const p of compare().providers) {
      if (p.id === "wise") continue; // Wise publishes its fee
      expect(p.fxConfidence).toBe("estimated");
    }
  });

  it("flags the whole result when estimates were used", () => {
    expect(compare().containsEstimates).toBe(true);
  });

  it("carries a dated source url on every provider", () => {
    for (const p of compare().providers) {
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.notes.length).toBeGreaterThan(0);
    }
  });

  it("ships a disclosure string a page can render verbatim", () => {
    expect(ESTIMATE_DISCLOSURE).toMatch(/estimated/i);
    expect(ESTIMATE_DISCLOSURE).toMatch(/not a quote|not quotes/i);
  });

  it("never lets recipientGets go negative on a tiny transfer", () => {
    const r = compare({ amount: 1, channel: "branch" });
    for (const p of r.providers) expect(p.recipientGets).toBeGreaterThanOrEqual(0);
  });
});

describe("input validation", () => {
  it("throws on a non-positive or non-finite amount", () => {
    for (const amount of [0, -1, NaN, Infinity]) {
      expect(() => compare({ amount })).toThrow(ComparisonInputError);
    }
  });

  it("throws rather than defaulting a missing reference rate", () => {
    // A stale rate baked into the library would silently change every number
    // on the page, so there is no default to fall back to.
    for (const referenceRate of [0, -1, NaN]) {
      expect(() => compare({ referenceRate })).toThrow(ComparisonInputError);
    }
  });
});
