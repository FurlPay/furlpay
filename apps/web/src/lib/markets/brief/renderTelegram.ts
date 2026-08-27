// ---------------------------------------------------------------------------
// Rendering the brief for Telegram.
//
// WHY THIS IS A SEPARATE RENDERER AND NOT A FLAG ON THE DISCORD ONE. The two
// platforms share nothing at the presentation layer:
//
//                      Discord                    Telegram
//     structure        up to 10 embeds            one flat message
//     colour           embed border + ANSI        none at all
//     tables           ```ansi fenced block       <pre> block
//     length           6,000 across embeds        4,096 for the whole text
//     markup           Discord-flavoured md       a 9-tag HTML subset
//
// A single renderer with `if (platform === ...)` at every branch would be a
// worse version of both. The BRIEF is shared — screener, score, analysis — and
// only the last inch differs, which is exactly the right seam.
//
// COLOUR HAS TO COME FROM SOMEWHERE ELSE. Telegram renders no ANSI, so the
// green/red that carried direction on Discord is gone. Emoji replace it OUTSIDE
// the code blocks; inside them direction stays as ▲/▼ only, because emoji are
// variable-width and one of them in a <pre> row knocks every column after it
// out of alignment.
//
// THE FAILURE MODE THIS FILE IS BUILT AGAINST: an unescaped `&` or `<`. Telegram
// does not degrade — it rejects the entire message with 400 "can't parse
// entities", so one company named "Smith & Co" silently costs the whole day's
// brief. Every interpolated value goes through `esc()`, and a spec feeds
// hostile names through the renderer to prove it.
//
// The 4,096 cap is on the FINAL string, entities and all. Sections are appended
// in priority order and the builder stops before the cap rather than truncating
// mid-table, so a long day loses its last section instead of its formatting.
// ---------------------------------------------------------------------------

import type { LevelRow, MarketBrief, MoverRow } from "./brief";
import type { ScoredQuote } from "./score";
import { cell } from "./ansi";
import { arrow, ratioBar, sparkline } from "./glyphs";
import {
  BULLISH_COLS,
  changeCellText,
  compactLevel,
  LEVEL_COLS,
  MOVER_COLS,
  pct,
  rvolOf,
  SPARK_WIDTH,
  volume,
} from "./render";

/** Telegram's hard limit on `text` for sendMessage. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Headroom so the footer, appended last, always fits. */
const FOOTER_RESERVE = 320;

const SITE = "https://furlpay.com";

/**
 * Escape the characters Telegram's HTML parser treats as markup.
 *
 * Exactly three, per the Bot API docs — escaping more (quotes, apostrophes)
 * would render literal `&#39;` in company names.
 */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A monospace block. Lines arrive RAW and are escaped here, last.
 *
 * THE ORDER IS THE WHOLE POINT, and getting it backwards was a real bug in
 * this file: escaping first turns a ticker like `A&B` into `A&amp;B`, the
 * padder then measures seven columns instead of three, and the cell is
 * truncated to `A&am…`. Telegram renders `&amp;` as a single `&`, so column
 * widths must be computed on what the READER sees — pad raw, escape after.
 */
function pre(lines: string[]): string {
  return lines.length ? `<pre>${lines.map(esc).join("\n")}</pre>` : "";
}

/** Coloured dot for use OUTSIDE a <pre> block, where width does not matter. */
function dot(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "⚪";
  return n > 0 ? "🟢" : "🔴";
}

// ---- Rows -----------------------------------------------------------------
//
// Column widths are shared with the Discord renderer so the two stay visually
// consistent and only have to be re-checked in one place.

function levelLine(r: LevelRow, sparkWidth: number): string {
  const spark = sparkWidth > 0 ? sparkline(r.series, sparkWidth) : "";
  const parts = [
    cell(r.short, LEVEL_COLS.name),
    cell(compactLevel(r.price), LEVEL_COLS.last, { align: "right" }),
    cell(changeCellText(r), LEVEL_COLS.chg, { align: "right" }),
  ];
  if (spark) parts.push(spark);
  return parts.join(" ");
}

function moverLine(r: MoverRow, rank: number): string {
  return [
    cell(`${rank}`, MOVER_COLS.rank),
    cell(r.symbol, MOVER_COLS.ticker),
    cell(pct(r.changePercent), MOVER_COLS.chg, { align: "right" }),
    cell(volume(r.volume), MOVER_COLS.vol, { align: "right" }),
  ].join(" ");
}

function bullishLine(r: ScoredQuote, rank: number): string {
  const rv = rvolOf(r);
  return [
    cell(`${rank}`, BULLISH_COLS.rank),
    cell(r.symbol, BULLISH_COLS.ticker),
    cell(pct(r.changePercent), BULLISH_COLS.chg, { align: "right" }),
    cell(rv === null ? "—" : `${rv.toFixed(1)}x`, BULLISH_COLS.rvol, { align: "right" }),
    cell(`${Math.round(r.score)}`, BULLISH_COLS.score, { align: "right" }),
  ].join(" ");
}

function headlineFor(state: string | null): string {
  switch ((state ?? "").toUpperCase()) {
    case "REGULAR":
      return "Midday Market Brief";
    case "PRE":
      return "Pre-Market Brief";
    case "POST":
    case "POSTPOST":
    case "CLOSED":
      return "Daily Market Brief";
    default:
      return "Market Brief";
  }
}

export interface TelegramMessage {
  text: string;
  /** Inline link buttons. Telegram renders these under the message. */
  buttons: Array<Array<{ text: string; url: string }>>;
  /** Sections that did not fit the 4,096-character limit. Empty on a normal
   *  day; non-empty is a signal to shrink a board, not something to ignore. */
  omitted: string[];
}

/**
 * Build the Telegram message.
 *
 * Sections are assembled as (name, html) pairs and appended in priority order
 * while they fit. Nothing is truncated mid-block: a `<pre>` cut in half both
 * looks broken and can leave an unclosed tag, which Telegram rejects outright.
 */
export function renderTelegramBrief(brief: MarketBrief): TelegramMessage {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(brief.generatedAt));

  const sections: Array<{ name: string; html: string }> = [];

  // ---- Header + indices --------------------------------------------------
  const tape = brief.indices
    .map((r) => `${dot(r.changePercent)} ${esc(r.short)} ${pct(r.changePercent)}`)
    .join("   ");

  const head = [
    `<b>FurlPay ${esc(headlineFor(brief.marketState))}</b>`,
    `<i>${esc(dateLabel)}</i>`,
    tape,
    brief.indices.length > 0
      ? pre(brief.indices.map((r) => levelLine(r, SPARK_WIDTH)))
      : "<i>Index levels were unavailable for this session.</i>",
  ]
    .filter(Boolean)
    .join("\n");
  sections.push({ name: "header", html: head });

  // ---- Narrative ---------------------------------------------------------
  if (brief.narrative) {
    sections.push({ name: "narrative", html: `<blockquote>${esc(brief.narrative)}</blockquote>` });
  }

  // ---- Most bullish ------------------------------------------------------
  if (brief.bullish.length > 0) {
    const header = [
      cell("#", BULLISH_COLS.rank),
      cell("TICKER", BULLISH_COLS.ticker),
      cell("CHG", BULLISH_COLS.chg, { align: "right" }),
      cell("RVOL", BULLISH_COLS.rvol, { align: "right" }),
      cell("SCR", BULLISH_COLS.score, { align: "right" }),
    ].join(" ");
    sections.push({
      name: "bullish",
      html:
        `🟢 <b>Most bullish</b> <i>— momentum · volume · trend · position</i>\n` +
        pre([header, ...brief.bullish.map((r, i) => bullishLine(r, i + 1))]),
    });
  }

  // ---- Gainers and losers ------------------------------------------------
  if (brief.gainers.length > 0) {
    sections.push({
      name: "gainers",
      html: `📈 <b>Top gainers</b>\n${pre(brief.gainers.map((r, i) => moverLine(r, i + 1)))}`,
    });
  }
  if (brief.losers.length > 0) {
    sections.push({
      name: "losers",
      html: `📉 <b>Top losers</b>\n${pre(brief.losers.map((r, i) => moverLine(r, i + 1)))}`,
    });
  }

  // ---- Crypto ------------------------------------------------------------
  if (brief.crypto.length > 0) {
    sections.push({
      name: "crypto",
      html: `₿ <b>Crypto</b>\n${pre(brief.crypto.map((r) => levelLine(r, SPARK_WIDTH)))}`,
    });
  }

  // ---- Watchlist ---------------------------------------------------------
  if (brief.watchlist.length > 0) {
    sections.push({
      name: "watchlist",
      html: `👁 <b>Watchlist</b>\n${pre(brief.watchlist.map((r) => levelLine(r, 0)))}`,
    });
  }

  // ---- Macro -------------------------------------------------------------
  const macroRows = Object.values(brief.macro).filter((r): r is LevelRow => Boolean(r));
  if (macroRows.length > 0) {
    sections.push({
      name: "macro",
      html: `🌐 <b>Rates, dollar, commodities</b>\n${pre(macroRows.map((r) => levelLine(r, 0)))}`,
    });
  }

  // ---- Breadth -----------------------------------------------------------
  const { advancers, decliners } = brief.breadth;
  if (advancers !== null || decliners !== null) {
    const bothKnown = advancers !== null && decliners !== null;
    const bar = bothKnown ? ratioBar(advancers, decliners, 20) : "";
    const share =
      bothKnown && advancers + decliners > 0
        ? ` · ${((advancers / (advancers + decliners)) * 100).toFixed(0)}% advancing`
        : "";
    sections.push({
      name: "breadth",
      html:
        `⚖️ <b>Breadth</b>\n` +
        (bar ? pre([bar]) : "") +
        `<b>${advancers ?? "—"}</b> up &gt;3%  ·  <b>${decliners ?? "—"}</b> down &gt;2.5%${share}\n` +
        `<i>Counted over: ${esc(brief.breadth.definition)}</i>`,
    });
  }

  // ---- Evidence ----------------------------------------------------------
  // Last, so it is the first thing dropped on a long day: the narrative above
  // is the point, and the evidence is its appendix.
  if (brief.signals.length > 0) {
    sections.push({
      name: "evidence",
      html:
        `🔍 <b>Evidence behind each sentence</b>\n` +
        brief.signals
          .slice(0, 5)
          .map((s) => `<code>${esc(s.kind)}</code> ${esc(s.evidence.slice(0, 3).join(" · "))}`)
          .join("\n"),
    });
  }

  // ---- Assemble under the limit -----------------------------------------
  const budget = TELEGRAM_TEXT_LIMIT - FOOTER_RESERVE;
  const kept: string[] = [];
  const omitted: string[] = [];
  let length = 0;
  for (const s of sections) {
    const cost = s.html.length + (kept.length ? 2 : 0);
    if (length + cost > budget) {
      omitted.push(s.name);
      continue;
    }
    kept.push(s.html);
    length += cost;
  }

  const footerParts = [
    "Data: Yahoo Finance (delayed)",
    "Every sentence carries its measurement — no causal inference",
    "Not investment advice",
  ];
  if (brief.degraded.length > 0) {
    footerParts.push(`Unavailable: ${brief.degraded.slice(0, 3).join("; ")}`);
  }
  if (omitted.length > 0) {
    footerParts.push(`${omitted.length} section(s) omitted to fit Telegram's message limit`);
  }
  kept.push(`<i>${esc(footerParts.join(" · "))}</i>`);

  let text = kept.join("\n\n");
  // Belt and braces. If this ever trips, a section was mis-measured — better a
  // hard cut than a 400 that loses the whole post.
  if (text.length > TELEGRAM_TEXT_LIMIT) text = text.slice(0, TELEGRAM_TEXT_LIMIT);

  return {
    text,
    buttons: [
      [
        { text: "Markets", url: `${SITE}/investing` },
        { text: "Open FurlPay", url: `${SITE}/dashboard` },
      ],
    ],
    omitted,
  };
}
