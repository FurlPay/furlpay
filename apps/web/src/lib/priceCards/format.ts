// ---------------------------------------------------------------------------
// Formatting for the price card. Every function returns an em-dash for a null
// rather than a zero, because on a price card a "0" is a claim about the market
// and a dash is a statement about our data.
// ---------------------------------------------------------------------------

export const DASH = "—";

/**
 * A price with precision chosen from its magnitude.
 *
 * Bitcoin at 76,000 does not need four decimals and a coin at $0.00004 is
 * destroyed by two. Fixing precision at 2 makes small assets unreadable and
 * large ones noisy, so it scales.
 */
export function formatUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const dp = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** A level with no currency symbol: an index is quoted in points.
 *
 * Separate from formatUsd rather than a flag on it, so the choice is visible at
 * every call site. "$7,670.92" for the S&P 500 reads as a price you could pay. */
export function formatLevel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact money: $57.25B, $3.33B, $912.4M. */
export function formatCompactUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(2)}`;
}

/** Signed percentage to one decimal, e.g. "-4.2%" / "+0.5%". */
export function formatPct(n: number | null, dp = 2): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

/** Rank as "#7". Null for anything that is not a ranked coin. */
export function formatRank(n: number | null): string {
  return n === null || !Number.isFinite(n) ? DASH : `#${n}`;
}

/** Colours for a signed value. Neutral grey at exactly zero, because a flat
 *  session is neither a gain nor a loss and colouring it green implies one. */
export const COLORS = {
  bg: "#1E1F23",
  chartBg: "#181A1F",
  panel: "#202329",
  border: "#2A2D34",
  text: "#F2F3F5",
  textSecondary: "#949BA4",
  textMuted: "#6D737C",
  positive: "#57F287",
  negative: "#ED4245",
  neutral: "#949BA4",
} as const;

export function changeColor(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n === 0) return COLORS.neutral;
  return n > 0 ? COLORS.positive : COLORS.negative;
}

/** Discord's own timestamp markup, so every reader sees their local time.
 *
 * `<t:unix:t>` renders as a short time and updates itself; a baked "6:18 PM"
 * is correct in exactly one timezone and misleading everywhere else. */
export function discordTimestamp(d: Date, style: "t" | "f" | "R" = "t"): string {
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

/**
 * Build an SVG path for a sparkline, plus the point of the last observation.
 *
 * Scaled to the series' own min and max rather than to zero: a gold chart
 * anchored at zero is a flat line across the top of the panel. Returns null
 * when there is nothing to draw or every point is identical, in which case the
 * caller should draw no line rather than a straight one implying stability.
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2
): { line: string; area: string; lastX: number; lastY: number; min: number; max: number } | null {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  if (!(max > min)) return null;

  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (i: number) => pad + (i / (pts.length - 1)) * w;
  const y = (v: number) => pad + h - ((v - min) / (max - min)) * h;

  let line = `M ${x(0).toFixed(2)} ${y(pts[0]!).toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) line += ` L ${x(i).toFixed(2)} ${y(pts[i]!).toFixed(2)}`;
  const area = `${line} L ${x(pts.length - 1).toFixed(2)} ${(height - pad).toFixed(2)} L ${x(0).toFixed(2)} ${(height - pad).toFixed(2)} Z`;

  return {
    line,
    area,
    lastX: x(pts.length - 1),
    lastY: y(pts[pts.length - 1]!),
    min,
    max,
  };
}
