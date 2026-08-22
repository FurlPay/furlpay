// ---------------------------------------------------------------------------
// Display formatting for market statistics.
//
// Two rules, and both exist because breaking them puts a false claim on screen.
//
// 1. Null renders as an em-dash. Never 0, never "N/A", never a blank cell. The
//    providers return null for "we do not have this", and `?? 0` turns that
//    into a stated fact: a 0 all-time high reads as a real price, a 0 P/E reads
//    as a remarkable one.
//
// 2. Every number is rounded before it is shown. `String(35.571908553387)` and
//    `` `$${8.709999999999999}` `` are what unrounded floats look like in a
//    stat cell, and a figure printed to twelve decimals reads as machine
//    output that nobody checked — which, on a page whose whole argument is
//    that its numbers are real, is the wrong thing to signal.
// ---------------------------------------------------------------------------

export const DASH = "—";

type Maybe = number | null | undefined;

function bad(n: Maybe): n is null | undefined {
  return n == null || !Number.isFinite(n);
}

/** Money at magnitude: $4.52T, $937.06B, $12.4M. */
export function fmtMoneyCompact(n: Maybe): string {
  if (bad(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Counts at magnitude — shares, volume. No currency symbol. */
export function fmtCountCompact(n: Maybe): string {
  if (bad(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

/** A ratio shown as a multiple: 35.57, 0.93. */
export function fmtMultiple(n: Maybe, digits = 2): string {
  return bad(n) ? DASH : n.toFixed(digits);
}

/** A percentage that is already in percent units (54.77 -> "54.77%"). */
export function fmtPct(n: Maybe, digits = 2): string {
  return bad(n) ? DASH : `${n.toFixed(digits)}%`;
}

/** A signed percentage, for changes: "+1.02%" / "-1.02%". */
export function fmtPctSigned(n: Maybe, digits = 2): string {
  return bad(n) ? DASH : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** A per-share amount. Sub-dollar values keep significant digits rather than
 * rounding a $0.004 coin to $0.00, which would render it worthless. */
export function fmtPerShare(n: Maybe): string {
  if (bad(n)) return DASH;
  const abs = Math.abs(n);
  if (abs === 0) return "$0.00";
  if (abs < 1) return `${n < 0 ? "-" : ""}$${abs.toPrecision(3)}`;
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Where a value sits inside a range, 0–1, for a range bar's marker.
 *
 * Null unless all three numbers are present and the range is non-degenerate.
 * A marker positioned by a guessed fraction is a picture of a fact we do not
 * have, and it is the part of a range bar a reader actually reads. */
export function rangePosition(low: Maybe, high: Maybe, value: Maybe): number | null {
  if (bad(low) || bad(high) || bad(value)) return null;
  if (high <= low) return null;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

/** "2026-06-27" -> "Jun 27, 2026". Used for filing period ends. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  return new Date(t).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** How long ago an exchange timestamp (epoch seconds) was.
 *
 * Drives the staleness badge. A price is only called live when the tape says
 * so; without a timestamp there is no claim to make. */
export function freshness(epochSeconds: Maybe): { label: string; live: boolean } | null {
  if (bad(epochSeconds)) return null;
  const secs = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (secs < 90) return { label: "Live", live: true };
  const mins = Math.round(secs / 60);
  if (mins < 60) return { label: `${mins}m ago`, live: false };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { label: `${hours}h ago`, live: false };
  return { label: `${Math.round(hours / 24)}d ago`, live: false };
}
