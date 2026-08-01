import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The failure this suite exists to catch is SILENT.
//
// Frankfurter v2 answers /rates with a flat array of { date, base, quote, rate }
// records. v1 answered with { rates: { EUR: 0.9 }, date }. Reading the v2 body
// with the v1 parser does not throw and does not log: `json.rates` is undefined,
// liveRate returns null, and every quote falls through to the hand-written
// REFERENCE_MID table — which still produces a confident-looking number, just a
// stale one, on a route that prices money movement.
//
// So the assertions below are about SHAPE and PROVENANCE, not arithmetic.
// ---------------------------------------------------------------------------

const V2_ROWS = [
  { date: "2026-07-31", base: "USD", quote: "EUR", rate: 0.8571 },
  { date: "2026-07-31", base: "USD", quote: "GBP", rate: 0.7442 },
  { date: "2026-07-31", base: "USD", quote: "BRL", rate: 5.0583 },
];

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as unknown as Response);
}

/** Fresh module per test — `quoteFx` memoises rates in a module-level cache. */
async function loadFx() {
  vi.resetModules();
  return import("../services/fx");
}

describe("quoteFx", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(V2_ROWS));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the v2 array body and reports a live source", async () => {
    const { quoteFx } = await loadFx();
    const quote = await quoteFx("USD", "EUR", 100);

    expect(quote.source).toBe("live");
    expect(quote.midMarketRate).toBe(0.8571);
    // Publication date, not fetch time — the client uses it to say how old the
    // rate is, which is the whole point of surfacing it.
    expect(quote.rateDate).toBe("2026-07-31");
  });

  it("requests the ECB provider explicitly", async () => {
    const { quoteFx } = await loadFx();
    await quoteFx("USD", "EUR", 100);

    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    // v2 defaults to a rate BLENDED across ~84 central banks. Without this the
    // service quietly stops returning the ECB reference series it documents and
    // that REFERENCE_MID is denominated against.
    expect(url).toContain("providers=ecb");
    expect(url).toContain("/v2/rates");
    // v1's `symbols` was renamed to `quotes` in v2; the old name is ignored,
    // which would silently fetch every currency instead of erroring.
    expect(url).toContain("quotes=");
    expect(url).not.toContain("symbols=");
  });

  it("keeps the publication date on a cache hit", async () => {
    const { quoteFx } = await loadFx();
    await quoteFx("USD", "EUR", 100);
    const second = await quoteFx("USD", "GBP", 100);

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(second.source).toBe("live");
    // Regression: the cache used to store only the rates, so the second quote
    // came back undated and read as "no publication date" to the client.
    expect(second.rateDate).toBe("2026-07-31");
  });

  it("falls back and SAYS SO when the rate API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { quoteFx } = await loadFx();
    const quote = await quoteFx("USD", "EUR", 100);

    // The fallback is allowed to exist; it is not allowed to be indistinguishable
    // from a live rate. Clients gate their copy on this field.
    expect(quote.source).toBe("reference");
    expect(quote.rateDate).toBeUndefined();
  });

  it("treats a v1-shaped body as a miss rather than a rate", async () => {
    // If the endpoint ever answers in the old shape, the correct outcome is a
    // labelled fallback — never a confident number parsed out of a body we did
    // not understand.
    vi.stubGlobal("fetch", mockFetch({ rates: { EUR: 0.8571 }, date: "2026-07-31" }));
    const { quoteFx } = await loadFx();
    const quote = await quoteFx("USD", "EUR", 100);

    expect(quote.source).toBe("reference");
  });

  it("does not cache an empty result into the next ten minutes", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    const { quoteFx } = await loadFx();

    const first = await quoteFx("USD", "EUR", 100);
    expect(first.source).toBe("reference");

    // A cached empty body would pin the fallback in place even after the API
    // recovered.
    vi.stubGlobal("fetch", mockFetch(V2_ROWS));
    const second = await quoteFx("USD", "EUR", 100);
    expect(second.source).toBe("live");
  });

  it("falls back for a pair the ECB does not publish", async () => {
    // The ECB has no AED series, so it is absent from the response even on a
    // fully successful call. That is a miss, not a failure.
    const { quoteFx } = await loadFx();
    const quote = await quoteFx("USD", "AED", 100);

    expect(quote.source).toBe("reference");
  });

  it("charges the fee before converting, not after", async () => {
    const { quoteFx } = await loadFx();
    const quote = await quoteFx("USD", "EUR", 100);

    expect(quote.feeAmount).toBeCloseTo(0.4, 6);
    expect(quote.amountTo).toBeCloseTo((100 - 0.4) * 0.8571, 2);
  });
});
