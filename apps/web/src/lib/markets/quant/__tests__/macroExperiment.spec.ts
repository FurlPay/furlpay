import { describe, it, expect } from "vitest";
import {
  buildFactorPanel, deltaSeries, logChangeSeries, rollingZ, forwardReturn,
  ExperimentRegistry, FACTORS, EXCLUDED_FACTORS,
} from "../macroExperiment";
import type { Bar } from "../features";

const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 1 });

describe("information timestamps", () => {
  it("declares an availability rule for every usable factor", () => {
    for (const f of FACTORS) {
      expect(f.availability, f.key).toBe("NEXT_DAY_AFTER_OBSERVATION");
      expect(f.availabilityNote.length, f.key).toBeGreaterThan(20);
      expect(f.availabilityNote, f.key).toMatch(/not revised/i);
    }
  });

  it("excludes revised series instead of using today's vintage", () => {
    // The exclusion is the point: a revised monthly series applied historically
    // is look-ahead that produces excellent, untradeable backtests.
    for (const f of EXCLUDED_FACTORS) {
      expect(f.availability, f.key).toBe("UNAVAILABLE_FOR_HISTORICAL_TRADING");
      expect(f.availabilityNote, f.key).toMatch(/revis/i);
    }
    const usable = FACTORS.map((f) => f.seriesId);
    for (const e of EXCLUDED_FACTORS) expect(usable).not.toContain(e.seriesId);
  });

  it("lags a factor so a bar never sees its own day's publication", () => {
    // Observations on d1..d4. On bar d3 the newest value certainly published is
    // d2's. Handing the model d3's own observation is a one-day look-ahead.
    const bars = [bar("d1", 100), bar("d2", 101), bar("d3", 102), bar("d4", 103)];
    const panel = buildFactorPanel(bars, {
      ry: { points: [
        { date: "d1", value: 1 }, { date: "d2", value: 2 },
        { date: "d3", value: 3 }, { date: "d4", value: 4 },
      ] },
    }, {});
    // d1 has nothing published yet; d2 sees d1's value; d3 sees d2's.
    expect(panel.features.ry).toEqual([null, 1, 2, 3]);
  });

  it("lags cross-asset closes by one bar as well", () => {
    const bars = [bar("d1", 100), bar("d2", 101), bar("d3", 102)];
    const panel = buildFactorPanel(bars, {}, {
      dxy: [bar("d1", 90), bar("d2", 91), bar("d3", 92)],
    });
    expect(panel.features.dxy).toEqual([null, 90, 91]);
  });

  it("keeps gold aligned to the panel dates", () => {
    const bars = [bar("d1", 100), bar("d2", 101)];
    const panel = buildFactorPanel(bars, {}, {});
    expect(panel.dates).toEqual(["d1", "d2"]);
    expect(panel.gold).toEqual([100, 101]);
  });
});

describe("derived series", () => {
  it("computes a k-step difference and nulls the warmup", () => {
    expect(deltaSeries([1, 2, 4, 7], 1)).toEqual([null, 1, 2, 3]);
    expect(deltaSeries([1, 2, 4, 7], 2)).toEqual([null, null, 3, 5]);
  });

  it("propagates a missing observation instead of interpolating", () => {
    // A gap must not be bridged: an invented value becomes an invented factor.
    expect(deltaSeries([1, null, 4], 1)).toEqual([null, null, null]);
  });

  it("computes log change and rejects non-positive prices", () => {
    const out = logChangeSeries([100, 200], 1);
    expect(out[1]!).toBeCloseTo(Math.LN2, 12);
    expect(logChangeSeries([0, 200], 1)[1]).toBeNull();
  });

  it("z-scores against the trailing window only", () => {
    // Window of 5 ending at the last point: mean 3, sample sd sqrt(2.5).
    const z = rollingZ([1, 2, 3, 4, 5], 5);
    expect(z[4]!).toBeCloseTo((5 - 3) / Math.sqrt(2.5), 10);
    // Everything before a full window is null, not a partial statistic.
    expect(z.slice(0, 4)).toEqual([null, null, null, null]);
  });

  it("refuses a z-score when the window contains a gap", () => {
    expect(rollingZ([1, 2, null, 4, 5], 5)[4]).toBeNull();
  });
});

describe("forward returns", () => {
  it("aligns index t to the return earned from t to t+h", () => {
    const g = [100, 110, 121];
    const f = forwardReturn(g, 1);
    expect(f[0]!).toBeCloseTo(Math.log(110 / 100), 12);
    expect(f[1]!).toBeCloseTo(Math.log(121 / 110), 12);
    // The last h entries cannot exist: there is no future to measure.
    expect(f[2]).toBeNull();
  });

  it("nulls the whole tail for a longer horizon", () => {
    const f = forwardReturn([1, 2, 3, 4, 5], 3);
    expect(f.slice(2)).toEqual([null, null, null]);
    expect(f[0]!).toBeCloseTo(Math.log(4 / 1), 12);
  });
});

describe("experiment registry", () => {
  it("records every run, not only the winner", () => {
    // With enough attempts one model looks good by chance. The count is what
    // turns "Sharpe 1.8" into "Sharpe 1.8, best of 40".
    const reg = new ExperimentRegistry();
    for (let i = 0; i < 5; i++) {
      reg.add({
        id: `e${i}`, model: "ols", features: ["ry"], horizon: 5, trainWindow: 504,
        threshold: null, costBps: 5, oosSharpe: i * 0.1, oosReturn: 0,
        maxDrawdown: null, timeInvested: null, turnover: null,
      });
    }
    expect(reg.count()).toBe(5);
    expect(reg.all()).toHaveLength(5);
    expect(reg.best()!.id).toBe("e4");
  });

  it("ignores unscored runs when picking a best", () => {
    const reg = new ExperimentRegistry();
    reg.add({ id: "a", model: "m", features: [], horizon: 1, trainWindow: null, threshold: null, costBps: 5, oosSharpe: null, oosReturn: 0, maxDrawdown: null, timeInvested: null, turnover: null });
    expect(reg.best()).toBeNull();
  });
});
