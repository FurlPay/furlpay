import { describe, it, expect } from "vitest";
import {
  basisSeries,
  alignToDates,
  assessQuality,
  GOLD_SERIES,
  MACRO_SERIES,
  EXCLUDED_REVISED_MACRO,
  type MacroPoint,
} from "../goldSeries";
import type { Bar } from "../features";

const bar = (date: string, close: number, high = close, low = close): Bar => ({
  date, open: close, high, low, close, volume: 1,
});

describe("what each series actually is", () => {
  it("never labels anything spot", () => {
    // The provider has no spot gold. Calling the future "spot" is the specific
    // error this whole layer exists to prevent.
    for (const s of Object.values(GOLD_SERIES)) {
      expect(s.kind, s.symbol).not.toBe("spot");
      expect(s.note.toLowerCase(), s.symbol).not.toMatch(/\bis spot\b/);
    }
    expect(GOLD_SERIES.goldFuture.kind).toBe("frontMonthFuture");
    expect(GOLD_SERIES.goldFuture.note).toMatch(/not spot/i);
  });

  it("marks the ETF as a scaled claim rather than a price per ounce", () => {
    expect(GOLD_SERIES.goldEtf.kind).toBe("etfProxy");
    expect(GOLD_SERIES.goldEtf.note).toMatch(/fraction of an ounce/i);
  });

  it("uses only unrevised macro series as features", () => {
    // Every entry says so explicitly; the revised monthly series are held in a
    // separate constant precisely so they cannot be used by accident.
    for (const m of Object.values(MACRO_SERIES)) {
      expect(m.note, m.id).toMatch(/not revised/i);
    }
    const featureIds = Object.values(MACRO_SERIES).map((m) => m.id);
    for (const excluded of Object.values(EXCLUDED_REVISED_MACRO)) {
      expect(featureIds, excluded).not.toContain(excluded);
    }
  });
});

describe("basis", () => {
  it("computes futures minus the scaled ETF reference", () => {
    // 0.09 oz/share × $4,000/oz = $360/share. A future at $4,040 is $40 rich.
    const out = basisSeries([bar("2026-01-02", 4040)], [bar("2026-01-02", 360)], 0.09, "test");
    expect(out).toHaveLength(1);
    expect(out[0]!.proxyPrice).toBeCloseTo(4000, 9);
    expect(out[0]!.basis).toBeCloseTo(40, 9);
    expect(out[0]!.basisPct).toBeCloseTo(0.01, 9);
  });

  it("intersects on date rather than zipping by index", () => {
    // The ETF is missing 01-03. Zipping would pair the future's 01-03 with the
    // ETF's 01-04 and silently offset every later observation.
    const fut = [bar("2026-01-02", 4040), bar("2026-01-03", 4050), bar("2026-01-04", 4060)];
    const etf = [bar("2026-01-02", 360), bar("2026-01-04", 361)];
    const out = basisSeries(fut, etf, 0.09, "test");
    expect(out.map((o) => o.date)).toEqual(["2026-01-02", "2026-01-04"]);
  });

  it("records the scaling factor and its source with every observation", () => {
    // The basis is only meaningful if the reader can see what ounces-per-share
    // produced it; GLD's declines daily as fees accrue.
    const out = basisSeries([bar("2026-01-02", 4040)], [bar("2026-01-02", 360)], 0.09, "issuer factsheet");
    expect(out[0]!.ouncesPerShare).toBe(0.09);
    expect(out[0]!.scalingSource).toBe("issuer factsheet");
  });

  it("refuses a non-positive scaling factor rather than dividing by it", () => {
    expect(basisSeries([bar("2026-01-02", 4040)], [bar("2026-01-02", 360)], 0, "x")).toEqual([]);
  });
});

describe("aligning macro to price dates", () => {
  const macro: MacroPoint[] = [
    { date: "2026-01-02", value: 2.0 },
    { date: "2026-01-05", value: 2.5 },
  ];

  it("forward-fills the last known value", () => {
    // On 01-03 and 01-04 a participant knew the 01-02 print and nothing newer.
    expect(alignToDates(["2026-01-02", "2026-01-03", "2026-01-05"], macro)).toEqual([2.0, 2.0, 2.5]);
  });

  it("returns null before the first observation instead of back-filling", () => {
    // Back-filling would hand the model a number published later — the exact
    // look-ahead this layer is built to prevent.
    expect(alignToDates(["2025-12-31", "2026-01-02"], macro)).toEqual([null, 2.0]);
  });

  it("never interpolates toward a future print", () => {
    // Midway between 2.0 and 2.5 would be 2.25 and would leak the 01-05 value
    // backwards into 01-03.
    const out = alignToDates(["2026-01-03"], macro);
    expect(out[0]).toBe(2.0);
    expect(out[0]).not.toBe(2.25);
  });

  it("tolerates unsorted input", () => {
    const shuffled: MacroPoint[] = [
      { date: "2026-01-05", value: 2.5 },
      { date: "2026-01-02", value: 2.0 },
    ];
    expect(alignToDates(["2026-01-03"], shuffled)).toEqual([2.0]);
  });
});

describe("data-quality gate", () => {
  const asOf = new Date("2026-09-02T00:00:00Z");
  const fresh = (n: number): Bar[] =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(asOf.getTime() - (n - 1 - i) * 86_400_000);
      return bar(d.toISOString().slice(0, 10), 100 + i);
    });

  it("passes a fresh, long series", () => {
    const q = assessQuality(fresh(300), asOf);
    expect(q.ok).toBe(true);
    expect(q.problems).toEqual([]);
    expect(q.ageDays).toBe(0);
  });

  it("fails an empty series rather than reporting a neutral state", () => {
    const q = assessQuality([], asOf);
    expect(q.ok).toBe(false);
    expect(q.problems[0]).toMatch(/no bars/);
  });

  it("fails a stale series", () => {
    const stale = fresh(300).map((b, i, arr) =>
      i === arr.length - 1 ? { ...b, date: "2026-08-01" } : b
    );
    const q = assessQuality(stale, asOf);
    expect(q.ok).toBe(false);
    expect(q.problems.join(" ")).toMatch(/days old/);
  });

  it("fails a series too short to compute its own features", () => {
    const q = assessQuality(fresh(30), asOf);
    expect(q.ok).toBe(false);
    expect(q.problems.join(" ")).toMatch(/only 30 bars/);
  });

  it("rejects impossible bars", () => {
    // high < low means the feed is wrong, and every range feature built on it
    // would be wrong without ever looking wrong.
    const broken = [...fresh(300)];
    broken[100] = { ...broken[100]!, high: 10, low: 99 };
    expect(assessQuality(broken, asOf).problems.join(" ")).toMatch(/high below low/);
  });

  it("rejects a non-positive price", () => {
    const broken = [...fresh(300)];
    broken[50] = { ...broken[50]!, close: 0 };
    expect(assessQuality(broken, asOf).problems.join(" ")).toMatch(/non-positive/);
  });
});
