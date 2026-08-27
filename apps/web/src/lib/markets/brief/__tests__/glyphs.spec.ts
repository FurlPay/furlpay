import { describe, it, expect } from "vitest";
import { arrow, meter, ratioBar, rangeGauge, resample, sparkline, SPARK_LEVELS } from "../glyphs";

// ---------------------------------------------------------------------------
// Chart glyphs.
//
// Every test here is a division by zero or a null waiting to become the string
// "undefined" in a public post. None of them throw — they render, and the
// rendering is wrong in a way that looks deliberate.
// ---------------------------------------------------------------------------

describe("sparkline", () => {
  it("draws a rising series as a rising ramp", () => {
    const s = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8);
    expect(s).toBe(SPARK_LEVELS.join(""));
  });

  it("draws a falling series as a falling ramp", () => {
    expect(sparkline([8, 7, 6, 5, 4, 3, 2, 1], 8)).toBe([...SPARK_LEVELS].reverse().join(""));
  });

  it("does not divide by zero on a flat series", () => {
    // max === min. The naive (v-min)/(max-min) is NaN, which indexes to
    // undefined and prints "undefinedundefined..." across the post.
    const s = sparkline([5, 5, 5, 5], 4);
    expect(s).toBe("▁▁▁▁");
    expect(s).not.toContain("undefined");
  });

  it("returns an empty string rather than a flat line when there is no data", () => {
    // The distinction matters: "" is dropped by the caller, "▁▁▁▁" is a claim
    // that the price did not move.
    expect(sparkline([], 8)).toBe("");
    expect(sparkline([1], 8)).toBe("");
    expect(sparkline([null, undefined], 8)).toBe("");
  });

  it("drops nulls instead of zero-filling them", () => {
    // A null read as 0 draws a cliff to the axis and reads as a crash.
    const s = sparkline([10, null, 11, undefined, 12], 3);
    expect(s).not.toContain("undefined");
    expect(s.length).toBe(3);
    // Rising series, so the last cell must be the top of the ramp.
    expect(s[s.length - 1]).toBe(SPARK_LEVELS[SPARK_LEVELS.length - 1]);
  });

  it("ignores NaN and Infinity", () => {
    // Survivors are [1, 2, 3]; the midpoint scales to 0.5 -> round(3.5) = 4.
    const s = sparkline([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3], 3);
    expect(s).toBe("▁▅█");
  });

  it("never emits more cells than the requested width", () => {
    expect(sparkline(Array.from({ length: 400 }, (_, i) => i), 6)).toHaveLength(6);
    expect(sparkline([1, 2, 3], 8)).toHaveLength(3);
  });

  it("uses only characters from the documented ramp", () => {
    const s = sparkline([3, 1, 4, 1, 5, 9, 2, 6], 8);
    for (const ch of s) expect(SPARK_LEVELS).toContain(ch as (typeof SPARK_LEVELS)[number]);
  });
});

describe("resample", () => {
  it("averages buckets rather than sampling, so spikes survive", () => {
    // Sampling every Nth point drops the spike entirely and draws a calm day.
    const spiky = [0, 0, 100, 0, 0, 0, 0, 0];
    const out = resample(spiky, 4);
    expect(out).toHaveLength(4);
    expect(Math.max(...out)).toBeGreaterThan(0);
  });

  it("passes a short series through untouched", () => {
    expect(resample([1, 2, 3], 8)).toEqual([1, 2, 3]);
  });

  it("handles empty input and a zero width without throwing", () => {
    expect(resample([], 5)).toEqual([]);
    expect(resample([1, 2, 3], 0)).toEqual([]);
  });
});

describe("meter", () => {
  it("fills proportionally", () => {
    expect(meter(0, 10)).toBe("░░░░░░░░░░");
    expect(meter(1, 10)).toBe("██████████");
    expect(meter(0.5, 10)).toBe("█████░░░░░");
  });

  it("clamps out-of-range fractions instead of over-running the width", () => {
    // A score of 100.0001 from float accumulation must render as full, not as
    // an 11-cell bar that breaks the column.
    expect(meter(1.4, 10)).toHaveLength(10);
    expect(meter(-3, 10)).toBe("░░░░░░░░░░");
    expect(meter(Number.NaN, 10)).toBe("");
  });

  it("always returns exactly `width` cells", () => {
    for (const f of [0, 0.13, 0.5, 0.87, 1]) expect(meter(f, 12)).toHaveLength(12);
  });
});

describe("ratioBar", () => {
  it("splits proportionally between the two quantities", () => {
    expect(ratioBar(50, 50, 10)).toBe("█████░░░░░");
    expect(ratioBar(196, 132, 10)).toBe("██████░░░░");
  });

  it("returns empty rather than a 50/50 bar drawn from nothing", () => {
    // A balanced bar built from no data claims a perfectly balanced market.
    expect(ratioBar(0, 0, 10)).toBe("");
    expect(ratioBar(Number.NaN, 5, 10)).toBe("");
  });
});

describe("rangeGauge", () => {
  it("places the marker inside the range", () => {
    expect(rangeGauge(0, 100, 0, 11)).toBe("●──────────");
    expect(rangeGauge(0, 100, 100, 11)).toBe("──────────●");
    expect(rangeGauge(0, 100, 50, 11)).toBe("─────●─────");
  });

  it("returns null rather than guessing when the range is unusable", () => {
    expect(rangeGauge(null, 100, 50)).toBeNull();
    expect(rangeGauge(100, 100, 100)).toBeNull();
    expect(rangeGauge(100, 0, 50)).toBeNull();
    expect(rangeGauge(0, 100, null)).toBeNull();
  });

  it("clamps a price that printed outside its stored range", () => {
    // An intraday print above the stored 52-week high is normal, not an error.
    expect(rangeGauge(0, 100, 140, 11)).toBe("──────────●");
    expect(rangeGauge(0, 100, -10, 11)).toBe("●──────────");
  });
});

describe("arrow", () => {
  it("puts direction in the text, where colour cannot reach", () => {
    expect(arrow(1)).toBe("▲");
    expect(arrow(-1)).toBe("▼");
    expect(arrow(0)).toBe("▬");
    expect(arrow(null)).toBe("▬");
    expect(arrow(Number.NaN)).toBe("▬");
  });
});

describe("sparkline — a bad shape must not take the post down", () => {
  it("returns empty instead of throwing when the series is not an array", () => {
    // `series` comes from an undocumented provider. Throwing here would lose
    // the whole message to save one sparkline.
    expect(sparkline(undefined)).toBe("");
    expect(sparkline(null)).toBe("");
    expect(sparkline({ length: 3 } as unknown as number[])).toBe("");
  });
});
