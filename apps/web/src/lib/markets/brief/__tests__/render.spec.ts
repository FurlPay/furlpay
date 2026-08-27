import { describe, it, expect } from "vitest";
import {
  clamp,
  clampLines,
  compactLevel,
  DISCORD_LIMITS,
  embedCharCount,
  enforceMessageBudget,
  messageCharCount,
  money,
  pct,
  renderBrief,
  rvolOf,
  changeCellText,
  signedMoney,
  TABLE_WIDTHS,
  volume,
} from "../render";
import { stripAnsi, visibleWidth } from "../ansi";
import type { LevelRow, MarketBrief } from "../brief";
import type { ScoredQuote } from "../score";
import type { Signal } from "../analysis";

// ---------------------------------------------------------------------------
// Rendering.
//
// Three failure modes are pinned here.
//
//   A 400 FROM DISCORD because the message crossed a limit. It happens at 21:30
//   UTC, unattended, and from a reader's side it is indistinguishable from
//   "there was no brief today". The message-level 6,000 budget is the one that
//   bites, and ANSI escapes count toward it.
//
//   A MISALIGNED TABLE, because a coloured cell was padded on its byte length
//   instead of its visible width. Invisible in a unit test that only checks
//   substrings; obvious and ugly in the channel.
//
//   A NULL RENDERED AS A NUMBER. "0.00%" says the stock was flat. It was not —
//   we did not know.
// ---------------------------------------------------------------------------

function lvl(
  short: string,
  symbol: string,
  price: number,
  changePercent: number | null,
  series: number[] = [1, 2, 3, 4, 5]
): LevelRow {
  return {
    label: short,
    short,
    symbol,
    price,
    change: changePercent === null ? null : (price * changePercent) / 100,
    changePercent,
    series,
    asOf: null,
  };
}

function scored(over: Partial<ScoredQuote> = {}): ScoredQuote {
  const nil = { raw: null, points: 0, detail: null };
  return {
    symbol: "TEST",
    name: "Test Corp",
    price: 100,
    changePercent: 5,
    volume: 2_000_000,
    dollarVolume: 200_000_000,
    marketCap: 1e10,
    score: 80,
    available: 5,
    components: { momentum: nil, participation: nil, trend50: nil, trend200: nil, position: nil },
    reasons: ["+5.00% today", "2.0x average volume", "above 50-day avg"],
    ...over,
  };
}

/** A components object whose participation carries a measured detail string. */
function rvol(detail: string): ScoredQuote["components"] {
  const nil = { raw: null, points: 0, detail: null };
  return {
    momentum: nil,
    participation: { raw: 0.5, points: 12.5, detail },
    trend50: nil,
    trend200: nil,
    position: nil,
  };
}

function sig(id: string, kind: Signal["kind"] = "measured"): Signal {
  return { id, kind, text: `Sentence for ${id}.`, evidence: [`${id} evidence`], weight: 50 };
}

function brief(over: Partial<MarketBrief> = {}): MarketBrief {
  return {
    generatedAt: Date.parse("2026-08-27T21:30:00.000Z"),
    sessionDate: "2026-08-27",
    marketState: "CLOSED",
    indices: [
      lvl("S&P 500", "^GSPC", 7730.99, 0.72),
      lvl("NASDAQ", "^IXIC", 26541.35, 1.57),
      lvl("DOW", "^DJI", 53569.44, 0.2),
    ],
    crypto: [lvl("BTC", "BTC-USD", 80051.96, 1.3), lvl("ETH", "ETH-USD", 2504.89, -0.07)],
    watchlist: [lvl("NVDA", "NVDA", 227.98, 8.74, []), lvl("AAPL", "AAPL", 240.1, -0.4, [])],
    macro: {
      vix: lvl("VIX", "^VIX", 14.51, -4.1, []),
      us10y: lvl("US 10Y", "^TNX", 4.672, -1.39, []),
    },
    gainers: [
      { symbol: "OKTA", name: "Okta, Inc.", price: 172.91, changePercent: 28.63, volume: 16_146_612 },
      { symbol: "CRM", name: "Salesforce", price: 252.05, changePercent: 22.58, volume: 55_300_000 },
    ],
    losers: [
      { symbol: "HQY", name: "HealthEquity", price: 93.39, changePercent: -10.56, volume: 3_216_967 },
    ],
    bullish: [scored({ symbol: "CRM" }), scored({ symbol: "OKTA", score: 100 })],
    breadth: { advancers: 196, decliners: 132, definition: "US equities, price >= $5" },
    signals: [sig("session_direction"), sig("earnings_catalyst", "context")],
    narrative: "The S&P 500 closed higher at 7,730.99, +0.72%.",
    ranking: { considered: 80, rejected: {} },
    degraded: [],
    postable: true,
    ...over,
  };
}

describe("formatters — null is an em-dash, never a number", () => {
  it("renders a missing percentage as an em-dash rather than 0.00%", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("+0.00%");
    expect(pct(-1.5)).toBe("-1.50%");
  });

  it("rejects NaN and Infinity, which format as garbage otherwise", () => {
    expect(pct(Number.NaN)).toBe("—");
    expect(pct(Number.POSITIVE_INFINITY)).toBe("—");
    expect(signedMoney(Number.NaN)).toBe("—");
    expect(compactLevel(Number.NaN)).toBe("—");
  });

  it("renders a missing volume as nothing at all, not as zero", () => {
    expect(volume(null)).toBe("");
    expect(volume(0)).toBe("");
    expect(volume(16_146_612)).toBe("16.1M");
    expect(volume(2_400_000_000)).toBe("2.4B");
  });

  it("gives sub-dollar prices enough places to be meaningful", () => {
    expect(money(0.6051)).toBe("$0.6051");
    expect(money(172.91)).toBe("$172.91");
  });

  it("compacts a level to keep the column narrow without losing the number", () => {
    expect(compactLevel(53569.44)).toBe("53,569");
    expect(compactLevel(7730.99)).toBe("7,731");
    expect(compactLevel(14.51)).toBe("14.51");
    expect(compactLevel(0.6051)).toBe("0.6051");
  });
});

describe("clamp / clampLines", () => {
  it("never returns more than the cap", () => {
    expect(clamp("abcdef", 4)).toHaveLength(4);
    expect(clamp("abc", 10)).toBe("abc");
    expect(clamp("abcdef", 0)).toBe("");
  });

  it("drops whole trailing lines rather than cutting one in half", () => {
    const out = clampLines(["aaaa", "bbbb", "cccc"], 9);
    expect(out).toBe("aaaa\nbbbb");
  });

  it("handles an empty list", () => {
    expect(clampLines([], 100)).toBe("");
  });
});

describe("the message budget is a MESSAGE budget, not a per-embed one", () => {
  it("counts every embed toward the 6,000 total", () => {
    const embeds = [
      { title: "a", fields: [{ name: "n", value: "x".repeat(100) }] },
      { title: "b", fields: [{ name: "n", value: "y".repeat(100) }] },
    ];
    expect(messageCharCount(embeds)).toBe(embedCharCount(embeds[0]) + embedCharCount(embeds[1]));
    expect(messageCharCount(embeds)).toBe(2 * (1 + 1 + 100));
  });

  it("drops trailing fields, then whole trailing embeds, until it fits", () => {
    const embeds = [
      { title: "keep", fields: [{ name: "a", value: "x".repeat(500) }] },
      { title: "trim", fields: [{ name: "b", value: "y".repeat(500) }] },
      { title: "drop", fields: [{ name: "c", value: "z".repeat(500) }] },
    ];
    const out = enforceMessageBudget(embeds, 600);
    expect(messageCharCount(embeds)).toBeLessThanOrEqual(600);
    expect(out.droppedFields + out.droppedEmbeds).toBeGreaterThan(0);
    // The first embed survives — sections are ordered by importance.
    expect(embeds[0].title).toBe("keep");
  });

  it("never removes the last remaining embed", () => {
    const embeds = [{ title: "only", fields: [{ name: "a", value: "x".repeat(9000) }] }];
    enforceMessageBudget(embeds, 100);
    expect(embeds).toHaveLength(1);
  });

  it("counts ANSI escapes, which are real characters in the payload", () => {
    // A coloured table carries dozens of ~9-byte escapes. The budget must be
    // measured on the string that is actually sent, not on what a reader sees,
    // or a message that looks like 4,000 characters is really 5,800 and 400s.
    const payload = renderBrief(brief());
    const values = payload.embeds.flatMap((e) => (e.fields ?? []).map((f) => f.value));
    const coloured = values.filter((v) => v.includes(""));
    expect(coloured.length).toBeGreaterThan(0);

    const visible = coloured.reduce((n, v) => n + stripAnsi(v).length, 0);
    const actual = coloured.reduce((n, v) => n + v.length, 0);
    expect(actual).toBeGreaterThan(visible);

    // embedCharCount must report the real cost, not the visible one.
    const counted = messageCharCount(payload.embeds);
    const visibleTotal = payload.embeds.reduce(
      (n, e) =>
        n +
        (e.title?.length ?? 0) +
        stripAnsi(e.description ?? "").length +
        (e.footer?.text.length ?? 0) +
        (e.fields ?? []).reduce((m, f) => m + f.name.length + stripAnsi(f.value).length, 0),
      0
    );
    expect(counted).toBeGreaterThan(visibleTotal);
  });
});

describe("renderBrief — the message Discord will accept", () => {
  it("fits every documented Discord limit", () => {
    const payload = renderBrief(brief());
    expect(payload.embeds.length).toBeLessThanOrEqual(DISCORD_LIMITS.embeds);
    expect(messageCharCount(payload.embeds)).toBeLessThanOrEqual(DISCORD_LIMITS.totalEmbedChars);
    expect((payload.content ?? "").length).toBeLessThanOrEqual(DISCORD_LIMITS.content);
    for (const e of payload.embeds) {
      expect(e.title?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.title);
      expect(e.description?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.description);
      expect(e.footer?.text.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.footer);
      expect(e.fields?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.fields);
      for (const f of e.fields ?? []) {
        expect(f.name.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldName);
        expect(f.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
      }
    }
  });

  it("stays inside the limits on a maximally verbose brief", () => {
    const long = brief({
      bullish: Array.from({ length: 8 }, (_, i) =>
        scored({
          symbol: `SYMBOL${i}`,
          reasons: Array.from({ length: 5 }, (_, j) => `reason ${j} with padding`.repeat(3)),
        })
      ),
      gainers: Array.from({ length: 8 }, (_, i) => ({
        symbol: `GAIN${i}`,
        name: "Another Extremely Long Company Name Limited",
        price: 123.45,
        changePercent: 20 - i,
        volume: 12_345_678,
      })),
      losers: Array.from({ length: 8 }, (_, i) => ({
        symbol: `LOSE${i}`,
        name: "Yet Another Long Corporate Name Group",
        price: 54.32,
        changePercent: -10 + i,
        volume: 9_876_543,
      })),
      watchlist: Array.from({ length: 12 }, (_, i) => lvl(`TICK${i}`, `TICK${i}`, 100 + i, i - 6, [])),
      narrative: "A very long narrative sentence. ".repeat(20),
      signals: Array.from({ length: 8 }, (_, i) => sig(`signal_${i}`)),
      degraded: ["one upstream failed".repeat(20)],
    });
    const payload = renderBrief(long);
    expect(messageCharCount(payload.embeds)).toBeLessThanOrEqual(DISCORD_LIMITS.totalEmbedChars);
    for (const e of payload.embeds) {
      for (const f of e.fields ?? []) {
        expect(f.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
      }
    }
  });
});

describe("tables stay aligned and fit a phone", () => {
  it("keeps every declared table inside the mobile column budget", () => {
    // A table that gains a column fails here rather than silently wrapping on
    // every phone in production.
    expect(TABLE_WIDTHS.fits.level).toBe(true);
    expect(TABLE_WIDTHS.fits.mover).toBe(true);
    expect(TABLE_WIDTHS.fits.bullish).toBe(true);
  });

  it("renders every row of a table at the same visible width", () => {
    // Green rows and red rows carry different escape lengths; if the padding
    // counted bytes, these would differ.
    const payload = renderBrief(
      brief({
        gainers: [
          { symbol: "A", name: "A", price: 10, changePercent: 5, volume: 1e6 },
          { symbol: "BBBBBB", name: "B", price: 1000, changePercent: -12.34, volume: 1e9 },
        ],
      })
    );
    const gainersField = payload.embeds
      .flatMap((e) => e.fields ?? [])
      .find((f) => f.name === "Top gainers");
    const rows = gainersField!.value
      .split("\n")
      .filter((l) => l && !l.startsWith("```"));
    const widths = rows.map(visibleWidth);
    expect(new Set(widths).size).toBe(1);
  });

  it("wraps coloured rows in an ansi fence so Discord colourises them", () => {
    const payload = renderBrief(brief());
    const all = JSON.stringify(payload);
    expect(all).toContain("```ansi");
  });
});

describe("colour and direction", () => {
  it("colours the header from the S&P and stays neutral without one", () => {
    expect(renderBrief(brief()).embeds[0].color).toBe(0x2ecc71);
    expect(
      renderBrief(brief({ indices: [lvl("S&P 500", "^GSPC", 7000, -0.7)] })).embeds[0].color
    ).toBe(0xed4245);
    expect(renderBrief(brief({ indices: [] })).embeds[0].color).toBe(0x9aa4b2);
  });

  it("gives gainers a green border and losers a red one", () => {
    const embeds = renderBrief(brief()).embeds;
    const gainers = embeds.find((e) => e.fields?.some((f) => f.name === "Top gainers"));
    const losers = embeds.find((e) => e.fields?.some((f) => f.name === "Top losers"));
    expect(gainers!.color).toBe(0x2ecc71);
    expect(losers!.color).toBe(0xed4245);
  });

  it("puts direction in the text, not only in the colour", () => {
    const up = renderBrief(brief());
    expect(stripAnsi(up.embeds[0].description!)).toContain("▲");
    const down = renderBrief(brief({ indices: [lvl("S&P 500", "^GSPC", 7000, -0.7)] }));
    expect(stripAnsi(down.embeds[0].description!)).toContain("▼");
  });
});

describe("the notification tape", () => {
  it("puts a readable one-liner in the message content", () => {
    const p = renderBrief(brief());
    expect(p.content).toContain("S&P 500");
    expect(p.content).toContain("▲");
    expect(p.content).toContain("0.72%");
  });

  it("omits the tape entirely when no index answered", () => {
    expect(renderBrief(brief({ indices: [] })).content).toBeUndefined();
  });
});

describe("sections and honesty", () => {
  it("numbers every board from 1, not from Array#map's zero index", () => {
    const fields = renderBrief(brief()).embeds.flatMap((e) => e.fields ?? []);
    for (const f of fields) {
      if (!["Top gainers", "Top losers"].includes(f.name)) continue;
      const rows = f.value.split("\n").filter((l) => l && !l.startsWith("```"));
      expect(stripAnsi(rows[0]).trim().startsWith("1 ")).toBe(true);
    }
  });

  it("omits a section entirely rather than rendering an empty one", () => {
    const names = renderBrief(brief({ losers: [], crypto: [], bullish: [], watchlist: [], macro: {} }))
      .embeds.flatMap((e) => e.fields ?? [])
      .map((f) => f.name);
    expect(names).not.toContain("Top losers");
    expect(names).not.toContain("Crypto");
    expect(names).not.toContain("Watchlist");
    expect(names).toContain("Top gainers");
  });

  it("says the index levels were unavailable rather than printing an empty block", () => {
    expect(renderBrief(brief({ indices: [] })).embeds[0].description).toContain("unavailable");
  });

  it("carries the narrative and the evidence behind it", () => {
    const e = renderBrief(brief()).embeds[0];
    expect(e.description).toContain("+0.72%");
    const evidence = e.fields?.find((f) => f.name.startsWith("Evidence"));
    expect(evidence?.value).toContain("session_direction evidence");
    // The claim TYPE travels with the claim.
    expect(evidence?.value).toContain("measured");
    expect(evidence?.value).toContain("context");
  });

  it("prints what the breadth numbers actually counted", () => {
    const breadth = renderBrief(brief())
      .embeds.flatMap((e) => e.fields ?? [])
      .find((f) => f.name === "Breadth");
    expect(breadth?.value).toContain("196");
    expect(breadth?.value).toContain("US equities, price >= $5");
    expect(breadth?.value).toContain("60% advancing");
  });

  it("names failed upstreams and disclaims advice in the footer", () => {
    const embeds = renderBrief(brief({ degraded: ["day_losers screen unavailable"] })).embeds;
    const footer = embeds[embeds.length - 1].footer!.text;
    expect(footer).toContain("day_losers screen unavailable");
    expect(footer).toContain("Yahoo Finance");
    expect(footer).toContain("Not investment advice");
    expect(footer).toContain("no causal inference");
  });

  it("titles a closed session a Daily brief and a live one a Midday brief", () => {
    expect(renderBrief(brief({ marketState: "CLOSED" })).embeds[0].title).toContain("Daily Market Brief");
    expect(renderBrief(brief({ marketState: "REGULAR" })).embeds[0].title).toContain("Midday Market Brief");
    expect(renderBrief(brief({ marketState: null })).embeds[0].title).toContain("Market Brief");
  });

  it("keeps each score's justification next to it", () => {
    const why = renderBrief(brief())
      .embeds.flatMap((e) => e.fields ?? [])
      .find((f) => f.name === "Why they rank");
    expect(why?.value).toContain("2.0x average volume");
    expect(why?.value).toContain("**1. CRM**");
  });

  it("does not throw when a level row carries no series to draw", () => {
    // The watchlist rows deliberately have none.
    expect(() => renderBrief(brief())).not.toThrow();
    expect(() =>
      renderBrief(brief({ indices: [lvl("S&P 500", "^GSPC", 7000, 0.5, [])] }))
    ).not.toThrow();
  });
});

describe("the change cell — signs and units a reader can misread", () => {
  it("does not double-negate: the arrow carries the sign, the number is absolute", () => {
    const down = changeCellText(lvl("GOOGL", "GOOGL", 340.65, -0.39, []));
    expect(down).toBe("▼0.39%");
    expect(down).not.toContain("-0.39");
    expect(changeCellText(lvl("NVDA", "NVDA", 227.98, 8.74, []))).toBe("▲8.74%");
  });

  it("renders a yield's move in basis points, not as a percent of a percent", () => {
    // ^TNX quotes 4.672 meaning 4.672%. A "+0.17%" percent-change beside that
    // reads as 17bp when it means 0.8bp.
    const tnx: LevelRow = {
      label: "US 10Y",
      short: "US10Y",
      unit: "yield",
      symbol: "^TNX",
      price: 4.672,
      change: 0.008,
      changePercent: 0.17,
      series: [],
      asOf: null,
    };
    expect(changeCellText(tnx)).toBe("▲0.8bp");
    expect(changeCellText({ ...tnx, change: -0.066, changePercent: -1.39 })).toBe("▼6.6bp");
  });

  it("renders an em-dash when the change is unknown, never a zero", () => {
    expect(changeCellText(lvl("X", "X", 100, null, []))).toBe("▬—");
  });

  it("marks a yield with no absolute change as unknown rather than 0bp", () => {
    const tnx: LevelRow = {
      label: "US 10Y",
      short: "US10Y",
      unit: "yield",
      symbol: "^TNX",
      price: 4.672,
      change: null,
      changePercent: 0.17,
      series: [],
      asOf: null,
    };
    expect(changeCellText(tnx)).toContain("—");
  });
});

describe("the bullish table separates rows on something that varies", () => {
  it("shows relative volume, because the scores saturate in the 90s", () => {
    const table = renderBrief(
      brief({
        bullish: [
          scored({ symbol: "AAA", score: 100, components: rvol("3.7x average volume") }),
          scored({ symbol: "BBB", score: 97, components: rvol("2.8x average volume") }),
        ],
      })
    )
      .embeds.flatMap((e) => e.fields ?? [])
      .find((f) => f.name.startsWith("Most bullish"))!.value;
    expect(stripAnsi(table)).toContain("3.7x");
    expect(stripAnsi(table)).toContain("2.8x");
    expect(stripAnsi(table)).toContain("RVOL");
  });

  it("renders an unmeasured relative volume as an em-dash, not as 1.0x", () => {
    expect(rvolOf(scored({ symbol: "X" }))).toBeNull();
    const table = renderBrief(brief({ bullish: [scored({ symbol: "X" })] }))
      .embeds.flatMap((e) => e.fields ?? [])
      .find((f) => f.name.startsWith("Most bullish"))!.value;
    expect(stripAnsi(table)).toContain("—");
    expect(stripAnsi(table)).not.toContain("1.0x");
  });

  it("keeps the header row aligned with the data rows", () => {
    const table = renderBrief(brief())
      .embeds.flatMap((e) => e.fields ?? [])
      .find((f) => f.name.startsWith("Most bullish"))!.value;
    const rows = table.split("\n").filter((l) => l && !l.startsWith("```"));
    const widths = rows.map(visibleWidth);
    expect(new Set(widths).size).toBe(1);
  });
});
