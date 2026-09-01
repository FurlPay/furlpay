// ---------------------------------------------------------------------------
// How much should we trust the compass?
//
// Google Maps shows Low / Medium / High beside its calibration screen and asks
// for a figure-8 when confidence is low. The web cannot trigger that gesture —
// there is no API for OS compass calibration, and none for Live View's AR
// re-alignment — but it CAN work out when the reading is untrustworthy and say
// so. Telling someone their compass is wrong is most of the value; the fix is
// then a gesture they already know.
//
// TWO SOURCES OF TRUTH, IN ORDER OF PREFERENCE.
//
//   iOS reports it directly. `webkitCompassAccuracy` is the magnetometer's own
//   error estimate in degrees, and a negative value is Safari's way of saying
//   the sensor is uncalibrated. Nothing beats asking the OS.
//
//   Android reports nothing at all. `deviceorientationabsolute` carries no
//   accuracy field, so confidence has to be inferred — and the tell is jitter.
//   A calibrated magnetometer held still returns a heading that moves by a
//   degree or two; an uncalibrated one wanders over tens of degrees. So the
//   spread of recent samples IS the accuracy estimate.
//
// ── WHY CIRCULAR STATISTICS ────────────────────────────────────────────────
// Headings are angles, and the ordinary mean is wrong for angles in a way that
// is easy to miss: the average of 359° and 1° is 180°, pointing exactly
// backwards, when the true answer is 0°. Worse, that error is silent — it
// produces a plausible number. So each sample is treated as a unit vector and
// averaged componentwise. The LENGTH of the resulting vector is the measure of
// agreement: 1.0 means every sample pointed the same way, 0.0 means they
// cancelled out entirely. That length is the confidence.
// ---------------------------------------------------------------------------

/** Matches Google Maps' own three-level vocabulary. */
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface CompassConfidence {
  level: ConfidenceLevel;
  /** Estimated error in degrees, when one can be established. */
  errorDegrees: number | null;
  /** Whether the reader should be advised to calibrate. */
  needsCalibration: boolean;
  /** Which of the two paths produced this verdict. */
  source: "reported" | "inferred" | "none";
}

/**
 * Samples kept for the inferred path.
 *
 * At the ~60Hz these events fire, 40 samples is well under a second of wall
 * clock — long enough to see wander, short enough that turning the phone
 * deliberately does not read as instability for more than a moment.
 */
export const WINDOW_SIZE = 40;

/** Below this many samples there is not enough evidence to judge. */
const MIN_SAMPLES = 8;

/**
 * Thresholds on the mean resultant length, chosen from what the two states
 * actually look like: a calibrated magnetometer at rest holds R above ~0.99,
 * and an uncalibrated one wandering tens of degrees falls below ~0.9.
 */
const R_HIGH = 0.985;
const R_MEDIUM = 0.9;

/** iOS reports error in degrees directly; these mirror the R thresholds. */
const DEG_HIGH = 10;
const DEG_MEDIUM = 25;

/**
 * A rolling window of headings, and the confidence they imply.
 *
 * Stateful because the inference needs history, and a class keeps that history
 * out of the caller. Cheap: bounded memory, O(1) per sample, no allocation in
 * the hot path.
 */
export class CompassConfidenceEstimator {
  private readonly sin: number[] = [];
  private readonly cos: number[] = [];
  private at = 0;
  private count = 0;
  private reported: number | null = null;

  /**
   * Feed one reading.
   *
   * `accuracyDegrees` is whatever the platform reported — pass null when it
   * reported nothing, which is the Android case.
   */
  push(headingDegrees: number, accuracyDegrees: number | null = null): void {
    if (!Number.isFinite(headingDegrees)) return;

    // A negative accuracy is iOS signalling "uncalibrated", not a small error.
    // Treating it as a number would read as near-perfect confidence.
    this.reported =
      typeof accuracyDegrees === "number" && Number.isFinite(accuracyDegrees) && accuracyDegrees >= 0
        ? accuracyDegrees
        : null;

    const rad = (headingDegrees * Math.PI) / 180;
    this.sin[this.at] = Math.sin(rad);
    this.cos[this.at] = Math.cos(rad);
    this.at = (this.at + 1) % WINDOW_SIZE;
    if (this.count < WINDOW_SIZE) this.count++;
  }

  /** Drop all history — after a screen rotation, or when tracking restarts. */
  reset(): void {
    this.sin.length = 0;
    this.cos.length = 0;
    this.at = 0;
    this.count = 0;
    this.reported = null;
  }

  /**
   * The mean resultant length, R, in [0, 1].
   *
   * 1 means every sample agreed; 0 means they pointed in every direction and
   * cancelled. This is the standard circular-statistics measure of
   * concentration, and it is what makes the estimate correct across the 0/360
   * boundary where an ordinary standard deviation is not.
   */
  resultantLength(): number {
    if (this.count === 0) return 0;
    let s = 0;
    let c = 0;
    for (let i = 0; i < this.count; i++) {
      s += this.sin[i];
      c += this.cos[i];
    }
    return Math.min(1, Math.hypot(s, c) / this.count);
  }

  /**
   * Circular standard deviation in degrees, derived from R.
   *
   * sqrt(-2 ln R) is the standard conversion; it goes to 0 as R approaches 1
   * and grows without bound as R approaches 0, which is why it is capped
   * before being shown to anyone.
   */
  spreadDegrees(): number | null {
    if (this.count < MIN_SAMPLES) return null;
    const r = this.resultantLength();
    if (r <= 0) return 180;
    const rad = Math.sqrt(-2 * Math.log(r));
    return Math.min(180, (rad * 180) / Math.PI);
  }

  /** The verdict. */
  confidence(): CompassConfidence {
    // The OS knows better than any inference. Prefer it whenever it spoke.
    if (this.reported !== null) {
      const level: ConfidenceLevel =
        this.reported <= DEG_HIGH ? "high" : this.reported <= DEG_MEDIUM ? "medium" : "low";
      return {
        level,
        errorDegrees: this.reported,
        needsCalibration: level === "low",
        source: "reported",
      };
    }

    if (this.count < MIN_SAMPLES) {
      return { level: "unknown", errorDegrees: null, needsCalibration: false, source: "none" };
    }

    const r = this.resultantLength();
    const level: ConfidenceLevel = r >= R_HIGH ? "high" : r >= R_MEDIUM ? "medium" : "low";
    return {
      level,
      errorDegrees: this.spreadDegrees(),
      // Only the low band is worth interrupting someone for. Medium is usable
      // and a prompt on every mild wobble trains people to dismiss it.
      needsCalibration: level === "low",
      source: "inferred",
    };
  }
}

/**
 * What to tell the reader.
 *
 * Deliberately describes the figure-8 rather than naming a menu item: the web
 * cannot open the OS calibration screen, so the instruction has to be one the
 * reader can act on themselves. Returns null when there is nothing worth
 * saying, so the caller renders nothing rather than a reassuring badge nobody
 * needs.
 */
export function calibrationHint(c: CompassConfidence): string | null {
  if (!c.needsCalibration) return null;
  return "Compass needs calibrating — move your phone in a figure-8";
}

/**
 * Should the compass be trusted over GPS course-over-ground?
 *
 * This is the web's version of what Google calls "walk to recalibrate". Course
 * from GPS is derived from successive positions, so it owes nothing to the
 * magnetometer and is unaffected by a metal desk or a phone case magnet — but
 * it only exists while actually moving, and is noise at walking-pace speeds
 * below roughly half a metre per second.
 *
 * So: moving with a doubtful compass, believe the GPS. Stationary, or with a
 * compass the OS vouches for, believe the compass.
 */
export function preferGpsCourse(
  c: CompassConfidence,
  speedMetersPerSecond: number | null
): boolean {
  if (speedMetersPerSecond === null || !Number.isFinite(speedMetersPerSecond)) return false;
  if (speedMetersPerSecond < 0.5) return false;
  return c.level === "low" || c.level === "unknown";
}
