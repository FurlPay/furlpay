import type { HeadingTrace, TraceLocationSample, TraceOrientationSample } from "./headingTrace";
import { CompassConfidenceEstimator } from "./compassConfidence";
import { HeadingFusion } from "./headingFusion";
import { angleDelta } from "./mapMatchHeading";

// ---------------------------------------------------------------------------
// Replay and measurement.
//
// Feeds a recorded trace through an algorithm and scores the result against the
// trace's ground truth. Deterministic: no timers, no sensors, no Date.now() —
// time comes from the trace, so the same trace and algorithm always produce the
// same numbers, on any machine, in CI.
//
// ── THE METRIC THAT MATTERS ────────────────────────────────────────────────
// p50 heading error is the obvious number and it is not the interesting one. A
// native app with hardware sensor fusion will beat a browser on p50 and there
// is no browser trick that closes that gap.
//
// `confidentWrong` is the one worth competing on: the share of samples where
// the algorithm claimed high confidence AND was badly wrong. A system that says
// "I don't know" when it doesn't know is safer to navigate by than one that is
// slightly more accurate on average and silently confident when it is lost.
// That is a dimension where a browser can genuinely win, because winning
// requires restraint rather than better hardware.
// ---------------------------------------------------------------------------

/** A heading estimate at a moment, from whichever algorithm produced it. */
export interface ReplaySample {
  t: number;
  heading: number | null;
  confidence: number;
  source: string;
}

export interface ReplayResult {
  algorithm: string;
  samples: ReplaySample[];
}

/**
 * An algorithm under test. Given the trace's events in time order, emit an
 * estimate per event. Pure: no shared state between runs.
 */
export type HeadingAlgorithm = (trace: HeadingTrace) => ReplaySample[];

/** Merge the two sensor series into one time-ordered stream, as a live
 *  session would have seen them. */
type Event =
  | { t: number; kind: "loc"; s: TraceLocationSample }
  | { t: number; kind: "orient"; s: TraceOrientationSample };

function timeline(trace: HeadingTrace): Event[] {
  const events: Event[] = [
    ...trace.location.map((s) => ({ t: s.t, kind: "loc" as const, s })),
    ...trace.orientation.map((s) => ({ t: s.t, kind: "orient" as const, s })),
  ];
  // Stable by time; ties keep insertion order, which keeps replay deterministic
  // when a fix and an orientation event share a millisecond.
  return events.sort((a, b) => a.t - b.t);
}

/**
 * Interpret one orientation sample the way deviceHeading.ts does.
 *
 * Duplicated deliberately rather than imported: deviceHeading.ts reads live
 * DOM events, and replay must work from recorded fields with no DOM at all.
 * The conventions are asserted by tests in both places.
 */
export function headingFromOrientation(s: TraceOrientationSample): number | null {
  if (s.webkitCompassHeading !== null && s.webkitCompassHeading >= 0) {
    return (s.webkitCompassHeading + s.screenAngle) % 360;
  }
  // A relative event is a game frame, not a compass.
  if (!s.absolute && s.event !== "deviceorientationabsolute") return null;
  if (s.alpha === null) return null;
  return (360 - s.alpha + s.screenAngle) % 360;
}

// --- baselines --------------------------------------------------------------

/** BASELINE A — whatever the magnetometer last said. No filtering, full
 *  confidence. This is what the map drew before commit e73a872. */
export const rawCompass: HeadingAlgorithm = (trace) => {
  const out: ReplaySample[] = [];
  for (const e of timeline(trace)) {
    if (e.kind !== "orient") continue;
    const h = headingFromOrientation(e.s);
    if (h === null) continue;
    out.push({ t: e.t, heading: h, confidence: 1, source: "compass" });
  }
  return out;
};

/** BASELINE B — GPS course only. Correct while moving, absent at rest. */
export const rawGpsCourse: HeadingAlgorithm = (trace) => {
  const out: ReplaySample[] = [];
  for (const e of timeline(trace)) {
    if (e.kind !== "loc") continue;
    const c = e.s.course;
    out.push({
      t: e.t,
      heading: c !== null && Number.isFinite(c) ? c : null,
      confidence: c !== null && Number.isFinite(c) ? 1 : 0,
      source: "gps",
    });
  }
  return out;
};

/** BASELINE E — never claims to know. The floor for confidentWrong (zero, by
 *  construction) and the ceiling for uselessness. Included so the metric table
 *  shows what "safe but unhelpful" scores, which stops confidentWrong being
 *  read as the only thing that matters. */
export const alwaysUncertain: HeadingAlgorithm = (trace) =>
  timeline(trace).map((e) => ({ t: e.t, heading: null, confidence: 0, source: "none" }));

/** BASELINE C — the shipped engine, driven exactly as HotelMap drives it. */
export const furlpayFusion: HeadingAlgorithm = (trace) => {
  const fusion = new HeadingFusion();
  const compass = new CompassConfidenceEstimator();
  const out: ReplaySample[] = [];

  let lastCompass: number | null = null;
  let lastCourse: number | null = null;
  let lastSpeed: number | null = null;
  let lastAccuracy: number | null = null;

  for (const e of timeline(trace)) {
    if (e.kind === "orient") {
      const h = headingFromOrientation(e.s);
      if (h !== null) {
        lastCompass = h;
        compass.push(h, e.s.webkitCompassAccuracy);
      }
    } else {
      lastCourse = e.s.course !== null && Number.isFinite(e.s.course) ? e.s.course : null;
      lastSpeed = e.s.speed;
      lastAccuracy = e.s.accuracy;
    }

    const fused = fusion.update({
      compassHeading: lastCompass,
      compassConfidence: compass.confidence(),
      gpsCourse: lastCourse,
      speed: lastSpeed,
      positionAccuracy: lastAccuracy,
      mapMatch: null,
      now: e.t,
    });
    out.push({ t: e.t, heading: fused.heading, confidence: fused.confidence, source: fused.source });
  }
  return out;
};

export const ALGORITHMS: Record<string, HeadingAlgorithm> = {
  "raw-compass": rawCompass,
  "raw-gps-course": rawGpsCourse,
  "furlpay-fusion": furlpayFusion,
  "always-uncertain": alwaysUncertain,
};

export function replay(trace: HeadingTrace, name: string): ReplayResult {
  const algorithm = ALGORITHMS[name];
  if (!algorithm) throw new Error(`Unknown algorithm "${name}"`);
  return { algorithm: name, samples: algorithm(trace) };
}

// --- metrics ----------------------------------------------------------------

export interface MetricThresholds {
  /** Confidence at or above which the algorithm is making a claim. */
  confidentAt: number;
  /** Error beyond which that claim is wrong enough to mislead someone. */
  wrongBeyondDeg: number;
}

/**
 * Defaults, and why.
 *
 * 0.7 confidence is where a UI would draw a narrow, assured cone rather than a
 * vague wedge. 45 degrees is the error at which a heading stops being a useful
 * hint and starts pointing down the wrong street — at a four-way junction it is
 * exactly the error that sends someone the wrong way. Both are configurable
 * because they are product judgements, not physics.
 */
export const DEFAULT_THRESHOLDS: MetricThresholds = { confidentAt: 0.7, wrongBeyondDeg: 45 };

export interface HeadingMetrics {
  algorithm: string;
  /** Samples that could be scored — an estimate AND nearby ground truth. */
  scored: number;
  /** Estimates the algorithm declined to make, as a share of all samples. */
  nullRate: number;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
  /** THE metric: confident and badly wrong, as a share of scored samples. */
  confidentWrong: number;
  /** Median absolute change between consecutive estimates while stationary.
   *  A stationary reader should see a still arrow. */
  stationaryJitter: number | null;
  /** Source changes per minute. High means a visibly flickering arrow. */
  sourceSwitchesPerMin: number;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/**
 * Ground truth nearest in time, if it is close enough to mean anything.
 *
 * A truth sample five seconds from an estimate is not truth about that
 * estimate — the reader may have turned. Beyond the window the sample is not
 * scored at all, which is why `scored` is reported alongside every percentile.
 */
function truthAt(trace: HeadingTrace, t: number, windowMs = 2000): number | null {
  let best: { d: number; heading: number } | null = null;
  for (const s of trace.truth) {
    const d = Math.abs(s.t - t);
    if (d > windowMs) continue;
    if (!best || d < best.d) best = { d, heading: s.heading };
  }
  return best?.heading ?? null;
}

/** Was the reader moving at this moment, per the nearest fix? */
function movingAt(trace: HeadingTrace, t: number, windowMs = 3000): boolean | null {
  let best: { d: number; speed: number | null } | null = null;
  for (const s of trace.location) {
    const d = Math.abs(s.t - t);
    if (d > windowMs) continue;
    if (!best || d < best.d) best = { d, speed: s.speed };
  }
  if (!best || best.speed === null || !Number.isFinite(best.speed)) return null;
  return best.speed >= 0.5;
}

export function measure(
  trace: HeadingTrace,
  result: ReplayResult,
  thresholds: MetricThresholds = DEFAULT_THRESHOLDS
): HeadingMetrics {
  const errors: number[] = [];
  let confidentWrong = 0;
  let nulls = 0;
  let switches = 0;
  let lastSource: string | null = null;

  const stationaryDeltas: number[] = [];
  let prevStationary: { t: number; heading: number } | null = null;

  for (const s of result.samples) {
    if (s.heading === null) nulls++;
    if (lastSource !== null && s.source !== lastSource) switches++;
    lastSource = s.source;

    if (s.heading !== null && movingAt(trace, s.t) === false) {
      if (prevStationary) stationaryDeltas.push(Math.abs(angleDelta(prevStationary.heading, s.heading)));
      prevStationary = { t: s.t, heading: s.heading };
    } else {
      prevStationary = null;
    }

    const truth = truthAt(trace, s.t);
    if (truth === null || s.heading === null) continue;
    const err = Math.abs(angleDelta(s.heading, truth));
    errors.push(err);
    if (s.confidence >= thresholds.confidentAt && err > thresholds.wrongBeyondDeg) confidentWrong++;
  }

  errors.sort((a, b) => a - b);
  stationaryDeltas.sort((a, b) => a - b);

  const spanMs = result.samples.length
    ? result.samples[result.samples.length - 1].t - result.samples[0].t
    : 0;
  const minutes = spanMs > 0 ? spanMs / 60_000 : 0;

  return {
    algorithm: result.algorithm,
    scored: errors.length,
    nullRate: result.samples.length ? nulls / result.samples.length : 0,
    p50: percentile(errors, 50),
    p75: percentile(errors, 75),
    p90: percentile(errors, 90),
    p95: percentile(errors, 95),
    max: errors.length ? errors[errors.length - 1] : null,
    // Share of SCORED samples, not of all samples: an algorithm that stays
    // silent must not be able to lower this by refusing to answer.
    confidentWrong: errors.length ? confidentWrong / errors.length : 0,
    stationaryJitter: percentile(stationaryDeltas, 50),
    sourceSwitchesPerMin: minutes > 0 ? switches / minutes : 0,
  };
}

/** Run every registered algorithm over one trace. */
export function benchmark(
  trace: HeadingTrace,
  thresholds: MetricThresholds = DEFAULT_THRESHOLDS
): HeadingMetrics[] {
  return Object.keys(ALGORITHMS).map((name) => measure(trace, replay(trace, name), thresholds));
}

/** Fixed-width table, for a commit message or a terminal. */
export function formatMetrics(rows: HeadingMetrics[]): string {
  const n = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
  const pct = (v: number) => (v * 100).toFixed(1) + "%";
  const head =
    "  algorithm          scored   p50    p95    max   confWrong  nullRate  jitter  switch/min";
  const lines = rows.map(
    (r) =>
      "  " +
      r.algorithm.padEnd(18) +
      String(r.scored).padStart(6) +
      n(r.p50).padStart(7) +
      n(r.p95).padStart(7) +
      n(r.max).padStart(7) +
      pct(r.confidentWrong).padStart(11) +
      pct(r.nullRate).padStart(10) +
      n(r.stationaryJitter).padStart(8) +
      n(r.sourceSwitchesPerMin).padStart(12)
  );
  return [head, ...lines].join("\n");
}
