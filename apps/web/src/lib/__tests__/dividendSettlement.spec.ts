import { describe, expect, it } from "vitest";
import {
  DEFAULT_WITHHOLDING_RATE,
  settleDividends,
  withholdingRateFor,
} from "@/lib/corporateActions/dividends";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

const USER = "u1";

function lot(over: Partial<TradeLot> = {}): TradeLot {
  return {
    id: "lot_1",
    userId: USER,
    symbol: "AAPL",
    quantity: 100,
    costBasis: 15_000,
    acquiredAt: "2025-01-01T00:00:00Z",
    status: "open",
    provenance: "execution",
    ...over,
  };
}

function dividend(over: Partial<CorporateAction> = {}): CorporateAction {
  return {
    id: "ca_div",
    symbol: "AAPL",
    type: "cash_dividend",
    amountPerShare: 1,
    effectiveDate: "2026-02-01T00:00:00Z", // ex-date
    recordDate: "2026-02-03T00:00:00Z",
    paymentDate: "2026-02-15T00:00:00Z",
    source: "manual",
    confidence: "confirmed",
    ...over,
  };
}

const AFTER_PAYMENT = new Date("2026-03-01T00:00:00Z");
const NONE = new Set<string>();

describe("withholdingRateFor", () => {
  it("applies treaty rates by residency", () => {
    expect(withholdingRateFor("US")).toBe(0);
    expect(withholdingRateFor("IN")).toBe(0.25);
    expect(withholdingRateFor("gb")).toBe(0.15); // case-insensitive
  });

  it("falls back to the full statutory rate for unknown or missing residency", () => {
    // Under-withholding leaves the platform owing the difference; over-
    // withholding is refundable. Unknown must round toward the safe side.
    expect(withholdingRateFor(undefined)).toBe(DEFAULT_WITHHOLDING_RATE);
    expect(withholdingRateFor(null)).toBe(DEFAULT_WITHHOLDING_RATE);
    expect(withholdingRateFor("ZZ")).toBe(DEFAULT_WITHHOLDING_RATE);
  });
});

describe("settleDividends — payment date gating", () => {
  it("does not pay before the payment date", () => {
    // Record date has passed, so the entitlement is fixed — but the cash does
    // not exist yet. Paying here inflates a balance the holder cannot spend.
    const r = settleDividends(USER, [lot()], [dividend()], NONE, {
      asOf: new Date("2026-02-10T00:00:00Z"),
      residency: "US",
    });
    expect(r.events).toHaveLength(0);
    expect(r.cashToCredit).toBe(0);
  });

  it("pays once the payment date has arrived", () => {
    const r = settleDividends(USER, [lot()], [dividend()], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(r.events).toHaveLength(1);
    expect(r.cashToCredit).toBe(100); // 100 shares × $1, no withholding
  });

  it("falls back to the ex-date when no payment date is given", () => {
    const noPayDate = dividend({ paymentDate: undefined });
    const early = settleDividends(USER, [lot()], [noPayDate], NONE, {
      asOf: new Date("2026-01-15T00:00:00Z"),
      residency: "US",
    });
    expect(early.events).toHaveLength(0);
  });
});

describe("settleDividends — idempotency", () => {
  it("skips an action already settled for this user", () => {
    const already = new Set(["ca_div"]);
    const r = settleDividends(USER, [lot()], [dividend()], already, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(r.events).toHaveLength(0);
    expect(r.cashToCredit).toBe(0);
    expect(r.skipped).toEqual(["ca_div"]);
  });

  it("a second run after recording the first pays nothing more", () => {
    const lots = [lot()];
    const actions = [dividend()];
    const first = settleDividends(USER, lots, actions, NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    // Simulate persisting the first run, then re-running the same job.
    const settled = new Set(first.events.map((e) => e.corporateActionId));
    const second = settleDividends(USER, lots, actions, settled, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(first.cashToCredit).toBe(100);
    expect(second.cashToCredit).toBe(0);
  });

  it("does not double-pay a duplicated action row", () => {
    // A retried ingest can deliver the same action twice; usableActions dedupes.
    const r = settleDividends(USER, [lot()], [dividend(), dividend()], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(r.events).toHaveLength(1);
    expect(r.cashToCredit).toBe(100);
  });

  it("ignores a superseded announcement in favour of its correction", () => {
    const original = dividend({ id: "ca_v1", amountPerShare: 1 });
    const corrected = dividend({ id: "ca_v2", amountPerShare: 1.5, supersedes: "ca_v1" });
    const r = settleDividends(USER, [lot()], [original, corrected], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(r.events).toHaveLength(1);
    expect(r.cashToCredit).toBe(150); // the corrected amount, paid once
  });
});

describe("settleDividends — withholding", () => {
  it("credits the NET, not the gross", () => {
    const r = settleDividends(USER, [lot()], [dividend()], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "IN", // 25%
    });
    const e = r.events[0];
    expect(e.grossAmount).toBe(100);
    expect(e.withholdingTax).toBe(25);
    expect(e.netAmount).toBe(75);
    // Crediting gross would overstate the balance by the tax withheld.
    expect(r.cashToCredit).toBe(75);
    expect(r.totalWithheld).toBe(25);
  });

  it("INVARIANT: gross always equals net plus withholding", () => {
    for (const residency of ["US", "IN", "GB", "JP", "ZZ", undefined]) {
      const r = settleDividends(USER, [lot()], [dividend()], NONE, {
        asOf: AFTER_PAYMENT,
        residency,
      });
      const e = r.events[0];
      expect(e.netAmount + e.withholdingTax).toBeCloseTo(e.grossAmount, 2);
    }
  });
});

describe("settleDividends — record-date position", () => {
  it("does not pay shares bought after the record date", () => {
    const late = [lot({ id: "late", acquiredAt: "2026-02-10T00:00:00Z" })];
    const r = settleDividends(USER, late, [dividend()], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    expect(r.events).toHaveLength(0);
  });

  it("pays on the SPLIT-ADJUSTED count when a split preceded the record date", () => {
    const split: CorporateAction = {
      id: "ca_split",
      symbol: "AAPL",
      type: "stock_split",
      ratio: 2,
      effectiveDate: "2026-01-15T00:00:00Z", // before the record date
      source: "manual",
      confidence: "confirmed",
    };
    const r = settleDividends(USER, [lot()], [split, dividend()], NONE, {
      asOf: AFTER_PAYMENT,
      residency: "US",
    });
    // 100 shares became 200 before the record date.
    expect(r.events[0].sharesHeld).toBe(200);
    expect(r.cashToCredit).toBe(200);
  });

  it("a LATER split does not inflate an earlier dividend", () => {
    const split: CorporateAction = {
      id: "ca_split",
      symbol: "AAPL",
      type: "stock_split",
      ratio: 2,
      effectiveDate: "2026-06-01T00:00:00Z", // AFTER the record date
      source: "manual",
      confidence: "confirmed",
    };
    const r = settleDividends(USER, [lot()], [split, dividend()], NONE, {
      asOf: new Date("2026-07-01T00:00:00Z"),
      residency: "US",
    });
    expect(r.events[0].sharesHeld).toBe(100);
    expect(r.cashToCredit).toBe(100);
  });
});

describe("settleDividends — DRIP", () => {
  const dripOpts = {
    asOf: AFTER_PAYMENT,
    residency: "US" as const,
    drip: true,
    dripPrice: (s: string) => (s === "AAPL" ? 200 : undefined),
  };

  it("creates a lot instead of crediting cash", () => {
    const r = settleDividends(USER, [lot()], [dividend()], NONE, dripOpts);
    expect(r.cashToCredit).toBe(0); // reinvested, not paid out
    expect(r.dripLots).toHaveLength(1);
    expect(r.dripLots[0].quantity).toBeCloseTo(0.5, 8); // $100 / $200
    expect(r.events[0].status).toBe("reinvested");
    expect(r.events[0].dripLotId).toBe(r.dripLots[0].id);
  });

  it("bases the DRIP lot on the NET cash reinvested, not the gross", () => {
    const r = settleDividends(USER, [lot()], [dividend()], NONE, {
      ...dripOpts,
      residency: "IN", // 25% withheld → only $75 is actually reinvested
    });
    expect(r.dripLots[0].costBasis).toBe(75);
    expect(r.dripLots[0].quantity).toBeCloseTo(0.375, 8);
  });

  it("starts a NEW holding period — a DRIP is a purchase, not an adjustment", () => {
    const r = settleDividends(USER, [lot()], [dividend()], NONE, dripOpts);
    // Unlike a split or merger the holding period does NOT tack back to the
    // parent lot; these are newly bought shares.
    expect(r.dripLots[0].acquiredAt).toBe("2026-02-15T00:00:00.000Z");
    expect(r.dripLots[0].provenance).toBe("corporate_action");
  });

  it("falls back to cash when no reinvestment price is available", () => {
    // Without a price, share count and basis would both be fiction.
    const r = settleDividends(USER, [lot({ symbol: "OBSCURE" })], [dividend({ symbol: "OBSCURE" })], NONE, dripOpts);
    expect(r.dripLots).toHaveLength(0);
    expect(r.cashToCredit).toBe(100);
    expect(r.events[0].status).toBe("paid");
  });
});
