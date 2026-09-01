// ---------------------------------------------------------------------------
// Sensor traces: recording what the device actually reported.
//
// The point of this file is to make every future heading change arguable with
// numbers. Right now a change to the fusion engine can only be defended with
// "it feels better on my phone", which is not a defence — it is a sample size
// of one, unrepeatable, and biased toward whatever the author happened to test.
// A recorded trace replayed against two algorithms gives a difference you can
// put in a commit message.
//
// ── WHY RAW INPUTS, NOT THE FUSED OUTPUT ───────────────────────────────────
// The trace stores what the SENSORS said, not what the engine concluded. Store
// the conclusion and you can only ever replay the algorithm that produced it;
// store the inputs and every future algorithm can be run against the same
// walk. The engine's output is recorded too, but only as one more series to
// compare against — never as the thing being replayed.
//
// ── PRIVACY ────────────────────────────────────────────────────────────────
// A trace is a precise record of where somebody walked, which is about as
// sensitive as location data gets. So: recording is opt-in and dev-only, the
// data never leaves the device unless a human exports it, `anonymize()` strips
// absolute position by rebasing every fix onto a local origin, and the schema
// deliberately has no field for a user id, a session id or a device serial. A
// trace should be safe to attach to a bug report; that is the bar.
// ---------------------------------------------------------------------------

/** Bumped whenever a field changes meaning. Replay refuses a version it does
 *  not understand rather than silently misreading an old trace. */
export const TRACE_VERSION = 1 as const;

/** One geolocation fix, exactly as the Geolocation API reported it. */
export interface TraceLocationSample {
  /** Milliseconds since the trace began. Relative so traces are comparable and
   *  carry no wall-clock information about when somebody was somewhere. */
  t: number;
  lat: number;
  lng: number;
  /** Metres, 95% confidence, as reported. */
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  /** Degrees clockwise from TRUE north per the Geolocation spec, null at rest. */
  course: number | null;
  /** Metres per second. */
  speed: number | null;
}

/** One orientation event, before any interpretation. */
export interface TraceOrientationSample {
  t: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** The event's own absolute flag. A relative event is not a compass. */
  absolute: boolean;
  /** iOS only. Degrees; Apple documents this as relative to MAGNETIC north. */
  webkitCompassHeading: number | null;
  /** iOS only. Negative means the reading is invalid, not superbly accurate. */
  webkitCompassAccuracy: number | null;
  /** Which event delivered this — the two have different alpha conventions. */
  event: "deviceorientation" | "deviceorientationabsolute";
  /** screen.orientation.angle at the moment of capture. Landscape shifts alpha. */
  screenAngle: number;
}

/**
 * A known-true heading at a moment, from outside the sensors.
 *
 * Without at least a few of these a trace can measure stability and agreement
 * but not correctness — two algorithms can be compared to each other, and
 * neither to reality.
 */
export interface TraceTruthSample {
  t: number;
  /** Degrees clockwise from true north. */
  heading: number;
  /** Documented, not guessed: how wrong this reference itself might be. */
  errorDegrees: number;
  method: "surveyed-bearing" | "known-route-leg" | "landmark-sight" | "external-gnss";
  note?: string;
}

/** What the live engine concluded, kept for comparison only. */
export interface TraceFusionSample {
  t: number;
  heading: number | null;
  confidence: number;
  state: string;
  source: string;
}

/** Capability inventory, so a trace can be interpreted years later. */
export interface TraceEnvironment {
  userAgent: string;
  platform: string;
  /** Whether the absolute orientation event exists at all on this browser. */
  hasAbsoluteEvent: boolean;
  /** Whether iOS's permission gate is present (implies webkit heading). */
  needsOrientationPermission: boolean;
  screenAngleSupported: boolean;
}

export interface HeadingTrace {
  version: typeof TRACE_VERSION;
  /** Free text: "walking north along Rue de Rivoli, phone in hand". */
  scenario: string;
  environment: TraceEnvironment;
  /** Absolute position is removed by anonymize(); this records whether it was. */
  anonymized: boolean;
  location: TraceLocationSample[];
  orientation: TraceOrientationSample[];
  truth: TraceTruthSample[];
  fusion: TraceFusionSample[];
}

/**
 * Collects samples in memory. Dev-only by intent — nothing here should run for
 * an ordinary visitor, and nothing here transmits anything.
 */
export class TraceRecorder {
  private readonly trace: HeadingTrace;
  private readonly startedAt: number;

  constructor(scenario: string, environment: TraceEnvironment, startedAt = Date.now()) {
    this.startedAt = startedAt;
    this.trace = {
      version: TRACE_VERSION,
      scenario,
      environment,
      anonymized: false,
      location: [],
      orientation: [],
      truth: [],
      fusion: [],
    };
  }

  private rel(at: number): number {
    return Math.max(0, Math.round(at - this.startedAt));
  }

  location(s: Omit<TraceLocationSample, "t">, at = Date.now()): void {
    this.trace.location.push({ ...s, t: this.rel(at) });
  }

  orientation(s: Omit<TraceOrientationSample, "t">, at = Date.now()): void {
    this.trace.orientation.push({ ...s, t: this.rel(at) });
  }

  truth(s: Omit<TraceTruthSample, "t">, at = Date.now()): void {
    this.trace.truth.push({ ...s, t: this.rel(at) });
  }

  fusion(s: Omit<TraceFusionSample, "t">, at = Date.now()): void {
    this.trace.fusion.push({ ...s, t: this.rel(at) });
  }

  /** Sample counts, for a recording indicator that does not leak coordinates. */
  counts() {
    return {
      location: this.trace.location.length,
      orientation: this.trace.orientation.length,
      truth: this.trace.truth.length,
      fusion: this.trace.fusion.length,
    };
  }

  build(): HeadingTrace {
    // Copied, so a caller cannot mutate the recorder's arrays afterwards.
    return {
      ...this.trace,
      location: [...this.trace.location],
      orientation: [...this.trace.orientation],
      truth: [...this.trace.truth],
      fusion: [...this.trace.fusion],
    };
  }
}

/**
 * Rebase a trace onto a local origin, destroying absolute position.
 *
 * Heading algorithms care about the SHAPE of a walk — bearings between
 * successive fixes, speeds, accuracies — and none of that changes when the
 * whole path is translated. So a trace can be made safe to share while staying
 * completely usable for the thing it exists for.
 *
 * Note what this does not claim: a distinctive route shape can still identify a
 * place to someone determined enough. This removes the coordinates, not every
 * possible inference, and it is applied on top of "do not share traces you
 * would not attach to a bug report", not instead of it.
 */
export function anonymize(trace: HeadingTrace): HeadingTrace {
  const first = trace.location[0];
  if (!first) return { ...trace, anonymized: true };
  const dLat = first.lat;
  const dLng = first.lng;
  return {
    ...trace,
    anonymized: true,
    // Altitude is dropped rather than rebased: it identifies a building floor
    // and no heading algorithm reads it.
    location: trace.location.map((s) => ({
      ...s,
      lat: Math.round((s.lat - dLat) * 1e7) / 1e7,
      lng: Math.round((s.lng - dLng) * 1e7) / 1e7,
      altitude: null,
      altitudeAccuracy: null,
    })),
  };
}

/** Detect what this browser can actually give us, for the trace header. */
export function detectEnvironment(): TraceEnvironment {
  const w = typeof window === "undefined" ? undefined : window;
  const doe = w
    ? (w as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } })
        .DeviceOrientationEvent
    : undefined;
  return {
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    platform: typeof navigator === "undefined" ? "" : (navigator.platform ?? ""),
    hasAbsoluteEvent: Boolean(w && "ondeviceorientationabsolute" in w),
    needsOrientationPermission: typeof doe?.requestPermission === "function",
    screenAngleSupported: Boolean(w?.screen?.orientation),
  };
}

/** Serialise. Compact on purpose — a ten-minute walk is thousands of samples. */
export function serializeTrace(trace: HeadingTrace): string {
  return JSON.stringify(trace);
}

/**
 * Parse, refusing anything this build does not understand.
 *
 * A trace from a future schema replayed against today's reader would produce
 * numbers that look valid and mean something else, which is worse than an
 * error.
 */
export function parseTrace(json: string): HeadingTrace {
  const t = JSON.parse(json) as HeadingTrace;
  if (t.version !== TRACE_VERSION) {
    throw new Error(`Unsupported trace version ${t.version}; this build reads ${TRACE_VERSION}`);
  }
  for (const key of ["location", "orientation", "truth", "fusion"] as const) {
    if (!Array.isArray(t[key])) throw new Error(`Trace is missing the ${key} series`);
  }
  return t;
}
