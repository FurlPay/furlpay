// quoteFx against a failing / slow / malformed rate provider. The live
// provider is Frankfurter (ECB); when it cannot answer, the quote falls back to
// the reference table and SAYS so (`source: "reference"`). No real network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realFetch = globalThis.fetch;
let fx: typeof import("../fx");

beforeEach(async () => {
  vi.resetModules(); // the module caches rates per base; start clean each time
  fx = await import("../fx");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("quoteFx", () => {
  it("uses the live rate when the provider answers", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([{ date: "2026-10-06", base: "USD", quote: "EUR", rate: 0.9 }]))
    ) as never;
    const q = await fx.quoteFx("USD", "EUR", 100);
    expect(q.source).toBe("live");
    expect(q.midMarketRate).toBe(0.9);
    expect(q.rateDate).toBe("2026-10-06");
    expect(q.amountTo).toBeCloseTo((100 - 0.4) * 0.9, 2);
  });

  it("falls back to the reference rate, labelled, on provider HTTP failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as never;
    const q = await fx.quoteFx("USD", "EUR", 100);
    expect(q.source).toBe("reference");
    expect(q.midMarketRate).toBeGreaterThan(0);
  });

  it("falls back on a malformed provider response", async () => {
    for (const body of ['{"rates":{"EUR":0.9}}', "[]", '[{"quote":"EUR"}]', "not json"]) {
      vi.resetModules();
      fx = await import("../fx");
      globalThis.fetch = vi.fn(async () => new Response(body)) as never;
      const q = await fx.quoteFx("USD", "EUR", 100);
      expect(q.source).toBe("reference");
    }
  });

  it("falls back when the provider is unreachable (network error / missing config)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as never;
    expect((await fx.quoteFx("USD", "EUR", 100)).source).toBe("reference");
  });

  it("falls back when the provider hangs past its 4 s timeout", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))
    ) as never;
    const p = fx.quoteFx("USD", "EUR", 100);
    await vi.advanceTimersByTimeAsync(4_100);
    expect((await p).source).toBe("reference");
  });

  it("knows which currencies it can price", () => {
    expect(fx.isSupportedFxCurrency("USD")).toBe(true);
    expect(fx.isSupportedFxCurrency("EUR")).toBe(true);
    expect(fx.isSupportedFxCurrency("XYZ")).toBe(false);
    expect(fx.isSupportedFxCurrency("constructor")).toBe(false); // no prototype keys
  });
});
