import { describe, it, expect } from "vitest";
import { emaConvergenceBars, ema, lookbackFor, REQUIRED_BARS } from "@/lib/markets/indicators";

// ---------------------------------------------------------------------------
// The lookback / viewport split.
//
// /api/markets/bars used to truncate the 1D series to the most recent trading
// day — about 78 five-minute bars — because that is what the chart DISPLAYS.
// That conflated two different questions, and the consequence was silent: every
// indicator longer than a session became either impossible or badly seeded.
//
//   an EMA-200 needs 200 bars to exist at all, and ~600 to converge
//   an EMA-50 on 78 bars still carries ~35% of its seed
//
// The fix separates them: the API decides how much history the MATH needs, and
// `visibleFrom`/`visibleTo` tell the client what the EYE should see.
//
// These tests cover the arithmetic that justifies the buffer size, because that
// is the part a future change is most likely to get wrong — the temptation is
// always to fetch "a period's worth" and call the seed handled.
// ---------------------------------------------------------------------------

/** A US regular session in five-minute bars: 09:30–16:00 ET. */
const BARS_PER_SESSION = 78;

describe("why 78 bars was not enough", () => {
  it("cannot compute an EMA-200 at all", () => {
    const closes = Array.from({ length: BARS_PER_SESSION }, (_, i) => 180 + i * 0.01);
    const r = ema(closes, 200);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("EMA-200 requires 200 bars (78 available)");
  });

  it("computes an EMA-50 that is still mostly its own seed", () => {
    // It returns a number, which is the dangerous part — nothing looks broken.
    const closes = Array.from({ length: BARS_PER_SESSION }, (_, i) => 180 + i * 0.01);
    const r = ema(closes, 50);
    expect(r.ok).toBe(true);

    // 28 bars past the seed, at alpha = 2/51, the seed still contributes ~33%.
    const residual = Math.pow(1 - 2 / 51, BARS_PER_SESSION - 50);
    expect(residual).toBeGreaterThan(0.3);
  });
});

describe("the buffer size is derived, not guessed", () => {
  it("600 bars is where an EMA-200's seed falls below 0.25%", () => {
    expect(emaConvergenceBars(200)).toBe(600);
    expect(Math.pow(1 - 2 / 201, 600)).toBeLessThan(0.0025);
    // And 599 is not enough — the boundary is real, not rounded to a nice number.
    expect(Math.pow(1 - 2 / 201, 599)).toBeGreaterThan(0.0025);
  });

  it("one full period is NOT enough, which is the intuition to break", () => {
    // The plausible-but-wrong rule is "fetch `period` bars". At exactly 200 the
    // seed is still 13.5% of the value.
    expect(Math.pow(1 - 2 / 201, 200)).toBeGreaterThan(0.13);
  });

  it("scales the requirement with the period rather than a flat multiplier", () => {
    // A flat ">=600 for everything" would over-fetch for short EMAs.
    expect(emaConvergenceBars(20)).toBeLessThan(emaConvergenceBars(50));
    expect(emaConvergenceBars(50)).toBeLessThan(emaConvergenceBars(200));
    expect(emaConvergenceBars(20)).toBeLessThan(100);
  });

  it("honours a caller's tolerance", () => {
    // A looser tolerance needs fewer bars; a tighter one needs more. Monotonic,
    // so a caller trading accuracy for request size gets what they asked for.
    expect(emaConvergenceBars(200, 0.01)).toBeLessThan(emaConvergenceBars(200, 0.0025));
    expect(emaConvergenceBars(200, 0.0001)).toBeGreaterThan(emaConvergenceBars(200, 0.0025));
  });
});

describe("14 calendar days is bounded on BOTH sides", () => {
  it("600 five-minute bars is about 7.7 trading days", () => {
    const tradingDays = 600 / BARS_PER_SESSION;
    expect(tradingDays).toBeGreaterThan(7);
    expect(tradingDays).toBeLessThan(8);
  });

  it("7.7 trading days needs ~11 calendar days, so 14 clears the FLOOR", () => {
    // 5 trading days per 7 calendar days.
    const calendarDays = (600 / BARS_PER_SESSION) * (7 / 5);
    expect(calendarDays).toBeGreaterThan(10);
    expect(calendarDays).toBeLessThan(11);
    expect(14).toBeGreaterThan(calendarDays);
  });

  it("stays under the CEILING, which is what stops today being dropped", () => {
    // THE BUG THIS PINS, and it is not a rate-limit concern. `alpacaBars` does not
    // follow next_page_token, and Alpaca returns bars ASCENDING from `start`. A
    // window holding more than limit=1000 bars therefore comes back as the OLDEST
    // 1000 and silently omits today — a chart labelled "1D" showing a week-old
    // session. A larger window is not safer; it is how the recent bars vanish.
    const DAYS = 14;
    const tradingDays = Math.ceil(DAYS * (5 / 7));
    const bars = tradingDays * BARS_PER_SESSION;

    expect(bars).toBeLessThan(1000); // one page reaches today
    expect(bars).toBeGreaterThan(600); // and still converges EMA-200

    // The window that failed this: 21 days is 15 trading days = 1170 bars.
    expect(Math.ceil(21 * (5 / 7)) * BARS_PER_SESSION).toBeGreaterThan(1000);
  });
});

describe("lookbackFor combines both requirements", () => {
  it("satisfies seed existence AND seed decay for an EMA-derived indicator", () => {
    const visible = BARS_PER_SESSION;
    const n = lookbackFor(visible, REQUIRED_BARS.ema(200), 200);
    // Enough for the seed to exist across the whole visible window...
    expect(n).toBeGreaterThanOrEqual(visible + 200 - 1);
    // ...and enough for it to have decayed.
    expect(n).toBeGreaterThanOrEqual(600);
  });

  it("adds no convergence term for a windowed indicator", () => {
    // Bollinger(20) depends on exactly 20 bars and nothing before them, so there
    // is no seed to decay and no reason to over-fetch.
    expect(lookbackFor(BARS_PER_SESSION, REQUIRED_BARS.bollinger(20))).toBe(97);
  });

  it("never returns less than the bare requirement, even for a 1-bar viewport", () => {
    expect(lookbackFor(1, 200, 200)).toBeGreaterThanOrEqual(600);
    expect(lookbackFor(0, 15)).toBeGreaterThanOrEqual(15);
  });
});
