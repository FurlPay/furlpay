import { describe, it, expect } from "vitest";
import { esc, renderTelegramBrief, TELEGRAM_TEXT_LIMIT } from "../renderTelegram";
import type { LevelRow, MarketBrief } from "../brief";
import type { ScoredQuote } from "../score";
import type { Signal } from "../analysis";

// ---------------------------------------------------------------------------
// Telegram rendering.
//
// THE FAILURE THIS SUITE EXISTS FOR: Telegram does not degrade on bad markup.
// One unescaped `&` in a company name and the API returns 400 "can't parse
// entities" and the ENTIRE day's brief is lost — not one row, all of it. There
// is no partial render to fall back on.
//
// The second failure is the 4,096-character cap, which is on the final string
// including every HTML tag, so it is easy to be comfortably under on visible
// text and over on the wire.
// ---------------------------------------------------------------------------

function lvl(
  short: string,
  symbol: string,
  price: number,
  changePercent: number | null,
  series: number[] = [1, 2, 3, 4, 5],
  unit: "level" | "yield" = "level"
): LevelRow {
  return {
    label: short,
    short,
    unit,
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
    components: {
      momentum: nil,
      participation: { raw: 0.5, points: 12.5, detail: "2.0x average volume" },
      trend50: nil,
      trend200: nil,
      position: nil,
    },
    reasons: ["+5.00% today", "2.0x average volume"],
    ...over,
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
    watchlist: [lvl("NVDA", "NVDA", 227.98, 8.74, [])],
    macro: {
      vix: lvl("VIX", "^VIX", 14.51, -4.1, []),
      us10y: lvl("US10Y", "^TNX", 4.672, 0.17, [], "yield"),
    },
    gainers: [
      { symbol: "OKTA", name: "Okta, Inc.", price: 172.91, changePercent: 28.63, volume: 16_146_612 },
    ],
    losers: [
      { symbol: "HQY", name: "HealthEquity", price: 93.39, changePercent: -10.56, volume: 3_216_967 },
    ],
    bullish: [scored({ symbol: "CRM" })],
    breadth: { advancers: 196, decliners: 132, definition: "US equities, price >= $5" },
    signals: [sig("session_direction"), sig("earnings_catalyst", "context")],
    narrative: "The S&P 500 closed higher at 7,730.99, +0.72%.",
    ranking: { considered: 80, rejected: {} },
    degraded: [],
    postable: true,
    ...over,
  };
}

/** Every `<...>` that is not one of Telegram's supported tags. */
function unsupportedTags(html: string): string[] {
  const allowed = new Set([
    "b", "/b", "i", "/i", "u", "/u", "s", "/s",
    "a", "/a", "code", "/code", "pre", "/pre",
    "blockquote", "/blockquote", "tg-spoiler", "/tg-spoiler",
  ]);
  const found: string[] = [];
  for (const m of html.matchAll(/<([^>]+)>/g)) {
    const tag = m[1].split(/[\s]/)[0].toLowerCase();
    if (!allowed.has(tag)) found.push(m[1]);
  }
  return found;
}

describe("esc — the three characters that break Telegram's parser", () => {
  it("escapes exactly ampersand, less-than and greater-than", () => {
    expect(esc("Smith & Co")).toBe("Smith &amp; Co");
    expect(esc("a<b>c")).toBe("a&lt;b&gt;c");
  });

  it("leaves quotes and apostrophes alone", () => {
    // Escaping these would render literal &#39; inside company names.
    expect(esc(`O'Reilly "Inc"`)).toBe(`O'Reilly "Inc"`);
  });

  it("escapes the ampersand FIRST, so an escape is not double-escaped", () => {
    expect(esc("<")).toBe("&lt;");
    expect(esc("&lt;")).toBe("&amp;lt;");
  });
});

describe("hostile content cannot break the message", () => {
  it("escapes markup-bearing company and ticker names", () => {
    const nasty = brief({
      gainers: [
        { symbol: "A&B", name: "A & B <script>alert(1)</script>", price: 10, changePercent: 5, volume: 1e6 },
      ],
      losers: [{ symbol: "<X>", name: "Less < Than", price: 10, changePercent: -5, volume: 1e6 }],
      bullish: [scored({ symbol: "C&D" })],
      watchlist: [lvl("E&F", "E&F", 100, 1, [])],
      indices: [lvl("S&P 500", "^GSPC", 7730.99, 0.72)],
    });
    const { text } = renderTelegramBrief(nasty);
    expect(text).not.toContain("<script>");
    expect(text).toContain("A&amp;B");
    expect(text).toContain("&lt;X&gt;");
    expect(unsupportedTags(text)).toEqual([]);
  });

  it("escapes the narrative and the breadth definition", () => {
    const nasty = brief({
      narrative: "Gains & losses <b>everywhere</b>",
      breadth: { advancers: 1, decliners: 1, definition: "price >= $5 & volume > 15k" },
    });
    const { text } = renderTelegramBrief(nasty);
    expect(text).toContain("Gains &amp; losses &lt;b&gt;everywhere&lt;/b&gt;");
    expect(text).toContain("volume &gt; 15k");
  });

  it("escapes a degraded-upstream message in the footer", () => {
    const { text } = renderTelegramBrief(brief({ degraded: ["A & B feed <down>"] }));
    expect(text).toContain("A &amp; B feed &lt;down&gt;");
    expect(unsupportedTags(text)).toEqual([]);
  });

  it("emits only tags Telegram supports, on a full brief", () => {
    expect(unsupportedTags(renderTelegramBrief(brief()).text)).toEqual([]);
  });
});

describe("the 4,096-character limit is on the final string", () => {
  it("stays under the cap on a normal brief", () => {
    const { text, omitted } = renderTelegramBrief(brief());
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(omitted).toEqual([]);
  });

  it("stays under the cap on a maximally verbose brief", () => {
    const long = brief({
      bullish: Array.from({ length: 10 }, (_, i) => scored({ symbol: `SYMBOL${i}` })),
      gainers: Array.from({ length: 10 }, (_, i) => ({
        symbol: `GAINER${i}`,
        name: "A Very Long Company Name Incorporated",
        price: 123.45,
        changePercent: 20 - i,
        volume: 12_345_678,
      })),
      losers: Array.from({ length: 10 }, (_, i) => ({
        symbol: `LOSER${i}`,
        name: "Another Long Name",
        price: 54.32,
        changePercent: -10 + i,
        volume: 9_876_543,
      })),
      watchlist: Array.from({ length: 12 }, (_, i) => lvl(`TICK${i}`, `TICK${i}`, 100, i - 6, [])),
      narrative: "A long narrative sentence that keeps going. ".repeat(30),
      signals: Array.from({ length: 10 }, (_, i) => sig(`signal_${i}`)),
      degraded: ["upstream failed ".repeat(30)],
    });
    const { text } = renderTelegramBrief(long);
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("drops whole sections rather than truncating a <pre> block", () => {
    // A half-cut <pre> leaves an unclosed tag, which Telegram rejects outright.
    const long = brief({
      narrative: "x".repeat(3000),
      signals: Array.from({ length: 10 }, (_, i) => sig(`signal_${i}`)),
    });
    const { text, omitted } = renderTelegramBrief(long);
    expect(omitted.length).toBeGreaterThan(0);
    const opens = (text.match(/<pre>/g) ?? []).length;
    const closes = (text.match(/<\/pre>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("names the omission in the footer rather than silently shrinking", () => {
    const long = brief({ narrative: "x".repeat(3200) });
    const { text, omitted } = renderTelegramBrief(long);
    if (omitted.length > 0) expect(text).toContain("omitted to fit");
  });

  it("keeps the header even when everything else is dropped", () => {
    const { text } = renderTelegramBrief(brief({ narrative: "x".repeat(4000) }));
    expect(text).toContain("FurlPay");
  });
});

describe("content and honesty", () => {
  it("opens with a coloured tape, since Telegram has no ANSI", () => {
    const { text } = renderTelegramBrief(brief());
    expect(text).toContain("🟢");
    expect(text).toContain("S&amp;P 500");
  });

  it("uses a red dot for a falling index", () => {
    const { text } = renderTelegramBrief(brief({ indices: [lvl("S&P 500", "^GSPC", 7000, -0.7)] }));
    expect(text).toContain("🔴");
  });

  it("keeps emoji OUT of the monospace blocks, which they would misalign", () => {
    const { text } = renderTelegramBrief(brief());
    for (const m of text.matchAll(/<pre>([\s\S]*?)<\/pre>/g)) {
      expect(m[1]).not.toMatch(/[🟢🔴⚪📈📉₿👁🌐⚖️🔍]/u);
    }
  });

  it("carries direction as an arrow inside the tables, where colour cannot go", () => {
    const { text } = renderTelegramBrief(brief());
    const firstPre = text.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(firstPre).toContain("▲");
  });

  it("renders a yield's move in basis points", () => {
    const { text } = renderTelegramBrief(
      brief({ macro: { us10y: lvl("US10Y", "^TNX", 4.672, 0.17, [], "yield") } })
    );
    expect(text).toContain("bp");
  });

  it("numbers boards from 1", () => {
    const { text } = renderTelegramBrief(
      brief({
        gainers: [
          { symbol: "AA", name: "AA", price: 10, changePercent: 5, volume: 1e6 },
          { symbol: "BB", name: "BB", price: 10, changePercent: 4, volume: 1e6 },
        ],
      })
    );
    expect(text).toMatch(/1\s+AA/);
    expect(text).toMatch(/2\s+BB/);
    expect(text).not.toMatch(/0\s+AA/);
  });

  it("says the index levels were unavailable rather than printing an empty block", () => {
    const { text } = renderTelegramBrief(brief({ indices: [] }));
    expect(text).toContain("unavailable");
  });

  it("omits sections entirely rather than rendering empty ones", () => {
    const { text } = renderTelegramBrief(
      brief({ losers: [], crypto: [], watchlist: [], macro: {}, bullish: [] })
    );
    expect(text).not.toContain("Top losers");
    expect(text).not.toContain("Watchlist");
    expect(text).toContain("Top gainers");
  });

  it("disclaims advice and names the data source", () => {
    const { text } = renderTelegramBrief(brief());
    expect(text).toContain("Yahoo Finance");
    expect(text).toContain("Not investment advice");
    expect(text).toContain("no causal inference");
  });

  it("offers link buttons rather than bare URLs in the body", () => {
    const { buttons } = renderTelegramBrief(brief());
    expect(buttons[0].map((b) => b.text)).toEqual(["Markets", "Open FurlPay"]);
    for (const b of buttons.flat()) expect(b.url.startsWith("https://furlpay.com")).toBe(true);
  });

  it("does not throw when a row carries no series to draw", () => {
    expect(() => renderTelegramBrief(brief({ indices: [lvl("X", "X", 100, 1, [])] }))).not.toThrow();
  });
});

describe("escaping happens AFTER padding, not before", () => {
  it("keeps a ticker containing an ampersand intact and the column aligned", () => {
    // The bug: esc() first turns `A&B` into `A&amp;B`, the padder measures 7
    // columns instead of 3, and the cell truncates to `A&am…`.
    const { text } = renderTelegramBrief(
      brief({
        gainers: [
          { symbol: "A&B", name: "A & B", price: 10, changePercent: 5, volume: 1e6 },
          { symbol: "NORM", name: "Normal", price: 10, changePercent: 4, volume: 1e6 },
        ],
      })
    );
    expect(text).toContain("A&amp;B");
    expect(text).not.toContain("A&am…");
  });

  it("keeps every row of a table the same VISIBLE width once entities collapse", () => {
    const { text } = renderTelegramBrief(
      brief({
        gainers: [
          { symbol: "A&B", name: "x", price: 10, changePercent: 5, volume: 1e6 },
          { symbol: "CDEF", name: "x", price: 10, changePercent: 4, volume: 1e6 },
        ],
      })
    );
    const block = [...text.matchAll(/<pre>([\s\S]*?)<\/pre>/g)]
      .map((m) => m[1])
      .find((b) => b.includes("A&amp;B"))!;
    // Collapse entities back to what a reader sees, then compare widths.
    const widths = block
      .split("\n")
      .map((l) => l.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length);
    expect(new Set(widths).size).toBe(1);
  });
});
