// Display formatting for the admin dashboard. Formatting only: no value is
// ever derived or defaulted here — a missing number renders as "—".

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");

export function fmtCount(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return opts.compact && Math.abs(n) >= 10_000 ? compact.format(n) : full.format(Math.round(n));
}

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10_000) return `$${compact.format(n)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 });
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** "+12.5%" / "−3.0%" for a period-over-period ratio. */
export function fmtChange(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "";
  const v = (ratio * 100).toFixed(1);
  return ratio > 0 ? `+${v}%` : ratio < 0 ? `−${v.replace("-", "")}%` : "0.0%";
}

export function relTime(ms: number | string, now = Date.now()): string {
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Axis label for a bucket start (ISO) at the range's granularity. */
export function bucketLabel(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  return bucket === "hour"
    ? d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
}

/** Regional-indicator flag for an ISO-3166 alpha-2 code (computed, not a table). */
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
