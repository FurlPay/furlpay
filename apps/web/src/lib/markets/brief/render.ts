// ---------------------------------------------------------------------------
// Rendering the brief into a Discord message.
//
// DISCORD'S LIMITS ARE NOT ADVISORY. Exceed any one of them and the webhook
// returns 400 and the post simply does not happen — silently, from the reader's
// side, and at 21:30 UTC when nobody is looking:
//
//     embeds per message        10
//     embed title              256
//     embed description      4,096
//     fields per embed          25
//     field name               256
//     field value            1,024
//     footer text            2,048
//     SUM OF ALL EMBEDS      6,000   <- across the WHOLE message, not per embed
//
// The last one is the trap, and it is a MESSAGE-level budget. An earlier
// version of this file enforced it per embed, which passes every test on a
// one-embed message and then silently 400s the day a second embed is added.
// `enforceMessageBudget` works on the array.
//
// ANSI ESCAPES COUNT TOWARD THAT BUDGET. Every colour is ~9 invisible
// characters and a coloured table carries dozens, so the budget is measured on
// the real string, escapes included.
//
// WHY COLOUR LIVES IN CODE BLOCKS AND NOT IN THE EMBED. An embed has exactly one
// colour, on its left border. Per-row colour — green gainers, red losers — is
// only reachable through a ```ansi fenced block. Hence one embed per section,
// each with a border colour matching its content, and ANSI inside for the rows.
// A client that does not colourise `ansi` still renders a monospace block, so
// the tables stay aligned and readable with no colour at all.
//
// EVERY VISUAL IS ALSO TEXT. Direction is an arrow as well as a colour, because
// colour is invisible to a screen reader, to a colour-blind reader, and in a
// notification preview. A sparkline always sits BESIDE its percentage, never
// instead of it, because a sparkline is auto-scaled and carries no magnitude —
// a 0.1% drift and a 40% collapse draw the same shape.
//
// NO FABRICATED PRECISION. A null renders as an em-dash, never as 0.00%. A
// missing volume renders as nothing, not "0". Every formatter takes
// `number | null` for exactly that reason.
// ---------------------------------------------------------------------------

import type { LevelRow, MarketBrief, MoverRow } from "./brief";
import { disclaimer as pickDisclaimer, type BoardOutcome, type PickOutcome } from "./pickLedger";
import type { ScoredQuote } from "./score";
import type { Signal } from "./analysis";
import { ansiBlock, cell, color, directionColor, fitsMobile, MOBILE_COLUMNS } from "./ansi";
import { arrow, ratioBar, sparkline } from "./glyphs";

export const DISCORD_LIMITS = {
  embeds: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  /** Across every embed in the message, not per embed. */
  totalEmbedChars: 6000,
  content: 2000,
} as const;

/** Headroom left under the hard cap so the footer, added last, always fits. */
const FOOTER_RESERVE = 400;

const COLORS = {
  brand: 0x00e599,
  up: 0x2ecc71,
  down: 0xed4245,
  neutral: 0x9aa4b2,
  crypto: 0xf7931a,
  macro: 0x5865f2,
} as const;

const SITE = "https://furlpay.com";

// A COMBINED chart strip was tried here and removed. Six assets in one picture
// is a dashboard, and a dashboard is the wrong shape for a feed: nothing in it
// can be updated, linked to or read on its own. Each asset now gets its own
// message and its own chart, rendered by /api/og/price-card/[symbol].

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
  /** A chart rendered above the tables. Discord fetches this URL itself. */
  image?: { url: string };
}

export interface DiscordWebhookPayload {
  username?: string;
  content?: string;
  embeds: DiscordEmbed[];
}

/**
 * Truncate to a hard cap, marking the cut. Never returns more than `max`.
 *
 * The zero case is explicit because the ellipsis itself costs a character:
 * without it, clamping to 0 returns a one-character string and quietly breaks
 * the one promise this function makes.
 */
export function clamp(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Characters Discord counts for one embed. Escapes included — they are real
 *  characters in the payload even though the reader never sees them. */
export function embedCharCount(e: DiscordEmbed): number {
  let n = 0;
  n += e.title?.length ?? 0;
  n += e.description?.length ?? 0;
  n += e.footer?.text.length ?? 0;
  for (const f of e.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

/** The message-level total — the limit that actually bites. */
export function messageCharCount(embeds: DiscordEmbed[]): number {
  return embeds.reduce((n, e) => n + embedCharCount(e), 0);
}

// ---- Formatting -----------------------------------------------------------

const priceFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A price. Sub-dollar names need more places than two to be meaningful. */
export function money(n: number): string {
  if (Math.abs(n) < 1) {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  }
  return `$${priceFmt.format(n)}`;
}

/** An index level: no currency symbol, because 7,730.99 is not dollars. */
export function level(n: number): string {
  return priceFmt.format(n);
}

/** Compact level for a narrow column: 26,541.35 -> 26,541 */
export function compactLevel(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (Math.abs(n) < 1) return n.toFixed(4);
  return n.toFixed(2);
}

/** A signed percentage, or an em-dash when there is none to report. */
export function pct(n: number | null, dp = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

/** A signed absolute change, or an em-dash. */
export function signedMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;
}

/** Compact volume. Null renders as nothing at all, not as a zero. */
export function volume(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

// ---- Tables ---------------------------------------------------------------
//
// Column widths are declared as constants and asserted against MOBILE_COLUMNS
// in the spec, so a table that gains a column fails a test rather than silently
// wrapping on every phone in production.

export const LEVEL_COLS = { name: 7, last: 8, chg: 8 } as const;
export const MOVER_COLS = { rank: 2, ticker: 6, chg: 8, vol: 6 } as const;
/** rank, ticker, change, relative volume, score. RVOL earns its column: the
 *  scores cluster in the 90s by construction, so it is the number that actually
 *  separates the rows. */
export const BULLISH_COLS = { rank: 2, ticker: 6, chg: 8, rvol: 5, score: 3 } as const;

/**
 * The change cell for a level row.
 *
 * The arrow already carries the sign, so the number is printed ABSOLUTE —
 * "▼0.39%", not "▼-0.39%", which reads as a double negative.
 *
 * A yield row is shown in basis points. ^TNX quotes 4.672 meaning 4.672%, so a
 * "+0.17%" percent-change beside it reads as 17bp when it means 0.8bp. That is
 * a number a reader silently misreads, which is the worst kind.
 */
export function changeCellText(r: LevelRow): string {
  if (r.unit === "yield") {
    if (r.change === null || !Number.isFinite(r.change)) return `${arrow(r.changePercent)}—`;
    // ^TNX is already in percentage points, so the absolute change IS the move
    // in percentage points; 1pp = 100bp.
    const bp = Math.abs(r.change) * 100;
    return `${arrow(r.change)}${bp.toFixed(1)}bp`;
  }
  if (r.changePercent === null || !Number.isFinite(r.changePercent)) {
    return `${arrow(r.changePercent)}—`;
  }
  return `${arrow(r.changePercent)}${Math.abs(r.changePercent).toFixed(2)}%`;
}

/** Sparkline width, chosen so LEVEL_COLS + gaps + spark stays under the mobile
 *  column budget. */
export const SPARK_WIDTH = 6;

function levelRowLine(r: LevelRow, sparkWidth: number): string {
  const c = directionColor(r.changePercent);
  const spark = sparkWidth > 0 ? sparkline(r.series, sparkWidth) : "";
  const parts = [
    cell(r.short, LEVEL_COLS.name),
    cell(compactLevel(r.price), LEVEL_COLS.last, { align: "right" }),
    cell(changeCellText(r), LEVEL_COLS.chg, { align: "right", fg: c }),
  ];
  if (spark) parts.push(color(spark, c));
  return parts.join(" ");
}

function moverRowLine(r: MoverRow, rank: number): string {
  const c = directionColor(r.changePercent);
  return [
    cell(`${rank}`, MOVER_COLS.rank),
    cell(r.symbol, MOVER_COLS.ticker, { bold: true }),
    cell(pct(r.changePercent), MOVER_COLS.chg, { align: "right", fg: c }),
    cell(volume(r.volume), MOVER_COLS.vol, { align: "right" }),
  ].join(" ");
}

/** Relative volume, recovered from the component's own detail string. Null when
 *  it was never measured — rendered as an em-dash, not as 1.0x. */
export function rvolOf(r: ScoredQuote): number | null {
  const m = r.components.participation.detail?.match(/^([\d.]+)x/);
  const v = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(v) ? v : null;
}

function bullishRowLine(r: ScoredQuote, rank: number): string {
  const rvol = rvolOf(r);
  return [
    cell(`${rank}`, BULLISH_COLS.rank),
    cell(r.symbol, BULLISH_COLS.ticker, { bold: true }),
    cell(pct(r.changePercent), BULLISH_COLS.chg, { align: "right", fg: "green" }),
    cell(rvol === null ? "—" : `${rvol.toFixed(1)}x`, BULLISH_COLS.rvol, {
      align: "right",
      fg: "yellow",
    }),
    cell(`${Math.round(r.score)}`, BULLISH_COLS.score, { align: "right", fg: "cyan" }),
  ].join(" ");
}

/** A compact one-line tape for the message body, above the embeds — this is
 *  what shows in a push notification. */
function tickerTape(rows: LevelRow[]): string {
  return rows
    .map((r) => `${r.short} ${arrow(r.changePercent)}${pct(r.changePercent).replace("+", "")}`)
    .join("  ·  ");
}

/** Headline wording follows the market state Yahoo reported, so a brief posted
 *  mid-session does not describe itself as a close. */
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

/** Colour follows the S&P, falling back to grey when there is no index to
 *  follow — grey being honestly neutral rather than a green implying a day we
 *  did not measure. */
function headerColor(brief: MarketBrief): number {
  const sp = brief.indices.find((i) => i.symbol === "^GSPC") ?? brief.indices[0];
  if (!sp || sp.changePercent === null) return COLORS.neutral;
  return sp.changePercent >= 0 ? COLORS.up : COLORS.down;
}

/** Join lines to a cap, dropping whole trailing lines rather than cutting one
 *  in half. */
export function clampLines(lines: string[], max: number): string {
  if (lines.length === 0) return "";
  const out: string[] = [];
  let n = 0;
  for (const line of lines) {
    const cost = line.length + (out.length ? 1 : 0);
    if (n + cost > max) break;
    out.push(line);
    n += cost;
  }
  return out.length ? out.join("\n") : clamp(lines[0], max);
}

/**
 * Drop trailing fields, then whole trailing embeds, until the MESSAGE fits.
 *
 * Trims from the end because the sections are ordered by importance: the
 * breadth footnote goes before the index table does. Returns what was dropped
 * so the footer can say so — a brief that quietly loses its last section looks
 * like a market with no losers.
 */
export function enforceMessageBudget(
  embeds: DiscordEmbed[],
  // Explicitly `number`: DISCORD_LIMITS is `as const`, so an inferred default
  // would narrow this parameter to the literal 6000 and reject every computed
  // budget the caller actually passes.
  budget: number = DISCORD_LIMITS.totalEmbedChars
): { droppedFields: number; droppedEmbeds: number } {
  let droppedFields = 0;
  let droppedEmbeds = 0;

  while (messageCharCount(embeds) > budget && embeds.length > 1) {
    const last = embeds[embeds.length - 1];
    if (last.fields && last.fields.length > 0) {
      last.fields.pop();
      droppedFields++;
      continue;
    }
    embeds.pop();
    droppedEmbeds++;
  }
  // A single surviving embed still over budget loses its own trailing fields.
  while (messageCharCount(embeds) > budget && embeds[0]?.fields?.length) {
    embeds[0].fields!.pop();
    droppedFields++;
  }
  return { droppedFields, droppedEmbeds };
}

// ---- The message ----------------------------------------------------------

export function renderBrief(
  brief: MarketBrief,
  /** How the previous board actually did. Omitted on the first ever run, when
   *  there is genuinely nothing to report. */
  lastBoard?: BoardOutcome | null
): DiscordWebhookPayload {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(brief.generatedAt));

  const embeds: DiscordEmbed[] = [];

  // ---- 1. Header: index table, then the narrative ------------------------
  const headerParts: string[] = [];
  headerParts.push(
    brief.indices.length > 0
      ? ansiBlock(brief.indices.map((r) => levelRowLine(r, SPARK_WIDTH)))
      : "_Index levels were unavailable for this session._"
  );
  if (brief.narrative) headerParts.push(brief.narrative);

  const header: DiscordEmbed = {
    title: clamp(`FurlPay ${headlineFor(brief.marketState)} · ${dateLabel}`, DISCORD_LIMITS.title),
    url: `${SITE}/investing`,
    description: clamp(headerParts.join("\n"), DISCORD_LIMITS.description),
    color: headerColor(brief),
    fields: [],
    timestamp: new Date(brief.generatedAt).toISOString(),
  };

  // The evidence behind the narrative. Without it the paragraph is a set of
  // assertions; with it, every sentence can be checked against a number.
  const evidenceLines = brief.signals
    .slice(0, 5)
    .map((s: Signal) => `\`${s.kind}\` ${s.evidence.slice(0, 3).join(" · ")}`);
  if (evidenceLines.length > 0) {
    header.fields!.push({
      name: "Evidence behind each sentence",
      value: clampLines(evidenceLines, DISCORD_LIMITS.fieldValue),
    });
  }
  embeds.push(header);

  // ---- 1b. How the last board did ----------------------------------------
  //
  // Placed immediately after the narrative and BEFORE today's picks, on
  // purpose. A scoreboard printed under the new board reads as a footnote; a
  // reader should meet the last set of calls before the next set.
  if (lastBoard && lastBoard.priced > 0) {
    const rows = lastBoard.outcomes.map((o: PickOutcome) => {
      const ret = o.returnPct === null ? "  n/a" : `${o.returnPct >= 0 ? "+" : ""}${o.returnPct.toFixed(2)}%`;
      return `${o.symbol.padEnd(6)} ${ret.padStart(9)}`;
    });
    const mean = lastBoard.meanReturnPct;
    const median = lastBoard.medianReturnPct;
    const headline =
      `${lastBoard.winners}/${lastBoard.priced} up · ` +
      `median ${median === null ? "n/a" : (median >= 0 ? "+" : "") + median.toFixed(2) + "%"} · ` +
      `mean ${mean === null ? "n/a" : (mean >= 0 ? "+" : "") + mean.toFixed(2) + "%"}`;

    embeds.push({
      color: (median ?? 0) >= 0 ? COLORS.up : COLORS.down,
      fields: [
        {
          name: `How the ${lastBoard.sessionDate} board did · ${lastBoard.calendarDaysElapsed}d`,
          value: clamp(`${ansiBlock(rows)}
${headline}`, DISCORD_LIMITS.fieldValue),
        },
      ],
      // The median leads the headline because one name at +129% moves a
      // five-name mean by 26 points on its own and says nothing about the rest.
      footer: { text: pickDisclaimer() },
    });
  }

  // ---- 2. Most bullish ---------------------------------------------------
  if (brief.bullish.length > 0) {
    embeds.push({
      color: COLORS.up,
      fields: [
        {
          name: "Most bullish — momentum · volume · trend · position",
          value: clamp(
            ansiBlock([
              cell("#", BULLISH_COLS.rank) +
                " " +
                cell("TICKER", BULLISH_COLS.ticker, { fg: "grey" }) +
                " " +
                cell("CHG", BULLISH_COLS.chg, { align: "right", fg: "grey" }) +
                " " +
                cell("RVOL", BULLISH_COLS.rvol, { align: "right", fg: "grey" }) +
                " " +
                cell("SCR", BULLISH_COLS.score, { align: "right", fg: "grey" }),
              ...brief.bullish.map((r, i) => bullishRowLine(r, i + 1)),
            ]),
            DISCORD_LIMITS.fieldValue
          ),
        },
        {
          name: "Why they rank",
          value: clampLines(
            brief.bullish.map((r, i) => `**${i + 1}. ${r.symbol}** — ${r.reasons.join(" · ")}`),
            DISCORD_LIMITS.fieldValue
          ),
        },
      ],
    });
  }

  // ---- 3. Gainers, then losers ------------------------------------------
  if (brief.gainers.length > 0) {
    embeds.push({
      color: COLORS.up,
      fields: [
        {
          name: "Top gainers",
          value: clamp(
            ansiBlock(brief.gainers.map((r, i) => moverRowLine(r, i + 1))),
            DISCORD_LIMITS.fieldValue
          ),
        },
      ],
    });
  }
  if (brief.losers.length > 0) {
    embeds.push({
      color: COLORS.down,
      fields: [
        {
          name: "Top losers",
          value: clamp(
            ansiBlock(brief.losers.map((r, i) => moverRowLine(r, i + 1))),
            DISCORD_LIMITS.fieldValue
          ),
        },
      ],
    });
  }

  // ---- 4. Crypto ---------------------------------------------------------
  if (brief.crypto.length > 0) {
    embeds.push({
      color: COLORS.crypto,
      fields: [
        {
          name: "Crypto",
          value: clamp(
            ansiBlock(brief.crypto.map((r) => levelRowLine(r, SPARK_WIDTH))),
            DISCORD_LIMITS.fieldValue
          ),
        },
      ],
    });
  }

  // ---- 5. Watchlist and macro -------------------------------------------
  const tapeFields: DiscordEmbedField[] = [];
  if (brief.watchlist.length > 0) {
    tapeFields.push({
      name: "Watchlist",
      value: clamp(ansiBlock(brief.watchlist.map((r) => levelRowLine(r, 0))), DISCORD_LIMITS.fieldValue),
    });
  }
  const macroRows = Object.values(brief.macro).filter((r): r is LevelRow => Boolean(r));
  if (macroRows.length > 0) {
    tapeFields.push({
      name: "Rates, dollar, commodities",
      value: clamp(ansiBlock(macroRows.map((r) => levelRowLine(r, 0))), DISCORD_LIMITS.fieldValue),
    });
  }
  if (tapeFields.length > 0) embeds.push({ color: COLORS.macro, fields: tapeFields });

  // ---- 6. Breadth --------------------------------------------------------
  const { advancers, decliners } = brief.breadth;
  if (advancers !== null || decliners !== null) {
    const bothKnown = advancers !== null && decliners !== null;
    const advancing = bothKnown && advancers >= decliners;
    const bar = bothKnown ? ratioBar(advancers, decliners, 20) : "";
    const share =
      bothKnown && advancers + decliners > 0
        ? ((advancers / (advancers + decliners)) * 100).toFixed(0)
        : null;
    embeds.push({
      color: bothKnown ? (advancing ? COLORS.up : COLORS.down) : COLORS.neutral,
      fields: [
        {
          name: "Breadth",
          value: clamp(
            [
              bar ? ansiBlock([color(bar, advancing ? "green" : "red")]) : "",
              `**${advancers ?? "—"}** up more than 3%  ·  **${decliners ?? "—"}** down more than 2.5%${
                share === null ? "" : `  ·  ${share}% advancing`
              }`,
              `_Counted over: ${brief.breadth.definition}_`,
            ]
              .filter(Boolean)
              .join("\n"),
            DISCORD_LIMITS.fieldValue
          ),
        },
      ],
    });
  }

  // ---- Budget, then footer ----------------------------------------------
  //
  // Trimmed with headroom reserved, because the footer is added afterwards and
  // counts toward the same budget. Re-checked once it is in place.
  const dropped = enforceMessageBudget(embeds, DISCORD_LIMITS.totalEmbedChars - FOOTER_RESERVE);

  const footerParts = [
    "Data: Yahoo Finance (delayed)",
    "Every sentence carries its measurement — no causal inference",
    "Not investment advice",
  ];
  if (brief.degraded.length > 0) {
    footerParts.push(`Unavailable: ${brief.degraded.slice(0, 3).join("; ")}`);
  }
  const totalDropped = dropped.droppedFields + dropped.droppedEmbeds;
  if (totalDropped > 0) {
    footerParts.push(`${totalDropped} section(s) omitted to fit Discord's message limit`);
  }
  if (embeds.length > 0) {
    embeds[embeds.length - 1].footer = {
      text: clamp(footerParts.join(" · "), DISCORD_LIMITS.footer),
    };
  }

  enforceMessageBudget(embeds);

  const payload: DiscordWebhookPayload = {
    username: "FurlPay Markets",
    embeds: embeds.slice(0, DISCORD_LIMITS.embeds),
  };
  // The tape is the notification preview — the one line a reader sees on a lock
  // screen. Only set when there is something real to put in it.
  if (brief.indices.length > 0) {
    payload.content = clamp(tickerTape(brief.indices), DISCORD_LIMITS.content);
  }
  return payload;
}

/** Exported for the spec: every table must fit a phone's code-block width. */
export const TABLE_WIDTHS = {
  level: [...Object.values(LEVEL_COLS), SPARK_WIDTH],
  mover: Object.values(MOVER_COLS),
  bullish: Object.values(BULLISH_COLS),
  budget: MOBILE_COLUMNS,
  fits: {
    level: fitsMobile([...Object.values(LEVEL_COLS), SPARK_WIDTH]),
    mover: fitsMobile(Object.values(MOVER_COLS)),
    bullish: fitsMobile(Object.values(BULLISH_COLS)),
  },
};
