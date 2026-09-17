import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CctpFeeUnavailableError,
  FAST_FINALITY_THRESHOLD,
  STANDARD_FINALITY_THRESHOLD,
  bpsToAtomic,
  clearCctpFeeCache,
  fetchCctpFee,
} from "../services/cctpFees";
import { quoteCctp } from "../services/cctp";
import { buildBurnBundle } from "../services/cctpExecution";

// ---------------------------------------------------------------------------
// Circle's real CCTP fee, and the refusal that replaces the old guess.
//
// quoteCctp used to price Fast Transfer at a flat `amount * 0.0001` (1bp) and
// buildBurnBundle derived its on-chain `maxFee` ceiling from the same number.
// Circle's published fees, read 2026-09-17:
//
//   ethereum -> arbitrum  1.0 bps      polygon  -> base      0.0 bps
//   arbitrum -> base      1.4 bps      base     -> arbitrum  1.3 bps
//
// So the guess was wrong on most corridors. The quote error was cosmetic; the
// maxFee error was not. `maxFee` is the ceiling the payer authorises and Circle
// grants Fast Transfer only when it covers the real fee — a 1bp ceiling in a
// 1.4bp corridor silently drops to the ~15-minute standard path after the user
// was quoted 20 seconds.
//
// Every test here uses a stubbed fetch returning Circle's real response shape.
// The behaviour that matters most is the REFUSAL: no readable fee must never
// become an assumed fee.
// ---------------------------------------------------------------------------

/** Circle's actual response body shape. */
function feeBody(fastBps: number, standardBps = 0) {
  return JSON.stringify([
    { finalityThreshold: FAST_FINALITY_THRESHOLD, minimumFee: fastBps },
    { finalityThreshold: STANDARD_FINALITY_THRESHOLD, minimumFee: standardBps },
  ]);
}

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function ok(body: string): Promise<Response> {
  return Promise.resolve(
    new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  );
}

beforeEach(() => clearCctpFeeCache());
afterEach(() => {
  vi.unstubAllGlobals();
  clearCctpFeeCache();
});

describe("bpsToAtomic", () => {
  it("handles a fractional rate exactly", () => {
    // 1.4bps of 1,000 USDC = 0.14 USDC = 140000 atomic.
    expect(bpsToAtomic(1_000_000_000n, 1.4)).toBe(140_000n);
  });

  it("returns zero for a free corridor", () => {
    expect(bpsToAtomic(1_000_000_000n, 0)).toBe(0n);
  });

  it("rounds UP, never down", () => {
    // 1.4bps of 0.001 USDC is 0.00000014 — below USDC precision. Rounding down
    // would authorise a zero ceiling and lose the Fast Transfer; round up to
    // the smallest representable unit instead.
    expect(bpsToAtomic(1_000n, 1.4)).toBe(1n);
  });

  it("never under-charges across a sweep of amounts", () => {
    for (const amount of [1n, 999n, 1_000_000n, 123_456_789n]) {
      const exact = (Number(amount) * 1.4) / 10_000;
      expect(Number(bpsToAtomic(amount, 1.4))).toBeGreaterThanOrEqual(exact);
    }
  });
});

describe("fetchCctpFee reads Circle's published rate", () => {
  it("parses the fast and standard rows", async () => {
    stubFetch(() => ok(feeBody(1.4)));
    const fee = await fetchCctpFee(3, 6);
    expect(fee.fastBps).toBe(1.4);
    expect(fee.standardBps).toBe(0);
  });

  it("requests the corridor by domain id", async () => {
    const spy = vi.fn(() => ok(feeBody(1)));
    stubFetch(spy);
    await fetchCctpFee(0, 3);
    expect(String(spy.mock.calls[0][0])).toContain("/v2/burn/USDC/fees/0/3");
  });

  it("caches within the TTL rather than refetching per quote", async () => {
    const spy = vi.fn(() => ok(feeBody(1.4)));
    stubFetch(spy);
    await fetchCctpFee(3, 6);
    await fetchCctpFee(3, 6);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("caches per corridor, not globally", async () => {
    const spy = vi.fn(() => ok(feeBody(1.4)));
    stubFetch(spy);
    await fetchCctpFee(3, 6);
    await fetchCctpFee(6, 3);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("accepts a genuinely free corridor", async () => {
    // polygon -> base really is 0bps. Zero must survive as zero.
    stubFetch(() => ok(feeBody(0)));
    const fee = await fetchCctpFee(7, 6);
    expect(fee.fastBps).toBe(0);
  });
});

describe("fetchCctpFee fails closed — it never invents a rate", () => {
  it("throws when Iris is unreachable", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(fetchCctpFee(3, 6)).rejects.toBeInstanceOf(CctpFeeUnavailableError);
  });

  it("throws on a non-200", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 503 })));
    await expect(fetchCctpFee(3, 6)).rejects.toThrow(/503/);
  });

  it("throws on a non-JSON body", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>nope</html>", { status: 200 })));
    await expect(fetchCctpFee(3, 6)).rejects.toBeInstanceOf(CctpFeeUnavailableError);
  });

  it("throws when the fast row is missing — absence is not zero", async () => {
    // The single most important case. "I could not read the fee" and "the fee
    // is zero" must never collapse into the same value, or a missing row
    // reinstates exactly the free-transfer assumption this module removed.
    stubFetch(() =>
      ok(JSON.stringify([{ finalityThreshold: STANDARD_FINALITY_THRESHOLD, minimumFee: 0 }]))
    );
    await expect(fetchCctpFee(3, 6)).rejects.toThrow(/fast-transfer row/);
  });

  it("throws on a negative fee", async () => {
    stubFetch(() => ok(feeBody(-1)));
    await expect(fetchCctpFee(3, 6)).rejects.toThrow(/negative/);
  });

  it("does not cache a failure as a rate", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("boom")) : ok(feeBody(1.4));
    });
    await expect(fetchCctpFee(3, 6)).rejects.toThrow();
    const fee = await fetchCctpFee(3, 6);
    expect(fee.fastBps).toBe(1.4);
  });
});

describe("quoteCctp prices from the real rate", () => {
  it("charges the corridor's actual fee, not a flat 1bp", async () => {
    stubFetch(() => ok(feeBody(1.4)));
    const q = await quoteCctp({ fromChain: "arbitrum", toChain: "base", amount: 1000 });
    // 1.4bps of 1000 = 0.14. The old hardcoded 1bp would have said 0.10.
    expect(q.feeUsd).toBe(0.14);
    expect(q.feeBps).toBe(1.4);
    expect(q.amountOut).toBe(999.86);
  });

  it("charges nothing on a free corridor", async () => {
    stubFetch(() => ok(feeBody(0)));
    const q = await quoteCctp({ fromChain: "polygon", toChain: "base", amount: 1000 });
    expect(q.feeUsd).toBe(0);
    expect(q.amountOut).toBe(1000);
  });

  it("standard mode is free and says so", async () => {
    stubFetch(() => ok(feeBody(1.4, 0)));
    const q = await quoteCctp({ fromChain: "arbitrum", toChain: "base", amount: 1000, fast: false });
    expect(q.mode).toBe("standard");
    expect(q.feeUsd).toBe(0);
  });

  it("refuses to quote when the fee cannot be read", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(
      quoteCctp({ fromChain: "arbitrum", toChain: "base", amount: 1000 })
    ).rejects.toBeInstanceOf(CctpFeeUnavailableError);
  });
});

describe("buildBurnBundle authorises a ceiling that covers the real fee", () => {
  it("sets maxFee above the corridor's actual fee (regression: 1bp ceiling)", async () => {
    stubFetch(() => ok(feeBody(1.4)));
    const bundle = await buildBurnBundle({
      sourceChain: "arbitrum",
      destinationChain: "base",
      amount: 1000,
      recipient: "0x1111111111111111111111111111111111111111",
    });
    const expectedFee = 140_000n; // 1.4bps of 1000 USDC, atomic
    const oldHardcodedCeiling = 100_000n; // amountAtomic / 10_000

    expect(BigInt(bundle.feeAtomic)).toBe(expectedFee);
    expect(bundle.feeBps).toBe(1.4);
    // The ceiling must cover the real fee — the old one did not.
    expect(BigInt(bundle.maxFeeAtomic)).toBeGreaterThanOrEqual(expectedFee);
    expect(oldHardcodedCeiling).toBeLessThan(expectedFee);
  });

  it("keeps the buffer proportionate rather than open-ended", async () => {
    stubFetch(() => ok(feeBody(1.4)));
    const bundle = await buildBurnBundle({
      sourceChain: "arbitrum",
      destinationChain: "base",
      amount: 1000,
      recipient: "0x1111111111111111111111111111111111111111",
    });
    // 20% headroom: expected 0.14 USDC, ceiling 0.168 USDC.
    expect(BigInt(bundle.maxFeeAtomic)).toBe(168_000n);
  });

  it("passes maxFee 0 for a standard transfer", async () => {
    stubFetch(() => ok(feeBody(1.4)));
    const bundle = await buildBurnBundle({
      sourceChain: "arbitrum",
      destinationChain: "base",
      amount: 1000,
      recipient: "0x1111111111111111111111111111111111111111",
      fast: false,
    });
    expect(bundle.maxFeeAtomic).toBe("0");
    expect(bundle.feeAtomic).toBe("0");
    expect(bundle.mode).toBe("standard");
  });

  it("refuses to build a burn when the fee cannot be read", async () => {
    // No readable fee means no honest ceiling, so there is nothing safe to
    // submit. Refuse rather than fall back to the old guess.
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(
      buildBurnBundle({
        sourceChain: "arbitrum",
        destinationChain: "base",
        amount: 1000,
        recipient: "0x1111111111111111111111111111111111111111",
      })
    ).rejects.toBeInstanceOf(CctpFeeUnavailableError);
  });
});
