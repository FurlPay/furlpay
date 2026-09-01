import type { CompassConfidence } from "./compassConfidence";
import type { MapMatch } from "./mapMatchHeading";
import { angleDelta, snapToRoad } from "./mapMatchHeading";

// ---------------------------------------------------------------------------
// Heading fusion.
//
// Three signals disagree constantly and each is wrong in its own way. This
// decides which to believe, and — more importantly — refuses to change its mind
// every time a sample flickers.
//
//   COMPASS    Works standing still, which is when nothing else does. Wrong by
//              ninety degrees beside a steel doorframe, and the browser is not
//              told when that happens.
//   GPS COURSE Derived from successive positions, so it owes the magnetometer
//              nothing. Does not exist at rest and is noise at a slow walk.
//   MAP MATCH  The bearing of a road the reader could be on. Says nothing in a
//              plaza, and cannot tell which way along the road you face.
//
// ── WHAT NATIVE GETS THAT WE DO NOT ────────────────────────────────────────
// Android's Fused Orientation Provider is documented as fusing accelerometer,
// gyroscope and magnetometer while compensating hard-iron offset and gyro bias,
// synchronising sensors across clocks, and — the part that matters here —
// producing "a realistic estimate of the compass heading accuracy".
//
// A browser is handed none of that. There is no raw magnetometer bias, no
// cross-sensor timestamp sync, and on Android no heading accuracy at all. So
// this engine infers from the outside what native is simply told, and the
// honest consequence is that it should be readier than a native app to say it
// does not know.
//
// ── WHY A STATE MACHINE AND NOT A WEIGHTED AVERAGE ─────────────────────────
// Averaging a good signal with a bad one produces a heading that is wrong in a
// new way and confident about it. Worse, when two sources are close in score
// the winner flips sample to sample and the arrow spins on screen — which reads
// as a broken app rather than an uncertain one. So exactly one source is
// authoritative at a time, changing it requires sustained evidence, and the
// arrow moves smoothly when it does.
// ---------------------------------------------------------------------------

export type HeadingState =
  /** Nothing has been observed yet. */
  | "unknown"
  /** Signals arriving, not yet enough of them to commit. */
  | "initializing"
  /** Not moving. The compass is the only thing that can help. */
  | "stationary_compass"
  /** Moving, and the GPS course is the best available estimate. */
  | "moving_gps"
  /** Moving, GPS course confirmed by a road bearing and snapped to it. */
  | "moving_map_matched"
  /** Signals disagree or none is trustworthy. Last good heading is held. */
  | "uncertain";

export type HeadingSource = "compass" | "gps" | "map" | "held" | "none";

export interface FusionInput {
  /** Magnetometer heading, degrees clockwise from north. */
  compassHeading: number | null;
  compassConfidence: CompassConfidence;
  /** Course over ground from the Geolocation API. NaN at rest, hence null. */
  gpsCourse: number | null;
  /** Metres per second. */
  speed: number | null;
  /** Position accuracy in metres, as reported. */
  positionAccuracy: number | null;
  /** Result of matching the current best guess against nearby roads. */
  mapMatch: MapMatch | null;
  /** Monotonic milliseconds. Injected so tests control time. */
  now: number;
}

export interface FusionOutput {
  /** The heading to draw, smoothed. Null when nothing is known. */
  heading: number | null;
  state: HeadingState;
  source: HeadingSource;
  /** 0-1. Drives how wide the direction cone is drawn. */
  confidence: number;
  /** Human-readable, for a debug overlay or a calibration hint. */
  reason: string;
}

// --- thresholds -------------------------------------------------------------
//
// Every one of these is a pair, and that is the point: a source has to be
// clearly better to take over, and clearly worse to be dropped. A single
// threshold makes the winner flip whenever a value sits on it.

/**
 * Speed at which GPS course becomes meaningful, and the lower speed at which it
 * stops being.
 *
 * The existing userLocation.ts used a single 0.5 m/s cut, which is a reasonable
 * place to put one line — a slow walk is around 1.0-1.4 m/s, and below roughly
 * half that the course is dominated by position noise rather than travel. The
 * change here is not the number but the gap around it: entering at 0.8 and
 * leaving at 0.4 stops a reader who is dawdling at 0.5 from flipping between
 * compass and GPS on every fix.
 */
const SPEED_ENTER = 0.8;
const SPEED_EXIT = 0.4;

/**
 * Position accuracy beyond which course over ground is not worth having.
 *
 * Course is computed from the displacement between fixes, so when the fixes
 * themselves are ±50m the direction between them is close to random at walking
 * pace.
 */
const MAX_POSITION_ACCURACY_M = 35;

/** How long a candidate must keep winning before it takes over, in ms. Roughly
 *  two GPS fixes, which is long enough that one anomalous sample cannot do it. */
const DWELL_MS = 2000;

/** A held heading is worth less the longer it is held. Fully decayed here. */
const HOLD_DECAY_MS = 20_000;

/** Disagreement beyond this between compass and a moving reader's course is
 *  taken as evidence the compass is wrong, not that the reader is walking
 *  sideways. 60 degrees is well past what carrying a phone loosely explains. */
const DISAGREEMENT_DEG = 60;

/**
 * Smoothing factor for the displayed heading, per update.
 *
 * Deliberately light. Navigation heading has to keep up with a turn; a heavy
 * filter makes the arrow lag the reader through a corner, which is worse than a
 * little jitter on a straight.
 */
const SMOOTHING = 0.35;

/** Circular exponential moving average. Averaging angles as numbers gives 180
 *  for 359 and 1, so both are carried as vectors and recombined. */
function circularEma(previous: number | null, next: number, alpha: number): number {
  if (previous === null) return next;
  const toRad = Math.PI / 180;
  const s = Math.sin(previous * toRad) * (1 - alpha) + Math.sin(next * toRad) * alpha;
  const c = Math.cos(previous * toRad) * (1 - alpha) + Math.cos(next * toRad) * alpha;
  return (((Math.atan2(s, c) * 180) / Math.PI) + 360) % 360;
}

/**
 * Is this GPS course worth believing?
 *
 * Not the same question as "is it non-null". A course at 0.2 m/s with ±40m
 * accuracy is a number, not a direction.
 */
export function gpsCourseQuality(
  course: number | null,
  speed: number | null,
  accuracy: number | null,
  wasMoving: boolean
): number {
  if (course === null || !Number.isFinite(course)) return 0;
  if (speed === null || !Number.isFinite(speed)) return 0;

  // Hysteresis on speed: harder to start believing than to keep believing.
  const threshold = wasMoving ? SPEED_EXIT : SPEED_ENTER;
  if (speed < threshold) return 0;

  if (accuracy !== null && Number.isFinite(accuracy) && accuracy > MAX_POSITION_ACCURACY_M) {
    return 0;
  }

  // Confidence rises with speed up to a brisk walk and is flat above it — a
  // car is not meaningfully more certain than a jogger about which way it
  // points.
  const speedScore = Math.min(1, speed / 2.0);
  const accScore =
    accuracy === null || !Number.isFinite(accuracy)
      ? 0.7 // unreported accuracy is not proof of a good fix
      : Math.max(0, 1 - accuracy / MAX_POSITION_ACCURACY_M);
  return Math.max(0, Math.min(1, speedScore * (0.4 + 0.6 * accScore)));
}

/** Compass confidence as a 0-1 weight. */
export function compassWeight(c: CompassConfidence): number {
  switch (c.level) {
    case "high": return 1;
    case "medium": return 0.6;
    case "low": return 0.15;
    default: return 0;
  }
}

/**
 * The engine. Stateful, because hysteresis and holding are memory by
 * definition, and one instance belongs to one map.
 */
export class HeadingFusion {
  private smoothed: number | null = null;
  private state: HeadingState = "unknown";
  private source: HeadingSource = "none";
  private lastGood: { heading: number; at: number } | null = null;
  private moving = false;
  /** Which source has been winning, and since when — the dwell timer. */
  private pending: { source: HeadingSource; since: number } | null = null;

  /** For tests and for a debug overlay. */
  currentState(): HeadingState { return this.state; }

  reset(): void {
    this.smoothed = null;
    this.state = "unknown";
    this.source = "none";
    this.lastGood = null;
    this.moving = false;
    this.pending = null;
  }

  update(input: FusionInput): FusionOutput {
    const { compassHeading, compassConfidence, gpsCourse, speed, positionAccuracy, mapMatch, now } = input;

    const gpsQ = gpsCourseQuality(gpsCourse, speed, positionAccuracy, this.moving);
    const compassQ = compassHeading === null ? 0 : compassWeight(compassConfidence);
    // Track movement with the same hysteresis the quality gate uses, so the two
    // cannot disagree about whether the reader is walking.
    this.moving = speed !== null && Number.isFinite(speed)
      ? speed >= (this.moving ? SPEED_EXIT : SPEED_ENTER)
      : false;

    // --- disagreement ------------------------------------------------------
    // A moving reader whose compass points sixty degrees away from their travel
    // direction is holding a compass that is wrong. Two independent signals
    // agreeing against it is what makes this safe to act on.
    let compassContradicted = false;
    if (gpsQ > 0.3 && compassHeading !== null && gpsCourse !== null) {
      const off = Math.abs(angleDelta(compassHeading, gpsCourse));
      if (off > DISAGREEMENT_DEG) compassContradicted = true;
    }

    // --- pick a winner -----------------------------------------------------
    let want: HeadingSource = "none";
    let raw: number | null = null;
    let conf = 0;
    let reason = "";

    const mapUsable = mapMatch !== null && mapMatch.support > 0.4 && mapMatch.bearing !== null;

    if (gpsQ > 0.3 && gpsCourse !== null) {
      if (mapUsable) {
        // Snap the course onto the road: the road knows the axis precisely, the
        // course knows which way along it. Together they beat either alone.
        want = "map";
        raw = snapToRoad(mapMatch!.bearing!, gpsCourse);
        conf = Math.min(1, gpsQ * 0.7 + mapMatch!.support * 0.3);
        reason = "GPS course snapped to a nearby road";
      } else {
        want = "gps";
        raw = gpsCourse;
        conf = gpsQ;
        reason = "moving; GPS course over ground";
      }
      // MEDIUM confidence or better. A "low" reading is one the estimator
      // believes is wrong — the level that raises the calibration prompt — and
      // drawing a heading we expect to be wrong is worse than holding the last
      // one we trusted. This threshold sits above compassWeight("low").
    } else if (compassQ >= 0.5 && compassHeading !== null && !compassContradicted) {
      want = "compass";
      raw = compassHeading;
      conf = compassQ;
      reason = this.moving ? "compass (GPS course unusable)" : "stationary; compass";
    } else if (this.lastGood) {
      want = "held";
      raw = this.lastGood.heading;
      const age = now - this.lastGood.at;
      conf = Math.max(0, 1 - age / HOLD_DECAY_MS) * 0.4;
      reason = compassContradicted
        ? "compass contradicted by movement; holding last good heading"
        : "no trustworthy signal; holding last good heading";
    } else {
      want = "none";
      reason = "no heading signal yet";
    }

    // --- dwell -------------------------------------------------------------
    // A new source must keep winning for DWELL_MS before it takes over. Without
    // this the authority flips whenever two sources are within noise of each
    // other, and the arrow spins.
    if (want !== this.source) {
      if (!this.pending || this.pending.source !== want) {
        this.pending = { source: want, since: now };
      }
      const held = now - this.pending.since;
      // Losing every signal is not a change worth waiting out — falling back to
      // the held heading should be immediate.
      const immediate = want === "held" || want === "none" || this.source === "none";
      if (held >= DWELL_MS || immediate) {
        this.source = want;
        this.pending = null;
      } else {
        // Still on the old source. Keep showing its heading if we still have
        // one, rather than jumping early.
        if (this.smoothed !== null) {
          return this.emit(this.smoothed, this.state, this.source, conf, "holding source through dwell");
        }
      }
    } else {
      this.pending = null;
    }

    if (raw === null) {
      this.state = this.smoothed === null ? "unknown" : "uncertain";
      return this.emit(this.smoothed, this.state, this.source, 0, reason);
    }

    this.smoothed = circularEma(this.smoothed, raw, SMOOTHING);

    // Only a directly observed heading is worth remembering. Re-holding a held
    // heading would keep resetting its own decay clock and it would never age.
    if (this.source !== "held" && conf > 0.3) {
      this.lastGood = { heading: raw, at: now };
    }

    this.state =
      this.source === "map" ? "moving_map_matched"
      : this.source === "gps" ? "moving_gps"
      : this.source === "compass" ? "stationary_compass"
      : this.source === "held" ? "uncertain"
      : "initializing";

    return this.emit(this.smoothed, this.state, this.source, conf, reason);
  }

  private emit(
    heading: number | null, state: HeadingState, source: HeadingSource,
    confidence: number, reason: string
  ): FusionOutput {
    return { heading, state, source, confidence: Math.max(0, Math.min(1, confidence)), reason };
  }
}
