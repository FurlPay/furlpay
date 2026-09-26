// Visual language for every embed the bot sends.
//
// One palette, one set of glyphs, one footer convention. The goal is that any
// two messages from this bot look like they came from the same product, and
// that a user can tell at a glance whether a number is fresh, stale, or absent.

import { chains } from "../../db/index.js";
import { relTime } from "../../util/fmt.js";

/** Semantic colours. Chain-specific embeds override with the chain's own. */
export const COLOR = {
  brand: 0x5865f2,
  positive: 0x34c759,
  negative: 0xff3b30,
  neutral: 0x8e8e93,
  warning: 0xff9f0a,
  info: 0x0a84ff,
  whale: 0x0a84ff,
  defi: 0x30d158,
  market: 0xbf5af2,
  danger: 0xff453a,
  surface: 0x2b2d31,
} as const;

/**
 * Typographic marks only.
 *
 * There is a deliberate distinction here between *decoration* and *data*.
 * Pictographic emoji (money bags, whales, padlocks) are decoration: they add
 * no information a label does not already carry, and they make a dense table
 * read like a chat message. They are gone.
 *
 * Chain marks are data — they identify which network a row is about — and are
 * real uploaded artwork, resolved through `chainIcon()`.
 *
 * What remains below is geometry: arrows, rules and status dots that encode
 * direction and state more compactly than a word could.
 */
export const GLYPH = {
  up: "▲",
  down: "▼",
  flat: "─",
  live: "●",
  degraded: "◐",
  down_: "○",
  unknown: "·",
  rule: "─",
  bullet: "·",
  arrow: "→",
} as const;

/** slug → "<:ethereum:123…>", populated after emoji upload. */
const chainEmoji = new Map<string, string>();

export function setChainEmoji(slug: string, markup: string): void {
  chainEmoji.set(slug, markup);
}

export function loadChainEmojis(map: Record<string, string>): void {
  for (const [slug, markup] of Object.entries(map)) chainEmoji.set(slug, markup);
}

/**
 * The chain's uploaded mark. Falls back to an empty string rather than a
 * stand-in glyph: a missing icon should leave the column blank and keep the
 * row aligned, not substitute a symbol that means something else.
 */
export function chainIcon(slug: string): string {
  return chainEmoji.get(slug) ?? "";
}

export function hasChainEmojis(): boolean {
  return chainEmoji.size > 0;
}

/** Colour for a chain's embeds — its brand colour from the registry. */
export function chainColor(slug: string): number {
  return chains.bySlug(slug)?.color || COLOR.brand;
}

/** Green above zero, red below, grey at zero — used for change fields. */
export function changeColor(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return COLOR.neutral;
  return pct > 0 ? COLOR.positive : pct < 0 ? COLOR.negative : COLOR.neutral;
}

/* ------------------------------------------------------------------ */
/* Freshness                                                           */
/* ------------------------------------------------------------------ */

export type Freshness = "live" | "recent" | "stale" | "missing";

export function freshness(fetchedAt: number | null | undefined, expectedIntervalMs: number): Freshness {
  if (!fetchedAt) return "missing";
  const age = Date.now() - fetchedAt;
  if (age <= expectedIntervalMs * 2) return "live";
  if (age <= expectedIntervalMs * 6) return "recent";
  return "stale";
}

export function freshnessGlyph(f: Freshness): string {
  return f === "live" ? GLYPH.live : f === "recent" ? GLYPH.degraded : f === "stale" ? GLYPH.down_ : GLYPH.unknown;
}

/** Word form, for places where a dot alone would not be self-explanatory. */
export function freshnessLabel(f: Freshness): string {
  return f === "live" ? "Live" : f === "recent" ? "Recent" : f === "stale" ? "Stale" : "No data";
}

/**
 * The footer convention: what produced the numbers and when they were read.
 * Every data-bearing embed carries one, so provenance is never a mystery.
 */
export function sourceFooter(sources: string[], fetchedAt: number | null): string {
  const uniq = [...new Set(sources.filter(Boolean))];
  const src = uniq.length ? uniq.join(" + ") : "no source";
  return fetchedAt
    ? `Source: ${src} • updated ${new Date(fetchedAt).toISOString().slice(11, 19)} UTC`
    : `Source: ${src} • never updated`;
}

/** Inline "as of" that Discord renders as a live relative timestamp. */
export function asOf(fetchedAt: number | null): string {
  return fetchedAt ? relTime(fetchedAt) : "`never`";
}

/**
 * Render a value that may legitimately not exist.
 * The reason is shown so "N/A" is never mistaken for "zero" or "broken".
 */
export function naWithReason(reason?: string): string {
  return reason ? `N/A ⁽${reason}⁾` : "N/A";
}
