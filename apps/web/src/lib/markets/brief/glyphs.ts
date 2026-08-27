// ---------------------------------------------------------------------------
// Unicode chart glyphs: sparklines, meters and range gauges.
//
// WHY DRAW WITH TEXT AT ALL. Discord will render an attached image, but an
// image has to be generated, uploaded and hosted, it is invisible to anyone
// with images disabled, it carries no text for a screen reader, and it does not
// appear in a notification preview. A sparkline made of block characters costs
// eight bytes, survives every client, and copies as text.
//
// THE CONSTRAINT THAT DECIDES EVERY WIDTH HERE. A Discord code block on a phone
// is roughly 32-34 monospace columns before it wraps, and a wrapped table is
// worse than no table — the columns stop lining up and every row reads as two.
// Nothing this module produces defaults wider than that.
//
// THREE WAYS A SPARKLINE LIES, all of them handled below:
//
//   1. A FLAT SERIES. Max equals min, so the usual (v-min)/(max-min) divides by
//      zero and yields NaN, which indexes to `undefined` and prints "undefined"
//      across the post. A flat series renders as a flat mid-line, which is what
//      it is.
//
//   2. GAPS TREATED AS ZEROS. Yahoo pads its arrays with nulls on holidays and
//      halts. A null read as 0 draws a vertical cliff to the axis and reads as
//      a crash. Nulls are dropped, never zero-filled.
//
//   3. AUTO-SCALING READ AS ABSOLUTE. Every sparkline here is scaled to its own
//      min and max, so a stock that moved 0.1% and one that moved 40% produce
//      the same-looking wiggle. That is inherent to the form and is why the
//      percentage is always printed beside it, never replaced by it.
// ---------------------------------------------------------------------------

/** Eight levels, low to high. The standard sparkline ramp. */
export const SPARK_LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Meter fill characters. The light shade reads as "empty" on both Discord
 *  themes, where a space reads as "the bar ended here". */
const METER_FULL = "█";
const METER_EMPTY = "░";

/**
 * Downsample a series to `width` points by bucket averaging.
 *
 * Averaging rather than sampling: taking every Nth point from a 390-bar
 * intraday series drops the spikes, so a violent session renders as a calm one.
 * Averaging keeps the shape.
 */
export function resample(values: number[], width: number): number[] {
  if (width <= 0) return [];
  if (values.length === 0) return [];
  if (values.length <= width) return [...values];

  const out: number[] = [];
  for (let i = 0; i < width; i++) {
    const start = Math.floor((i * values.length) / width);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / width));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < values.length; j++) {
      sum += values[j];
      n++;
    }
    out.push(n > 0 ? sum / n : values[start]);
  }
  return out;
}

/**
 * A sparkline over a series, scaled to its own range.
 *
 * Returns an empty string — not a row of flat glyphs — when there is nothing to
 * draw. An empty string is omitted by the caller; a row of "▁▁▁▁" is a claim
 * that the price did not move.
 */
export function sparkline(
  values: Array<number | null | undefined> | null | undefined,
  width = 8
): string {
  // Not merely defensive typing: `series` arrives from a provider whose shape
  // is undocumented, and a renderer that throws takes the ENTIRE post with it
  // to save one sparkline.
  if (!Array.isArray(values)) return "";
  const clean = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (clean.length < 2) return "";

  const points = resample(clean, width);
  const min = Math.min(...points);
  const max = Math.max(...points);

  // Flat, or so nearly flat that the difference is float noise. Drawn as a
  // genuine flat line at the bottom of the ramp rather than as NaN.
  if (!(max > min)) return SPARK_LEVELS[0].repeat(points.length);

  const span = max - min;
  return points
    .map((v) => {
      const idx = Math.round(((v - min) / span) * (SPARK_LEVELS.length - 1));
      // Defensive: float error at the endpoints can push this one past the end.
      return SPARK_LEVELS[Math.min(SPARK_LEVELS.length - 1, Math.max(0, idx))];
    })
    .join("");
}

/**
 * A proportional meter, e.g. a 0-100 score or a breadth ratio.
 *
 * `fraction` outside 0..1 is clamped rather than rejected: a score of 100.0001
 * from float accumulation must render as a full bar, not throw.
 */
export function meter(fraction: number, width = 10): string {
  if (!Number.isFinite(fraction) || width <= 0) return "";
  const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const filled = Math.round(f * width);
  return METER_FULL.repeat(filled) + METER_EMPTY.repeat(width - filled);
}

/**
 * A split bar showing two competing quantities — advancers against decliners.
 *
 * Returns an empty string when both are zero: a 50/50 bar drawn from no data
 * claims a perfectly balanced market.
 */
export function ratioBar(left: number, right: number, width = 20): string {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return "";
  const total = left + right;
  if (!(total > 0) || width <= 0) return "";
  const leftCells = Math.round((left / total) * width);
  return METER_FULL.repeat(leftCells) + METER_EMPTY.repeat(width - leftCells);
}

/**
 * Where a price sits inside a range — the 52-week gauge.
 *
 * Null when the range is degenerate or the inputs are missing, so the caller
 * omits the gauge rather than drawing a marker at an arbitrary position.
 */
export function rangeGauge(
  low: number | null,
  high: number | null,
  current: number | null,
  width = 11
): string | null {
  if (low === null || high === null || current === null) return null;
  if (![low, high, current].every(Number.isFinite)) return null;
  if (!(high > low) || width < 3) return null;

  const f = (current - low) / (high - low);
  const clamped = f < 0 ? 0 : f > 1 ? 1 : f;
  const pos = Math.round(clamped * (width - 1));
  return `${"─".repeat(pos)}●${"─".repeat(width - 1 - pos)}`;
}

/** Direction marker. In the TEXT, so it survives a screen reader, a
 *  notification preview, and every form of colour blindness. */
export function arrow(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "▬";
  return n > 0 ? "▲" : "▼";
}
