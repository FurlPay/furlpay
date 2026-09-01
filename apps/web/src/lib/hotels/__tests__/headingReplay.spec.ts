import { describe, it, expect } from "vitest";
import {
  TRACE_VERSION,
  TraceRecorder,
  anonymize,
  parseTrace,
  serializeTrace,
  type HeadingTrace,
  type TraceEnvironment,
} from "../headingTrace";
import {
  ALGORITHMS,
  benchmark,
  formatMetrics,
  headingFromOrientation,
  measure,
  recoveryTime,
  replay,
  type ReplayResult,
} from "../headingReplay";

const ENV: TraceEnvironment = {
  userAgent: "test", platform: "test",
  hasAbsoluteEvent: true, needsOrientationPermission: false, screenAngleSupported: true,
};

/**
 * Build a synthetic walk.
 *
 * Synthetic, and labelled as such everywhere it is used: these encode the
 * failure modes we believe in, so they can only confirm the harness measures
 * what it claims. They cannot tell us how the engine behaves on a real street —
 * only field traces do that, and the numbers below must never be quoted as if
 * they were field results.
 */
function walk(opts: {
  scenario: string;
  trueHeading: number;
  /** Constant error added to every compass reading. A steel doorframe. */
  compassBias?: number;
  /** Peak random wobble added to the compass, degrees. */
  compassNoise?: number;
  speed?: number;
  accuracy?: number;
  samples?: number;
  /** Emit no GPS course at all — a stationary reader, or a lost fix. */
  noCourse?: boolean;
}): HeadingTrace {
  const {
    scenario, trueHeading, compassBias = 0, compassNoise = 0,
    speed = 1.4, accuracy = 8, samples = 60, noCourse = false,
  } = opts;
  const r = new TraceRecorder(scenario, ENV, 0);
  // Deterministic pseudo-noise: a seeded LCG, so the benchmark is reproducible
  // in CI. Math.random() here would make every run a different experiment.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

  for (let i = 0; i < samples; i++) {
    const t = i * 1000;
    r.location({
      lat: 48.8566 + i * 0.00001, lng: 2.3522, accuracy,
      altitude: null, altitudeAccuracy: null,
      course: noCourse ? null : trueHeading,
      speed: noCourse ? 0 : speed,
    }, t);
    // Orientation arrives far faster than GPS; four per fix is enough to
    // exercise the confidence estimator's window without bloating the trace.
    for (let k = 0; k < 4; k++) {
      const h = (trueHeading + compassBias + rand() * compassNoise + 360) % 360;
      r.orientation({
        alpha: (360 - h) % 360, beta: 0, gamma: 0, absolute: true,
        webkitCompassHeading: null, webkitCompassAccuracy: null,
        event: "deviceorientationabsolute", screenAngle: 0,
      }, t + k * 250);
    }
    r.truth({ heading: trueHeading, errorDegrees: 1, method: "known-route-leg" }, t);
  }
  return r.build();
}

describe("trace schema", () => {
  it("records the raw sensor inputs, not the engine's conclusion", () => {
    const t = walk({ scenario: "x", trueHeading: 90, samples: 3 });
    expect(t.version).toBe(TRACE_VERSION);
    expect(t.location.length).toBe(3);
    expect(t.orientation.length).toBe(12);
    // Storing only a fused output would make the trace replayable by exactly
    // one algorithm — the one that produced it.
    expect(t.orientation[0]).toHaveProperty("alpha");
    expect(t.orientation[0]).toHaveProperty("absolute");
  });

  it("uses relative timestamps, carrying no wall clock", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 3 });
    expect(t.location[0].t).toBe(0);
    expect(t.location.every((s) => s.t < 10_000)).toBe(true);
  });

  it("round-trips through serialization", () => {
    const t = walk({ scenario: "round trip", trueHeading: 45, samples: 4 });
    const back = parseTrace(serializeTrace(t));
    expect(back.scenario).toBe("round trip");
    expect(back.location).toHaveLength(4);
  });

  it("refuses a trace from a schema it does not understand", () => {
    // Reading a future trace with today's field meanings produces numbers that
    // look valid and are not. An error is strictly better.
    const t = walk({ scenario: "x", trueHeading: 0, samples: 2 });
    const future = JSON.stringify({ ...t, version: 99 });
    expect(() => parseTrace(future)).toThrow(/version/i);
  });

  it("anonymizes by rebasing position, keeping the walk's shape", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 5 });
    const a = anonymize(t);
    expect(a.anonymized).toBe(true);
    expect(a.location[0].lat).toBe(0);
    expect(a.location[0].lng).toBe(0);
    // The shape survives: successive deltas are what a heading algorithm reads.
    const before = t.location[4].lat - t.location[0].lat;
    const after = a.location[4].lat - a.location[0].lat;
    expect(after).toBeCloseTo(before, 6);
    // Altitude is dropped outright — it identifies a floor and nothing reads it.
    expect(a.location[0].altitude).toBeNull();
  });
});

describe("orientation interpretation", () => {
  it("converts Android alpha (counter-clockwise) to a clockwise heading", () => {
    expect(headingFromOrientation({
      t: 0, alpha: 90, beta: 0, gamma: 0, absolute: true,
      webkitCompassHeading: null, webkitCompassAccuracy: null,
      event: "deviceorientationabsolute", screenAngle: 0,
    })).toBe(270);
  });

  it("refuses a relative event — it is a game frame, not a compass", () => {
    expect(headingFromOrientation({
      t: 0, alpha: 90, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: null, webkitCompassAccuracy: null,
      event: "deviceorientation", screenAngle: 0,
    })).toBeNull();
  });

  it("adds the screen angle so landscape does not shift the heading", () => {
    expect(headingFromOrientation({
      t: 0, alpha: 0, beta: 0, gamma: 0, absolute: true,
      webkitCompassHeading: null, webkitCompassAccuracy: null,
      event: "deviceorientationabsolute", screenAngle: 90,
    })).toBe(90);
  });
});

describe("replay is deterministic", () => {
  it("produces identical output for identical input", () => {
    const t = walk({ scenario: "determinism", trueHeading: 120, compassNoise: 20 });
    const a = replay(t, "furlpay-fusion");
    const b = replay(t, "furlpay-fusion");
    expect(a.samples).toEqual(b.samples);
  });

  it("carries no dependency on live sensors or the wall clock", () => {
    // If it did, two runs milliseconds apart would differ.
    const t = walk({ scenario: "x", trueHeading: 0 });
    expect(replay(t, "raw-compass").samples).toEqual(replay(t, "raw-compass").samples);
  });

  it("rejects an unknown algorithm by name", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 2 });
    expect(() => replay(t, "nope")).toThrow(/unknown algorithm/i);
  });
});

describe("metrics", () => {
  it("scores a perfect compass at zero error", () => {
    const t = walk({ scenario: "clean", trueHeading: 90 });
    const m = measure(t, replay(t, "raw-compass"));
    expect(m.p50).toBeCloseTo(0, 1);
    expect(m.confidentWrong).toBe(0);
  });

  it("catches a biased compass that still claims full confidence", () => {
    // The exact failure the map had before e73a872: a steel doorframe throws
    // the magnetometer 90 degrees and the arrow stays crisp.
    const t = walk({ scenario: "steel doorframe", trueHeading: 0, compassBias: 90 });
    const m = measure(t, replay(t, "raw-compass"));
    expect(m.p50).toBeGreaterThan(80);
    expect(m.confidentWrong).toBeGreaterThan(0.9);
  });

  it("gives the always-uncertain baseline a confidentWrong of exactly zero", () => {
    const t = walk({ scenario: "x", trueHeading: 45 });
    const m = measure(t, replay(t, "always-uncertain"));
    expect(m.confidentWrong).toBe(0);
    expect(m.nullRate).toBe(1); // and it is useless, which the table must show
  });

  it("measures confidentWrong over SCORED samples, so silence cannot game it", () => {
    // An algorithm must not be able to improve this metric by refusing to
    // answer; that is why the denominator excludes nulls.
    const t = walk({ scenario: "x", trueHeading: 0, compassBias: 90 });
    const m = measure(t, replay(t, "raw-compass"));
    expect(m.scored).toBeGreaterThan(0);
    expect(m.confidentWrong).toBeLessThanOrEqual(1);
  });

  it("honours configurable thresholds", () => {
    const t = walk({ scenario: "x", trueHeading: 0, compassBias: 50 });
    const strict = measure(t, replay(t, "raw-compass"), { confidentAt: 0.7, wrongBeyondDeg: 30 });
    const lax = measure(t, replay(t, "raw-compass"), { confidentAt: 0.7, wrongBeyondDeg: 80 });
    expect(strict.confidentWrong).toBeGreaterThan(lax.confidentWrong);
  });
});

describe("baseline comparison on synthetic traces", () => {
  it("reports a full table per scenario", () => {
    const scenarios = [
      walk({ scenario: "A. clean walk, good compass", trueHeading: 90, compassNoise: 3 }),
      walk({ scenario: "B. magnetic interference (+90 bias)", trueHeading: 0, compassBias: 90, compassNoise: 5 }),
      walk({ scenario: "C. noisy compass, no bias", trueHeading: 180, compassNoise: 70 }),
      walk({ scenario: "D. stationary, no GPS course", trueHeading: 270, compassNoise: 4, noCourse: true }),
    ];
    for (const t of scenarios) {
      console.log(`\n  ${t.scenario}   [SYNTHETIC]`);
      console.log(formatMetrics(benchmark(t)));
    }
    console.log("");
    expect(Object.keys(ALGORITHMS)).toHaveLength(4);
  });

  it("the fusion engine beats the raw compass on confidentWrong under interference", () => {
    // The claim the engine exists to support, stated as a measurement rather
    // than an opinion. Synthetic, so it demonstrates the harness can detect the
    // difference — not the size of it on a real street.
    const t = walk({ scenario: "interference", trueHeading: 0, compassBias: 90, compassNoise: 5 });
    const raw = measure(t, replay(t, "raw-compass"));
    const fused = measure(t, replay(t, "furlpay-fusion"));
    console.log(`\n  raw-compass    confidentWrong ${(raw.confidentWrong * 100).toFixed(1)}%`);
    console.log(`  furlpay-fusion confidentWrong ${(fused.confidentWrong * 100).toFixed(1)}%\n`);
    expect(fused.confidentWrong).toBeLessThan(raw.confidentWrong);
  });
});

describe("coverage — the counterweight to confidentWrong", () => {
  /** Hand-built results, so a specific gaming strategy can be scored directly. */
  const results = (t: HeadingTrace, f: (i: number) => { heading: number | null; confidence: number }): ReplayResult => ({
    algorithm: "probe",
    samples: t.location.map((s, i) => ({ t: s.t, source: "probe", ...f(i) })),
  });

  it("reports zero coverage for an algorithm that never answers", () => {
    const t = walk({ scenario: "x", trueHeading: 45 });
    const m = measure(t, replay(t, "always-uncertain"));
    expect(m.coverage).toBe(0);
    expect(m.confidentCoverage).toBe(0);
  });

  it("catches the hedging cheat that confidentWrong alone rewards", () => {
    // Answers every sample, 90 degrees wrong, but always just under the
    // confidence bar. confidentWrong says it is flawless. It is not: the reader
    // is shown a wrong arrow, permanently, in a wide wedge.
    const t = walk({ scenario: "hedge", trueHeading: 0 });
    const hedged = measure(t, results(t, () => ({ heading: 90, confidence: 0.69 })));
    expect(hedged.confidentWrong).toBe(0);   // gamed
    expect(hedged.coverage).toBe(1);         // and full coverage, so that misses it too
    expect(hedged.confidentCoverage).toBe(0); // only this column notices
    expect(hedged.p50).toBeCloseTo(90, 0);
  });

  it("gives an honest confident algorithm full confident coverage", () => {
    const t = walk({ scenario: "honest", trueHeading: 0 });
    const m = measure(t, results(t, () => ({ heading: 0, confidence: 0.9 })));
    expect(m.confidentCoverage).toBe(1);
    expect(m.confidentWrong).toBe(0);
  });
});

describe("risk-weighted error", () => {
  const flat = (t: HeadingTrace, heading: number, confidence: number): ReplayResult => ({
    algorithm: "probe",
    samples: t.location.map((s) => ({ t: s.t, heading, confidence, source: "probe" })),
  });

  it("charges less for the same error when it was asserted quietly", () => {
    const t = walk({ scenario: "x", trueHeading: 0 });
    const loud = measure(t, flat(t, 40, 1.0));
    const quiet = measure(t, flat(t, 40, 0.2));
    // Identical p50; the cost to a reader is not identical.
    expect(loud.p50).toBeCloseTo(quiet.p50!, 3);
    expect(quiet.riskWeightedError!).toBeLessThan(loud.riskWeightedError!);
    expect(loud.riskWeightedError!).toBeCloseTo(40, 0);
    expect(quiet.riskWeightedError!).toBeCloseTo(8, 0);
  });

  it("is null when nothing could be scored", () => {
    const t = walk({ scenario: "x", trueHeading: 0 });
    expect(measure(t, replay(t, "always-uncertain")).riskWeightedError).toBeNull();
  });
});

describe("convergence is measured from the LAST excursion, not the first crossing", () => {
  const from = (t: HeadingTrace, errs: number[]): ReplayResult => ({
    algorithm: "probe",
    samples: errs.map((e, i) => ({ t: t.location[i].t, heading: (t.truth[i].heading + e) % 360, confidence: 1, source: "probe" })),
  });

  it("does not credit an algorithm that passes through the right answer", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 6 });
    // Correct at sample 1, then wrong again, and only settles at sample 4.
    const m = measure(t, from(t, [80, 2, 80, 80, 3, 2]));
    // First crossing was 1s in. It had not converged; it left again.
    expect(m.convergenceSec).toBe(4);
  });

  it("returns null when the error never settles", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 5 });
    // Null, not zero and not the trace length: "never converged" is a finding.
    expect(measure(t, from(t, [80, 80, 5, 80, 80])).convergenceSec).toBeNull();
  });

  it("reports zero when it was right from the first sample", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 4 });
    expect(measure(t, from(t, [1, 1, 2, 1])).convergenceSec).toBe(0);
  });
});

describe("recovery after a disturbance", () => {
  const from = (t: HeadingTrace, errs: number[]): ReplayResult => ({
    algorithm: "probe",
    samples: errs.map((e, i) => ({ t: t.location[i].t, heading: (t.truth[i].heading + e) % 360, confidence: 1, source: "probe" })),
  });

  it("measures from the moment of the disturbance, not the start of the walk", () => {
    const t = walk({ scenario: "magnet at 3s", trueHeading: 0, samples: 8 });
    // Clean, then a magnet at t=3000, wrong for two fixes, then settled.
    const r = from(t, [1, 2, 1, 90, 88, 4, 2, 1]);
    expect(recoveryTime(t, r, 3000)).toBe(2);
  });

  it("returns null when it never recovers inside the trace", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 6 });
    expect(recoveryTime(t, from(t, [1, 1, 1, 90, 90, 90]), 3000)).toBeNull();
  });

  it("returns null when there is nothing after the disturbance to judge", () => {
    const t = walk({ scenario: "x", trueHeading: 0, samples: 4 });
    expect(recoveryTime(t, from(t, [1, 1, 1, 1]), 99_000)).toBeNull();
  });
});
