import { describe, expect, it, beforeEach } from "vitest";
import {
  MAX_SLIPPAGE_PCT,
  QUOTE_TTL_SECONDS,
  issueQuote,
  redeemQuote,
} from "../services/swapQuote";
import type { SwapQuote } from "../services/swap";
import { SwapSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Server-issued swap quotes.
//
// The property under test: a swap settles at the price the server issued, or
// it does not settle. Before quoteId existed, /api/swaps re-quoted at
// execution time, so the price on the confirm screen and the price that
// settled were two independent reads of a moving market with a biometric
// prompt in between.
//
// These run against the kv in-memory fallback (NODE_ENV is "test", so
// assertDurableBackend permits it).
// ---------------------------------------------------------------------------

const ALICE = "user_alice";
const BOB = "user_bob";

function quote(overrides: Partial<SwapQuote> = {}): SwapQuote {
  return {
    fromToken: "USDT",
    toToken: "USDC",
    fromChain: "arbitrum",
    toChain: "arbitrum",
    amountIn: 100,
    amountOut: 99.95,
    slippagePct: 0.05,
    gasUsd: 0.004,
    feeUsd: 0,
    route: ["USDT→USDC on arbitrum"],
    etaSeconds: 4,
    source: "lifi",
    ...overrides,
  };
}

describe("issueQuote", () => {
  it("returns an id and an expiry matching the TTL", async () => {
    const issued = await issueQuote(ALICE, quote());
    expect(issued.quoteId).toMatch(/^[0-9a-f-]{36}$/);
    const ttlMs = Date.parse(issued.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan((QUOTE_TTL_SECONDS - 5) * 1000);
    expect(ttlMs).toBeLessThanOrEqual(QUOTE_TTL_SECONDS * 1000);
  });

  it("gives every quote a distinct id", async () => {
    const a = await issueQuote(ALICE, quote());
    const b = await issueQuote(ALICE, quote());
    expect(a.quoteId).not.toBe(b.quoteId);
  });
});

describe("redeemQuote", () => {
  it("returns the exact quote that was issued, not a fresh price", async () => {
    const issued = await issueQuote(ALICE, quote({ amountOut: 42.5, slippagePct: 0.31 }));
    const redeemed = await redeemQuote(ALICE, issued.quoteId);
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(redeemed.quote.amountOut).toBe(42.5);
    expect(redeemed.quote.slippagePct).toBe(0.31);
  });

  it("is single-use — a replayed id cannot settle twice", async () => {
    const issued = await issueQuote(ALICE, quote());
    expect((await redeemQuote(ALICE, issued.quoteId)).ok).toBe(true);

    const replay = await redeemQuote(ALICE, issued.quoteId);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("already_used");
  });

  it("settles only ONE of two executions racing the same id", async () => {
    // Read-then-delete would let both of these through.
    const issued = await issueQuote(ALICE, quote());
    const results = await Promise.all([
      redeemQuote(ALICE, issued.quoteId),
      redeemQuote(ALICE, issued.quoteId),
      redeemQuote(ALICE, issued.quoteId),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses an id issued to a different user", async () => {
    const issued = await issueQuote(ALICE, quote());
    const stolen = await redeemQuote(BOB, issued.quoteId);
    expect(stolen.ok).toBe(false);
    if (stolen.ok) return;
    expect(stolen.reason).toBe("not_yours");
  });

  it("leaves the quote redeemable by its owner after someone else probes it", async () => {
    // Ownership is checked BEFORE the id is burned, so probing cannot be used
    // to invalidate another user's live quote.
    const issued = await issueQuote(ALICE, quote());
    await redeemQuote(BOB, issued.quoteId);
    expect((await redeemQuote(ALICE, issued.quoteId)).ok).toBe(true);
  });

  it("reports an unknown id as expired rather than throwing", async () => {
    const missing = await redeemQuote(ALICE, "00000000-0000-4000-8000-000000000000");
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe("expired");
  });
});

describe("SwapSchema — execution cannot be expressed without a quote id", () => {
  const pair = {
    fromToken: "USDT",
    toToken: "USDC",
    fromChain: "arbitrum",
    amountIn: 100,
  };

  it("rejects execute:true with no quoteId (the old re-quoting shape)", () => {
    expect(SwapSchema.safeParse({ ...pair, execute: true }).success).toBe(false);
  });

  it("rejects a malformed quoteId", () => {
    expect(SwapSchema.safeParse({ execute: true, quoteId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts execute:true with a well-formed quoteId and no pair fields", () => {
    const parsed = SwapSchema.safeParse({
      execute: true,
      quoteId: "00000000-0000-4000-8000-000000000000",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts a plain quote request", () => {
    expect(SwapSchema.safeParse(pair).success).toBe(true);
  });

  it("rejects a non-positive amount on the quote path", () => {
    expect(SwapSchema.safeParse({ ...pair, amountIn: 0 }).success).toBe(false);
    expect(SwapSchema.safeParse({ ...pair, amountIn: -1 }).success).toBe(false);
  });
});

describe("slippage ceiling", () => {
  it("is set low enough to catch a malfunctioning route", () => {
    // Li.Fi's own defaults are <=0.5% (defaultSlippagePct); the ceiling exists
    // to stop an order-of-magnitude outlier reaching a confirm screen.
    expect(MAX_SLIPPAGE_PCT).toBeLessThanOrEqual(5);
    expect(MAX_SLIPPAGE_PCT).toBeGreaterThan(0.5);
  });

  it("matches the mobile client's ceiling", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "native-app", "app", "swap.tsx"),
      "utf8"
    );
    const m = src.match(/const MAX_SLIPPAGE_PCT = (\d+(?:\.\d+)?)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_SLIPPAGE_PCT);
  });
});
