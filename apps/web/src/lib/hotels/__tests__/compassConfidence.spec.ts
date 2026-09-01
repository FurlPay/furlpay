import { describe, it, expect } from "vitest";
import {
  CompassConfidenceEstimator,
  calibrationHint,
  preferGpsCourse,
  WINDOW_SIZE,
} from "../compassConfidence";

// The whole point of this module is to be right about angles, and angle bugs
// are silent: they return a plausible number rather than throwing. The
// wrap-around cases below are the ones a linear mean gets wrong.

const feed = (e: CompassConfidenceEstimator, headings: number[], acc: number | null = null) => {
  for (const h of headings) e.push(h, acc);
  return e;
};
const repeat = (v: number, n: number) => Array.from({ length: n }, () => v);
const jitter = (centre: number, spread: number, n: number) =>
  Array.from({ length: n }, (_, i) => centre + (i % 2 ? spread : -spread));

describe("circular statistics — where a linear mean would be wrong", () => {
  it("treats 359 and 1 as one degree apart, not 358", () => {
    // The canonical failure: a naive average gives 180 and reports total
    // disagreement for two readings that are essentially identical.
    const e = feed(new CompassConfidenceEstimator(), [
      ...repeat(359, 10), ...repeat(1, 10),
    ]);
    expect(e.resultantLength()).toBeGreaterThan(0.99);
    expect(e.confidence().level).toBe("high");
  });

  it("reports near-total disagreement for opposed headings", () => {
    const e = feed(new CompassConfidenceEstimator(), [...repeat(0, 10), ...repeat(180, 10)]);
    expect(e.resultantLength()).toBeLessThan(0.05);
    expect(e.confidence().level).toBe("low");
  });

  it("reports disagreement for headings spread around the whole circle", () => {
    const e = feed(new CompassConfidenceEstimator(),
      Array.from({ length: 36 }, (_, i) => i * 10));
    expect(e.resultantLength()).toBeLessThan(0.1);
    expect(e.confidence().level).toBe("low");
  });
});

describe("inferring confidence from jitter", () => {
  it("calls a rock-steady heading high", () => {
    const e = feed(new CompassConfidenceEstimator(), repeat(90, 20));
    const c = e.confidence();
    expect(c.level).toBe("high");
    expect(c.source).toBe("inferred");
    expect(c.needsCalibration).toBe(false);
  });

  it("calls a wildly wandering heading low, and asks for a figure-8", () => {
    const e = feed(new CompassConfidenceEstimator(), jitter(90, 60, 20));
    const c = e.confidence();
    expect(c.level).toBe("low");
    expect(c.needsCalibration).toBe(true);
    expect(calibrationHint(c)).toMatch(/figure-8/);
  });

  it("does not nag about a mild wobble", () => {
    // Medium is usable. A prompt on every small movement trains people to
    // dismiss the prompt, which costs the one case that mattered.
    const e = feed(new CompassConfidenceEstimator(), jitter(90, 12, 20));
    const c = e.confidence();
    expect(c.level).toBe("medium");
    expect(c.needsCalibration).toBe(false);
    expect(calibrationHint(c)).toBeNull();
  });

  it("withholds judgement until it has seen enough", () => {
    const e = feed(new CompassConfidenceEstimator(), [90, 91, 92]);
    const c = e.confidence();
    expect(c.level).toBe("unknown");
    expect(c.needsCalibration).toBe(false);
    expect(e.spreadDegrees()).toBeNull();
  });
});

describe("the OS is believed over any inference", () => {
  it("uses a reported accuracy when the platform gives one", () => {
    // Wildly jittery samples, but iOS says the error is 5 degrees. iOS wins.
    const e = feed(new CompassConfidenceEstimator(), jitter(90, 60, 20), 5);
    const c = e.confidence();
    expect(c.source).toBe("reported");
    expect(c.level).toBe("high");
    expect(c.errorDegrees).toBe(5);
  });

  it("calls a large reported error low", () => {
    const e = feed(new CompassConfidenceEstimator(), repeat(90, 20), 40);
    expect(e.confidence().level).toBe("low");
  });

  it("treats a NEGATIVE reported accuracy as no reading, not a tiny error", () => {
    // Safari uses -1 to mean "uncalibrated". Taken at face value it would be
    // the best accuracy ever reported.
    const e = feed(new CompassConfidenceEstimator(), jitter(90, 60, 20), -1);
    const c = e.confidence();
    expect(c.source).toBe("inferred");
    expect(c.level).toBe("low");
  });
});

describe("window management", () => {
  it("keeps only the most recent samples", () => {
    const e = new CompassConfidenceEstimator();
    feed(e, repeat(0, WINDOW_SIZE));      // fill with one heading
    feed(e, repeat(90, WINDOW_SIZE));     // then completely replace it
    // If the old samples were still counted, R would be ~0.7 (0 and 90 mixed).
    expect(e.resultantLength()).toBeGreaterThan(0.99);
  });

  it("forgets everything on reset", () => {
    const e = feed(new CompassConfidenceEstimator(), repeat(90, 20));
    e.reset();
    expect(e.confidence().level).toBe("unknown");
    expect(e.resultantLength()).toBe(0);
  });

  it("ignores non-finite headings rather than poisoning the window", () => {
    const e = new CompassConfidenceEstimator();
    feed(e, repeat(90, 20));
    e.push(NaN);
    e.push(Infinity);
    expect(e.confidence().level).toBe("high");
  });
});

describe("preferring GPS course — the web's 'walk to recalibrate'", () => {
  const low = { level: "low", errorDegrees: 40, needsCalibration: true, source: "inferred" } as const;
  const high = { level: "high", errorDegrees: 3, needsCalibration: false, source: "reported" } as const;

  it("believes GPS when moving with a doubtful compass", () => {
    expect(preferGpsCourse(low, 1.4)).toBe(true);
  });

  it("keeps the compass when standing still, however doubtful", () => {
    // Course-over-ground does not exist at rest, which is exactly when a
    // compass is most needed.
    expect(preferGpsCourse(low, 0)).toBe(false);
    expect(preferGpsCourse(low, 0.2)).toBe(false);
  });

  it("keeps a trusted compass even while moving", () => {
    expect(preferGpsCourse(high, 3.0)).toBe(false);
  });

  it("keeps the compass when speed is unknown", () => {
    expect(preferGpsCourse(low, null)).toBe(false);
    expect(preferGpsCourse(low, NaN)).toBe(false);
  });
});
