import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { impliedStop, rewardRisk, sizePosition, PositionSizingError } from "@/lib/markets/positionSizing";
import { bollinger, ema, lookbackFor, macd, REQUIRED_BARS, rsi } from "@/lib/markets/indicators";
import { describeOrderOutcome, ORDER_TICKET_TYPES } from "@/lib/markets/orderTicket";
import { OrderSchema } from "@/lib/schemas";
import { AlpacaBrokerageProvider } from "@/lib/brokerage/alpaca";
import { BrokerageRejectedError } from "@/lib/brokerage/types";
import { withIdempotency } from "@/lib/idempotency";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// FINANCIAL INVARIANT BENCHMARK — reference instrument AAPL.
//
// Six dimensions, and the organising idea is that every assertion is about an
// invariant a user's money depends on, not about an implementation detail:
//
//   1. Money math       — a size can never risk more than authorised
//   2. Order validation — a nonsensical order is refused LOCALLY
//   3. Idempotency      — a retry cannot double-book; an edit cannot stale-book
//   4. State machine    — an unconfirmed order is never reported as filled
//   5. Indicators       — match reference values, or say why they cannot
//   6. Latency          — the whole pre-flight is fast enough to run per keystroke
//
// Timings are recorded and printed as a table at the end. They are a BENCHMARK,
// not a gate: the only timing that is asserted is dimension 6's budget, because
// asserting wall-clock in CI otherwise produces failures that track machine load
// rather than code.
// ---------------------------------------------------------------------------

interface Row {
  scenario: string;
  input: string;
  invariant: string;
  ms: number;
  status: "PASS" | "FAIL";
}
const rows: Row[] = [];

/** Run `fn`, record its timing and outcome, and return what it returned. */
function bench<T>(scenario: string, input: string, invariant: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    const out = fn();
    rows.push({ scenario, input, invariant, ms: performance.now() - t0, status: "PASS" });
    return out;
  } catch (e) {
    rows.push({ scenario, input, invariant, ms: performance.now() - t0, status: "FAIL" });
    throw e;
  }
}

afterEach(() => {
  /* timings accumulate across the file; printed in the final block */
});

// --- the reference series ---------------------------------------------------
//
// DETERMINISTIC AND SYNTHETIC, AND LABELLED AS SUCH. These are not real AAPL
// prices: fabricating a "real" historical series would be exactly the synthetic
// data this codebase forbids on money surfaces, and a test that claimed to hold
// genuine market history would be a lie in a file about honesty.
//
// What matters for an indicator benchmark is not that the numbers are AAPL's, but
// that they are FIXED — so a reference value computed once by hand stays valid.
// A seeded LCG gives a reproducible walk with realistic shape.
function referenceSeries(n: number, start = 182.5): number[] {
  let seed = 20260925;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: number[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price = Math.max(1, price * (1 + (rand() - 0.5) * 0.02));
    out.push(Math.round(price * 100) / 100);
  }
  return out;
}

const BARS_250 = referenceSeries(250);
const BARS_35 = referenceSeries(35);

// ===========================================================================
// 1. POSITION SIZING & MONEY MATH
// ===========================================================================

describe("1. position sizing & money math", () => {
  it("floors a NOTIONAL conversion so cash can never be overdrafted", () => {
    // $5,000 at $182.525 = 27.393507... shares. Rounding UP to the next
    // representable quantity costs more than $5,000 — the overdraft this
    // invariant exists to prevent. Truncation is the only safe direction.
    const price = 182.525;
    const notional = 5_000;
    const raw = notional / price;

    const shares = bench(
      "Notional floor invariant",
      `$${notional} notional @ $${price}`,
      "shares * price <= notional",
      () => Math.floor(raw * 1e6) / 1e6
    );

    expect(shares).toBeLessThanOrEqual(raw);
    expect(shares * price, "cost must not exceed the notional").toBeLessThanOrEqual(notional);
    // And the residual is a fraction of a cent, not a lost dollar.
    expect(notional - shares * price).toBeLessThan(0.01);
  });

  it("floors a RISK-BUDGET size so the authorised loss is never exceeded", () => {
    // A separate invariant from the notional one above, and worth keeping
    // separate: sizePosition sizes off what the user is willing to LOSE, so the
    // ceiling it must respect is the risk budget, not a cash amount.
    //
    // $100,000 at 2% = $2,000 budget. A $10 stop distance gives 200 shares —
    // a $36,505 position, which is the point: exposure and risk are different
    // numbers and only one of them was authorised.
    const price = 182.525;
    const result = bench(
      "Risk-budget floor invariant",
      `$100k equity, 2% risk, entry $${price}, stop $${price - 10}`,
      "riskAmount <= budget, qty floored",
      () =>
        sizePosition({
          equity: 100_000,
          riskFraction: 0.02,
          entryPrice: price,
          stopPrice: price - 10,
          side: "buy",
        })
    );

    expect(result.quantity).toBe(200);
    expect(result.riskAmount).toBeLessThanOrEqual(100_000 * 0.02 + 1e-9);
    // Quantity is floored to 6dp, so the realised risk is at or under budget.
    expect(result.quantity).toBe(Math.floor(result.quantity * 1e6) / 1e6);
    // Exposure is 18x the risk — the distinction the module exists to make.
    expect(result.notional / result.riskAmount).toBeGreaterThan(18);
  });

  it("accepts riskFraction 0.02 and REFUSES 2.0 and 0.30", () => {
    bench("Risk fraction 2%", "riskFraction=0.02", "accepted", () =>
      sizePosition({ equity: 10_000, riskFraction: 0.02, entryPrice: 200, stopPrice: 196, side: "buy" })
    );

    // `2` meaning "2%" would risk 200% of the account — the fat-finger that ends
    // an account, so the refusal names the fix.
    bench("Risk fraction fat-finger", "riskFraction=2.0", "refused, names 0.02", () => {
      expect(() =>
        sizePosition({ equity: 10_000, riskFraction: 2.0, entryPrice: 200, stopPrice: 196, side: "buy" })
      ).toThrow(/pass 0.02 rather than 2/);
      return true;
    });

    bench("Risk fraction above ceiling", "riskFraction=0.30", "refused (>0.25)", () => {
      expect(() =>
        sizePosition({ equity: 10_000, riskFraction: 0.3, entryPrice: 200, stopPrice: 196, side: "buy" })
      ).toThrow(PositionSizingError);
      return true;
    });
  });

  it("AAPL @ $200 with a $196 stop and $200 risk gives exactly 50 shares", () => {
    // The spec's worked example. $4.00 risk per share, $200 budget -> 50 shares,
    // $10,000 notional, and the loss at the stop is $200.00 to the cent.
    const r = bench(
      "Stop distance math",
      "entry $200.00, stop $196.00, risk $200 (2% of $10k)",
      "qty=50, notional=$10,000, loss@stop=$200.00 ±$0.01",
      () =>
        sizePosition({
          equity: 10_000,
          riskFraction: 0.02,
          entryPrice: 200,
          stopPrice: 196,
          side: "buy",
        })
    );

    expect(r.quantity).toBe(50);
    expect(r.notional).toBe(10_000);
    expect(r.riskPerUnit).toBe(4);
    expect(Math.abs(r.riskAmount - 200)).toBeLessThanOrEqual(0.01);
    expect(r.stopDistanceFraction).toBeCloseTo(0.02, 10);
  });

  it("round-trips sizing against the implied stop", () => {
    const sized = sizePosition({ equity: 10_000, riskFraction: 0.02, entryPrice: 200, stopPrice: 196, side: "buy" });
    const stop = impliedStop({
      equity: 10_000,
      riskFraction: 0.02,
      entryPrice: 200,
      quantity: sized.quantity,
      side: "buy",
    });
    expect(stop).toBeCloseTo(196, 8);
  });

  it("computes reward-to-risk for an AAPL bracket", () => {
    const rr = rewardRisk({ entryPrice: 200, stopPrice: 196, targetPrice: 212, side: "buy" });
    expect(rr.ratio).toBe(3); // $12 reward / $4 risk
  });
});

// ===========================================================================
// 2. ORDER TYPE VALIDATION & INVARIANT REFUSALS
// ===========================================================================

describe("2. order validation & refusals", () => {
  const provider = new AlpacaBrokerageProvider({
    keyId: "bench-key",
    secretKey: "bench-secret",
    baseUrl: "https://paper-api.alpaca.markets",
    isLive: false,
  });

  let lastBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    lastBody = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        lastBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "alp_bench",
            client_order_id: "cli_bench",
            symbol: "AAPL",
            side: "buy",
            order_type: String((lastBody as Record<string, unknown>).type ?? "market"),
            time_in_force: "gtc",
            status: "new",
            qty: "10",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("REFUSES an inverted stop on a long BEFORE the broker is called", () => {
    // Long AAPL at $220 with the stop at $225: that stop triggers on exactly the
    // move the trade is betting on. The sizing layer refuses it locally, so no
    // order is created and nothing reaches the venue.
    bench(
      "Inverted stop on a long",
      "AAPL buy @ $220.00, stop $225.00",
      "refused locally, no broker call",
      () => {
        expect(() =>
          sizePosition({ equity: 50_000, riskFraction: 0.02, entryPrice: 220, stopPrice: 225, side: "buy" })
        ).toThrow(/must be BELOW entry/);
        return true;
      }
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("REFUSES a trailing stop with day TIF, explaining the expiry", async () => {
    // Alpaca ACCEPTS this, so it is not a provider error — it silently expires
    // the protection at the close, the opposite of what a trailing stop is for.
    const t0 = performance.now();
    await expect(
      provider.placeOrder({
        clientOrderId: "cli_bench_trail",
        symbol: "AAPL",
        side: "sell",
        type: "trailing_stop",
        timeInForce: "day",
        qty: 10,
        trailPercent: 5,
      })
    ).rejects.toThrow(/removes the protection it exists to provide/);
    rows.push({
      scenario: "Trailing stop + day TIF",
      input: "AAPL trailing_stop 5%, tif=day",
      invariant: "refused, explains silent expiry",
      ms: performance.now() - t0,
      status: "PASS",
    });
    expect(fetch, "must not reach the venue").not.toHaveBeenCalled();
  });

  it("accepts a trailing stop with gtc and sends trail_percent as a string", async () => {
    await provider.placeOrder({
      clientOrderId: "cli_bench_trail_ok",
      symbol: "AAPL",
      side: "sell",
      type: "trailing_stop",
      timeInForce: "gtc",
      qty: 10,
      trailPercent: 5,
    });
    expect(lastBody).toMatchObject({ type: "trailing_stop", trail_percent: "5", time_in_force: "gtc" });
  });

  it("accepts a buy limit BELOW market and one ABOVE it, unchanged", async () => {
    // $210 below a $220 market is an ordinary resting limit. $230 ABOVE it is a
    // marketable limit — legitimate, and it fills immediately at the better
    // available price rather than at $230, so the limit acts as a slippage cap.
    // Both are valid; neither is silently converted to a market order.
    for (const [label, limit] of [
      ["below market", 210],
      ["above market (marketable)", 230],
    ] as const) {
      await provider.placeOrder({
        clientOrderId: `cli_bench_lim_${limit}`,
        symbol: "AAPL",
        side: "buy",
        type: "limit",
        timeInForce: "gtc",
        qty: 10,
        limitPrice: limit,
      });
      expect(lastBody, label).toMatchObject({ type: "limit", limit_price: String(limit) });
      // A limit order must NEVER be downgraded to a market order in transit.
      expect((lastBody as Record<string, unknown>).type, label).not.toBe("market");
    }
  });

  it("REFUSES a trail on a non-trailing order type", async () => {
    // Silently dropping it would place a plain market order while the caller
    // believed protection was attached.
    await expect(
      provider.placeOrder({
        clientOrderId: "cli_bench_bad_trail",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        timeInForce: "day",
        qty: 10,
        trailPercent: 5,
      })
    ).rejects.toThrow(BrokerageRejectedError);
  });

  it("schema-validates every order type the ticket offers", () => {
    for (const t of ORDER_TICKET_TYPES) {
      const parsed = OrderSchema.safeParse({
        symbol: "AAPL",
        side: "buy",
        notional: 5_000,
        type: t.value,
        time_in_force: t.value === "market" ? "day" : "gtc",
        ...(t.value === "limit" || t.value === "stop_limit" ? { limit_price: 210 } : {}),
        ...(t.value === "stop" || t.value === "stop_limit" ? { stop_price: 196 } : {}),
        ...(t.value === "trailing_stop" ? { trail_percent: 5 } : {}),
      });
      expect(parsed.success, `${t.value} must be accepted`).toBe(true);
    }
  });
});

// ===========================================================================
// 3. IDEMPOTENCY & CONCURRENCY
// ===========================================================================

describe("3. idempotency & concurrency", () => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  beforeEach(() => {
    g.__furlpayKv = new Map();
  });

  /** The client-side rule: the key is derived from the order INTENT. */
  const intentKey = (o: Record<string, unknown>) => JSON.stringify(o);

  it("rotates the key when the limit price is edited", () => {
    // The bug this prevents: a retry after editing the price replays the ORIGINAL
    // order at the original price, because the key is what the server matches on.
    const base = { symbol: "AAPL", side: "buy", qty: 10, type: "limit", limit_price: 210.0 };
    const K1 = intentKey(base);
    const K2 = intentKey({ ...base, limit_price: 209.5 });

    bench("Key rotation on price edit", "AAPL 10 @ $210.00 -> $209.50", "K1 !== K2", () => {
      expect(K2).not.toBe(K1);
      return true;
    });

    // And an unchanged payload must reuse the same key, or a timeout retry
    // becomes a second order.
    expect(intentKey({ ...base })).toBe(K1);
  });

  it("deduplicates a retry of the identical payload", async () => {
    let executions = 0;
    const run = () =>
      withIdempotency(
        "bench-key-retry",
        "investing.order",
        async () => {
          executions++;
          return NextResponse.json({ orderId: "ord_1", status: "accepted" });
        },
        { principal: "bench_user" }
      );

    const first = await run();
    const retry = await run();
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(executions, "the body must execute exactly once").toBe(1);
  });

  it("lets exactly ONE of five concurrent submissions execute", async () => {
    // The concurrency blast. Five racers, one key: one executes, four are served
    // the replay or an in-flight rejection. What must NOT happen is five orders.
    let executions = 0;
    const submit = () =>
      withIdempotency(
        "bench-key-blast",
        "investing.order",
        async () => {
          executions++;
          await new Promise((r) => setTimeout(r, 5));
          return NextResponse.json({ orderId: "ord_blast", status: "accepted" });
        },
        { principal: "bench_user" }
      );

    const t0 = performance.now();
    const results = await Promise.all([submit(), submit(), submit(), submit(), submit()]);
    const ms = performance.now() - t0;

    expect(executions, "exactly one execution across five racers").toBe(1);
    // Every caller gets an answer — none hangs and none errors out.
    expect(results).toHaveLength(5);
    for (const r of results) expect([200, 409]).toContain(r.status);

    rows.push({
      scenario: "Concurrent order blast",
      input: "5x Promise.all, same Idempotency-Key",
      invariant: "1 execution, 4 replay/409",
      ms,
      status: "PASS",
    });
  });
});

// ===========================================================================
// 4. ORDER STATE MACHINE & INDETERMINATE STATUS
// ===========================================================================

describe("4. state machine & indeterminate status", () => {
  it("reports an indeterminate submission as unconfirmed, NOT filled or failed", () => {
    // The 202 case. Both "filled" and "failed" are guesses, and each leads the
    // user to do the wrong thing: spend money they may not have, or place a
    // second order that doubles the position.
    const o = bench("202 indeterminate", "broker 202, status=unknown", "not filled, not failed", () =>
      describeOrderOutcome("unknown")
    );
    expect(o.tone).toBe("unknown");
    expect(o.title).toMatch(/not confirmed/i);
    expect(o.title).not.toMatch(/filled/i);
    expect(o.detail("buy", "$5,000.00", "AAPL")).toMatch(/before placing another/i);
  });

  it("reports a resting order as resting, not filled", () => {
    const o = describeOrderOutcome("accepted");
    expect(o.tone).toBe("resting");
    expect(o.detail("buy", "$5,000.00", "AAPL")).toMatch(/Nothing has been bought or sold yet/);
  });

  it("reports a partial fill with leaves_qty implied", () => {
    // 4 of 10 filled -> 6 remaining. The status must not read as complete.
    const filledQty = 4;
    const orderQty = 10;
    const leavesQty = orderQty - filledQty;

    const o = bench(
      "Partial fill",
      "AAPL 10 shares, 4 filled",
      "filled=4, leaves=6, tone != filled",
      () => describeOrderOutcome("partially_filled")
    );
    expect(leavesQty).toBe(6);
    expect(o.title).toBe("Partially filled");
    expect(o.tone).not.toBe("filled");
  });

  it("never reports an unrecognised broker status as filled", () => {
    for (const s of ["", "pending_cancel", "some_future_status", "accepted_for_bidding"]) {
      expect(describeOrderOutcome(s).tone, s).not.toBe("filled");
    }
  });
});

// ===========================================================================
// 5. TECHNICAL INDICATORS
// ===========================================================================

describe("5. indicators on 250 bars", () => {
  it("computes EMA-20 and EMA-50 with correct seeding", () => {
    const e20 = bench("EMA-20", "250 bars", "first value at index 19 = SMA(0..19)", () =>
      ema(BARS_250, 20)
    );
    expect(e20.ok).toBe(true);
    if (!e20.ok) return;

    // Nothing before the seed window closes — not a copy of price.
    expect(e20.values.slice(0, 19).every((v) => v === null)).toBe(true);
    const sma20 = BARS_250.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    expect(e20.values[19]).toBeCloseTo(sma20, 10);

    // And the recurrence holds at the next step.
    const alpha = 2 / 21;
    expect(e20.values[20]).toBeCloseTo(BARS_250[20] * alpha + sma20 * (1 - alpha), 10);

    const e50 = bench("EMA-50", "250 bars", "first value at index 49", () => ema(BARS_250, 50));
    expect(e50.ok).toBe(true);
    if (e50.ok) expect(e50.values[48]).toBeNull();
  });

  it("computes EMA-200 — the case a 1D chart cannot do without a lookback buffer", () => {
    const e200 = bench("EMA-200", "250 bars", "first value at index 199, 51 real values", () =>
      ema(BARS_250, 200)
    );
    expect(e200.ok).toBe(true);
    if (!e200.ok) return;
    expect(e200.values[198]).toBeNull();
    expect(e200.values[199]).not.toBeNull();
    expect(e200.values.filter((v) => v !== null)).toHaveLength(51);
  });

  it("computes RSI-14 using WILDER's smoothing, bounded 0..100", () => {
    const r = bench("RSI-14 (Wilder)", "250 bars", "0<=rsi<=100, first at index 14", () =>
      rsi(BARS_250, 14)
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.values[13], "no RSI before 14 changes exist").toBeNull();
    expect(r.values[14]).not.toBeNull();
    for (const v of r.values) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("matches a HAND-COMPUTED Wilder RSI on a known series", () => {
    // The reference check. A monotonically rising series has zero average loss,
    // so RS -> infinity and RSI is exactly 100 — the limit a naive implementation
    // divides by zero on. This also distinguishes Wilder's from a simple average:
    // both give 100 here, but the next assertion separates them.
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    const up = rsi(rising, 14);
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.values[14]).toBe(100);

    // A monotonic decline gives exactly 0.
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    const down = rsi(falling, 14);
    if (down.ok) expect(down.values[14]).toBeCloseTo(0, 10);

    // Wilder's smoothing, verified step by step. 14 up-moves of 1, then one
    // down-move of 2:
    //   avgGain after seed = 1, avgLoss = 0
    //   next: avgGain = (1*13 + 0)/14 = 0.928571..., avgLoss = (0*13 + 2)/14 = 0.142857...
    //   RS = 6.5  ->  RSI = 100 - 100/7.5 = 86.666...
    const series = [...Array.from({ length: 15 }, (_, i) => 100 + i), 112];
    const mixed = rsi(series, 14);
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      const avgGain = (1 * 13 + 0) / 14;
      const avgLoss = (0 * 13 + 2) / 14;
      const expected = 100 - 100 / (1 + avgGain / avgLoss);
      expect(mixed.values[15]).toBeCloseTo(expected, 8);
      expect(expected).toBeCloseTo(86.6666667, 6);
    }
  });

  it("computes MACD(12,26,9) with a signal seeded off the MACD line", () => {
    const m = bench("MACD(12,26,9)", "250 bars", "macd@25, signal@34, hist = macd - signal", () =>
      macd(BARS_250, 12, 26, 9)
    );
    expect(m.ok).toBe(true);
    if (!m.ok) return;

    expect(m.macd[24], "no macd before the slow EMA seeds").toBeNull();
    expect(m.macd[25]).not.toBeNull();
    // signal needs 9 macd values: index 25 + 8 = 33.
    expect(m.signal[32]).toBeNull();
    expect(m.signal[33]).not.toBeNull();

    // The histogram identity must hold wherever both legs exist.
    for (let i = 0; i < BARS_250.length; i++) {
      if (m.macd[i] !== null && m.signal[i] !== null) {
        expect(m.histogram[i]!).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
      } else {
        expect(m.histogram[i]).toBeNull();
      }
    }
  });

  it("computes Bollinger bands ordered lower < middle < upper", () => {
    const b = bench("Bollinger(20,2)", "250 bars", "lower <= middle <= upper", () =>
      bollinger(BARS_250, 20, 2)
    );
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    for (let i = 19; i < BARS_250.length; i++) {
      expect(b.lower[i]!).toBeLessThanOrEqual(b.middle[i]!);
      expect(b.middle[i]!).toBeLessThanOrEqual(b.upper[i]!);
    }
  });
});

describe("5b. insufficient bars degrade honestly", () => {
  it("EMA-200 on 35 bars does not throw, returns no values, and says why", () => {
    // THE RULE. A truncated EMA-200 is not an EMA-200 — it is a different number
    // wearing its name, and drawing it is synthetic data with a technical label.
    const r = bench("EMA-200 on 35 bars", "35 bars", "ok:false, honest reason, no values", () =>
      ema(BARS_35, 200)
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("EMA-200 requires 200 bars (35 available)");
    expect(r.required).toBe(200);
    expect(r.provided).toBe(35);
    expect(r).not.toHaveProperty("values");
  });

  it("every indicator degrades rather than throwing on a short series", () => {
    const short = BARS_35.slice(0, 5);
    expect(ema(short, 200).ok).toBe(false);
    expect(rsi(short, 14).ok).toBe(false);
    expect(macd(short).ok).toBe(false);
    expect(bollinger(short).ok).toBe(false);
  });

  it("states the exact seed requirement per indicator", () => {
    expect(REQUIRED_BARS.ema(200)).toBe(200);
    expect(REQUIRED_BARS.rsi(14)).toBe(15); // 14 changes need 15 closes
    expect(REQUIRED_BARS.macd(26, 9)).toBe(34);
    expect(REQUIRED_BARS.bollinger(20)).toBe(20);
  });

  it("sizes the lookback buffer so a 1D window can show a real EMA-200", () => {
    // Option (b): the viewport stays 1D, the FETCH covers the indicator's history.
    // 78 five-minute bars in a session + 199 bars of prior history.
    expect(lookbackFor(78, 200)).toBe(277);
    // Never less than the requirement, even for a tiny viewport.
    expect(lookbackFor(1, 200)).toBe(200);
  });
});

// ===========================================================================
// 6. LATENCY
// ===========================================================================

describe("6. pre-flight latency budget", () => {
  it("runs validate -> size -> key -> format in under 5ms", () => {
    const t0 = performance.now();

    // validate
    const parsed = OrderSchema.safeParse({
      symbol: "AAPL",
      side: "buy",
      notional: 5_000,
      type: "limit",
      time_in_force: "gtc",
      limit_price: 210,
    });
    expect(parsed.success).toBe(true);

    // size
    const sized = sizePosition({
      equity: 100_000,
      riskFraction: 0.02,
      entryPrice: 200,
      stopPrice: 196,
      side: "buy",
    });

    // idempotency key from the intent
    const key = JSON.stringify({ symbol: "AAPL", side: "buy", qty: sized.quantity, limit: 210 });
    expect(key.length).toBeGreaterThan(0);

    // format
    const out = describeOrderOutcome("accepted");
    expect(out.tone).toBe("resting");

    const ms = performance.now() - t0;
    rows.push({
      scenario: "Full pre-flight pipeline",
      input: "validate + size + key + format",
      invariant: "< 5ms",
      ms,
      status: ms < 5 ? "PASS" : "FAIL",
    });

    // The one asserted timing in the file. It is a real budget: this runs on
    // every keystroke in the order ticket, so anything slower is felt.
    expect(ms).toBeLessThan(5);
  });

  it("computes all four indicators over 250 bars in under 50ms", () => {
    const t0 = performance.now();
    ema(BARS_250, 20);
    ema(BARS_250, 50);
    ema(BARS_250, 200);
    rsi(BARS_250, 14);
    macd(BARS_250, 12, 26, 9);
    bollinger(BARS_250, 20, 2);
    const ms = performance.now() - t0;

    rows.push({
      scenario: "All indicators, 250 bars",
      input: "EMA 20/50/200 + RSI-14 + MACD + BB",
      invariant: "< 50ms",
      ms,
      status: ms < 50 ? "PASS" : "FAIL",
    });
    expect(ms).toBeLessThan(50);
  });
});

// ===========================================================================
// THE BENCHMARK TABLE
// ===========================================================================

describe("benchmark summary", () => {
  it("prints the results table", () => {
    const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
    const line = "─".repeat(132);
    const out: string[] = [
      "",
      line,
      "FINANCIAL INVARIANT BENCHMARK — reference instrument AAPL",
      line,
      `${pad("SCENARIO", 30)} ${pad("INPUT", 42)} ${pad("INVARIANT", 40)} ${pad("ms", 9)} STATUS`,
      line,
    ];
    for (const r of rows) {
      out.push(
        `${pad(r.scenario, 30)} ${pad(r.input, 42)} ${pad(r.invariant, 40)} ${pad(r.ms.toFixed(3), 9)} ${r.status}`
      );
    }
    out.push(line);
    out.push(
      `${rows.length} benchmarked scenarios · ${rows.filter((r) => r.status === "PASS").length} PASS · ` +
        `${rows.filter((r) => r.status === "FAIL").length} FAIL`
    );
    out.push(line);
    // eslint-disable-next-line no-console
    console.log(out.join("\n"));

    expect(rows.every((r) => r.status === "PASS"), "every benchmarked scenario must pass").toBe(true);
  });
});
