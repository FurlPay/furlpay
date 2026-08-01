import { ApiError, NetworkError } from "../api";
import { FxUnavailable, fetchFxQuote, fxProvenance, rateAgeDays, type FxQuote } from "../fx";

jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  return { ...actual, api: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require("../api") as { api: jest.Mock };

// ---------------------------------------------------------------------------
// The behaviour under test is a refusal.
//
// banking.tsx used to compute its "Indicative rate" row from a literal table
// (EUR 1.09, INR 0.012 — roughly 2024 levels, never updated). The screen's
// PreviewBanner covers execution ("no real money will move") and says nothing
// about the number, so a fabricated rate rendered exactly like a real one.
//
// The fix is not a better table. It is that there is no table: when the server
// cannot price a pair, this module throws and the UI shows the reason.
// ---------------------------------------------------------------------------

const LIVE: FxQuote = {
  from: "USD",
  to: "EUR",
  amountFrom: 100,
  midMarketRate: 0.8571,
  feePct: 0.4,
  feeAmount: 0.4,
  amountTo: 85.37,
  rail: "SEPA Instant",
  savingsVsCompetitorPct: 76,
  source: "live",
  rateDate: "2026-07-31",
};

beforeEach(() => api.mockReset());

describe("fetchFxQuote", () => {
  it("asks for a quote without executing anything", async () => {
    api.mockResolvedValue({ quote: LIVE });
    await fetchFxQuote("USD", "EUR", 100);

    expect(api).toHaveBeenCalledWith("/offramp", {
      method: "POST",
      // `execute: false` is the difference between pricing and moving money.
      body: { fromCurrency: "USD", toCurrency: "EUR", amount: 100, execute: false },
      signal: undefined,
    });
  });

  it("throws rather than inventing a rate when offline", async () => {
    api.mockRejectedValue(new NetworkError("no connection"));
    await expect(fetchFxQuote("USD", "EUR", 100)).rejects.toBeInstanceOf(FxUnavailable);
    await expect(fetchFxQuote("USD", "EUR", 100)).rejects.toMatchObject({ retryable: true });
  });

  it("does not offer a retry for an unsupported pair", async () => {
    // A 400 means the body is wrong; sending it again produces the same 400.
    api.mockRejectedValue(new ApiError(400, "unsupported"));
    await expect(fetchFxQuote("USD", "XXX", 100)).rejects.toMatchObject({ retryable: false });
  });

  it("offers a retry for a server error", async () => {
    api.mockRejectedValue(new ApiError(503, "upstream down"));
    await expect(fetchFxQuote("USD", "EUR", 100)).rejects.toMatchObject({ retryable: true });
  });

  it("rejects a response with no usable rate instead of rendering NaN", async () => {
    api.mockResolvedValue({ quote: { ...LIVE, midMarketRate: undefined } });
    await expect(fetchFxQuote("USD", "EUR", 100)).rejects.toBeInstanceOf(FxUnavailable);
  });
});

describe("rateAgeDays", () => {
  const sunday = new Date("2026-08-02T09:00:00Z");

  it("dates a rate against the publication day", () => {
    // ECB reference rates publish on working days only, so a Friday rate read
    // on Sunday is two days old and is NOT an error.
    expect(rateAgeDays("2026-07-31", sunday)).toBe(2);
    expect(rateAgeDays("2026-08-02", sunday)).toBe(0);
  });

  it("returns null when undated rather than guessing zero", () => {
    expect(rateAgeDays(undefined, sunday)).toBeNull();
    expect(rateAgeDays("not-a-date", sunday)).toBeNull();
  });

  it("never reports a negative age", () => {
    expect(rateAgeDays("2026-08-05", sunday)).toBe(0);
  });
});

describe("fxProvenance", () => {
  it("warns plainly when the rate came from the fallback table", () => {
    const line = fxProvenance({ ...LIVE, source: "reference", rateDate: undefined });
    expect(line).toMatch(/stored reference rate/i);
    expect(line).not.toMatch(/ECB/);
  });

  it("dates a live rate", () => {
    const now = new Date("2026-08-02T09:00:00Z");
    expect(fxProvenance({ ...LIVE, rateDate: "2026-08-02" }, now)).toMatch(/published today/i);
    expect(fxProvenance({ ...LIVE, rateDate: "2026-08-01" }, now)).toMatch(/published yesterday/i);
    expect(fxProvenance({ ...LIVE, rateDate: "2026-07-31" }, now)).toMatch(/2 days ago/i);
  });

  it("always says the rate is indicative", () => {
    // The ECB publishes these for information only and discourages using them
    // for transactions. The UI must never imply this is the dealt price.
    const now = new Date("2026-08-02T09:00:00Z");
    for (const date of ["2026-08-02", "2026-07-31", undefined]) {
      expect(fxProvenance({ ...LIVE, rateDate: date }, now)).toMatch(/indicative|not a dealt rate/i);
    }
  });
});
