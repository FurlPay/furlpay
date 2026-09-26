// Presentation helpers.
//
// Discord embeds are monospace-hostile: the client proportional font makes
// naive column padding wobble. Everything here that needs to line up is meant
// to be wrapped in a code fence by the caller, and `padCell` counts display
// width rather than code units so an emoji or CJK glyph does not shift a row.

/** Rendered width of a string, counting wide glyphs as two columns. */
export function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfe0f || (c >= 0x200b && c <= 0x200f)) continue; // zero-width
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0x1f300 && c <= 0x1faff)
        ? 2
        : 1;
  }
  return w;
}

export function padCell(s: string, n: number, align: "left" | "right" = "left"): string {
  const w = width(s);
  if (w >= n) return truncate(s, n);
  const pad = " ".repeat(n - w);
  return align === "left" ? s + pad : pad + s;
}

export function truncate(s: string, n: number): string {
  if (width(s) <= n) return s;
  let out = "";
  for (const ch of s) {
    if (width(out + ch) > n - 1) break;
    out += ch;
  }
  return out + "…";
}

const UNITS = [
  { v: 1e12, s: "T" },
  { v: 1e9, s: "B" },
  { v: 1e6, s: "M" },
  { v: 1e3, s: "K" },
];

/** Compact money: $1.27T, $299.6B, $2,478.61. Returns "N/A" for null. */
export function usd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const compact = opts.compact ?? true;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (compact) {
    for (const u of UNITS) {
      if (abs >= u.v) {
        const q = abs / u.v;
        return `${sign}$${q >= 100 ? q.toFixed(0) : q.toFixed(2)}${u.s}`;
      }
    }
  }
  if (abs >= 1) return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs === 0) return "$0.00";
  return `${sign}$${abs.toPrecision(3)}`;
}

/** Compact count: 42.8M, 1.24M, 395K. */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  for (const u of UNITS) {
    if (abs >= u.v) {
      const q = abs / u.v;
      return `${n < 0 ? "-" : ""}${q >= 100 ? q.toFixed(0) : q.toFixed(2)}${u.s}`;
    }
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Token amount: 12,450.5 ETH — precision scales down as the number grows. */
export function tokens(n: number | null | undefined, symbol?: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.001 ? 4 : 8;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  return symbol ? `${s} ${symbol}` : s;
}

/** Signed percentage with a directional arrow: ▲ +2.4% / ▼ -1.8%. */
export function pct(n: number | null | undefined, opts: { arrow?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const arrow = opts.arrow ?? true;
  const sign = n > 0 ? "+" : "";
  const body = `${sign}${n.toFixed(2)}%`;
  if (!arrow) return body;
  return `${n > 0 ? "▲" : n < 0 ? "▼" : "▬"} ${body}`;
}

/** Discord renders <t:unix:R> as a live-updating "18 seconds ago". */
export function relTime(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}
export function absTime(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

/** 0x28C6…f6e4 — enough to eyeball, short enough for a table cell. */
export function shortAddr(a: string, lead = 6, tail = 4): string {
  if (!a) return "N/A";
  if (a.length <= lead + tail + 1) return a;
  return `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

export function shortHash(h: string): string {
  return shortAddr(h, 8, 6);
}

/** Seconds → "2h 14m", "45s". */
export function duration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "N/A";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

/** Block time in seconds → "12.0s" / "400ms". */
export function blockTime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "N/A";
  return sec < 1 ? `${Math.round(sec * 1000)}ms` : `${sec.toFixed(1)}s`;
}

/** Gwei with sensible precision. */
export function gwei(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  return n < 1 ? `${n.toFixed(3)} gwei` : `${n.toFixed(2)} gwei`;
}

/**
 * A tiny bar for inline comparisons, e.g. a chain's share of total TVL.
 * Uses block-drawing characters that render in Discord's code font.
 */
export function bar(fraction: number, len = 10): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(f * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

/** Sparkline from a numeric series — used for 7d price/TVL trends. */
export function sparkline(series: number[]): string {
  const pts = series.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return "";
  const glyphs = "▁▂▃▄▅▆▇█";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min;
  if (span === 0) return glyphs[3]!.repeat(Math.min(pts.length, 24));
  const step = Math.max(1, Math.ceil(pts.length / 24));
  let out = "";
  for (let i = 0; i < pts.length; i += step) {
    const idx = Math.round(((pts[i]! - min) / span) * (glyphs.length - 1));
    out += glyphs[idx]!;
  }
  return out;
}

/** Wrap rows in a Discord code fence, which is the only way columns align. */
export function codeBlock(body: string, lang = ""): string {
  return "```" + lang + "\n" + body.slice(0, 3900) + "\n```";
}

export function fence(lines: string[], lang = ""): string {
  return codeBlock(lines.join("\n"), lang);
}
