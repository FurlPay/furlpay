import { describe, it, expect } from "vitest";
import {
  analyze,
  narrate,
  recentEarnings,
  vixRegime,
  EARNINGS_LOOKBACK_HOURS,
  type AnalysisInput,
  type MacroSnapshot,
} from "../analysis";
import type { LevelRow } from "../brief";
import type { ScreenerQuote } from "../screener";
import type { ScoredQuote } from "../score";

// ---------------------------------------------------------------------------
// The analysis engine.
//
// This suite exists for one reason: an unattended poster that emits a causal
// claim is generating fiction in the register of fact, every day, with total
// confidence and no proofreader. The tests below pin the boundary.
//
// The most important test in this file is "never emits a causal claim". It is
// not a style check — it is the invariant the whole module is built around.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-08-27T21:30:00.000Z");
const HOUR = 3_600_000;

function lvl(symbol: string, price: number, changePercent: number | null): LevelRow {
  return {
    label: symbol,
    short: symbol,
    symbol,
    price,
    change: changePercent === null ? null : (price * changePercent) / 100,
    changePercent,
    series: [],
    asOf: NOW,
  };
}

function sq(over: Partial<ScreenerQuote> = {}): ScreenerQuote {
  return { symbol: "TEST", regularMarketPrice: 100, regularMarketChangePercent: 5, ...over };
}

function scored(symbol: string, relVolumeDetail: string | null): ScoredQuote {
  const nil = { raw: null, points: 0, detail: null };
  return {
    symbol,
    name: symbol,
    price: 100,
    changePercent: 5,
    volume: 1e6,
    dollarVolume: 1e8,
    marketCap: 1e10,
    score: 80,
    available: 5,
    components: {
      momentum: nil,
      participation:
        relVolumeDetail === null ? nil : { raw: 0.5, points: 12.5, detail: relVolumeDetail },
      trend50: nil,
      trend200: nil,
      position: nil,
    },
    reasons: [],
  };
}

/** A healthy, fully-populated input. Tests remove pieces from it. */
function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  const macro: MacroSnapshot = {
    vix: lvl("^VIX", 14.51, -4.1),
    us10y: lvl("^TNX", 4.672, -1.39),
    dxy: lvl("DX-Y.NYB", 99.138, 0.14),
    wti: lvl("CL=F", 83.59, -1.67),
    gold: lvl("GC=F", 4658.7, 0.39),
    russell: lvl("^RUT", 3014.34, 0.73),
  };
  return {
    indices: [lvl("^GSPC", 7730.99, 0.72), lvl("^IXIC", 26541.35, 1.57), lvl("^DJI", 53569.44, 0.2)],
    macro,
    bullish: [
      scored("CRM", "3.7x average volume"),
      scored("OKTA", "4.5x average volume"),
      scored("VEEV", "2.9x average volume"),
    ],
    gainerQuotes: [
      sq({ symbol: "OKTA", regularMarketChangePercent: 28.63, earningsTimestamp: (NOW - 24.6 * HOUR) / 1000, isEarningsDateEstimate: false }),
      sq({ symbol: "CRM", regularMarketChangePercent: 22.58, earningsTimestamp: (NOW - 24.6 * HOUR) / 1000, isEarningsDateEstimate: false }),
      sq({ symbol: "CRWD", regularMarketChangePercent: 20.5, earningsTimestamp: (NOW - 24.6 * HOUR) / 1000, isEarningsDateEstimate: false }),
    ],
    advancers: 196,
    decliners: 132,
    now: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("the invariant: no sentence asserts a cause", () => {
  /** Words that turn a co-movement into a mechanism. */
  const CAUSAL = [
    "because",
    "caused",
    "causing",
    "drove",
    "driven by",
    "led to",
    "due to",
    "thanks to",
    "as a result of",
    "boosting",
    "triggered",
    "sparked",
    "fuelled",
    "fueled",
    "on the back of",
    "reversed by",
    "in response to",
  ];

  it("never emits a causal claim on a healthy input", () => {
    const text = narrate(analyze(input()), 20).toLowerCase();
    for (const word of CAUSAL) expect(text).not.toContain(word);
  });

  it("never emits a causal claim on a falling market either", () => {
    const down = input({
      indices: [lvl("^GSPC", 7000, -1.8), lvl("^IXIC", 24000, -2.6), lvl("^DJI", 51000, -0.9)],
      macro: {
        vix: lvl("^VIX", 31.2, 22.5),
        us10y: lvl("^TNX", 5.1, 2.4),
        gold: lvl("GC=F", 4800, 1.8),
        russell: lvl("^RUT", 2800, -2.4),
        wti: lvl("CL=F", 95, 3.2),
        dxy: lvl("DX-Y.NYB", 101, 0.8),
      },
      advancers: 12,
      decliners: 410,
    });
    const text = narrate(analyze(down), 20).toLowerCase();
    for (const word of CAUSAL) expect(text).not.toContain(word);
  });

  it("tags every finding as measured, relationship or context — never as a cause", () => {
    for (const s of analyze(input())) {
      expect(["measured", "relationship", "context"]).toContain(s.kind);
    }
  });

  it("attaches at least one measurement to every finding", () => {
    for (const s of analyze(input())) {
      expect(s.evidence.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it("words the rates finding as co-movement, not mechanism", () => {
    const s = analyze(input()).find((x) => x.id === "rates_comovement");
    expect(s).toBeDefined();
    expect(s!.kind).toBe("relationship");
    expect(s!.text).toContain("while");
    expect(s!.text.toLowerCase()).not.toContain("because");
  });
});

describe("earnings detection — the one place a reason is a published fact", () => {
  it("finds confirmed reports inside the window", () => {
    const found = recentEarnings(
      [
        sq({ symbol: "A", earningsTimestamp: (NOW - 5 * HOUR) / 1000, isEarningsDateEstimate: false }),
        sq({ symbol: "B", earningsTimestamp: (NOW - 24.6 * HOUR) / 1000, isEarningsDateEstimate: false }),
      ],
      NOW
    );
    expect(found.map((f) => f.symbol)).toEqual(["A", "B"]);
  });

  it("DISCARDS an estimated earnings date", () => {
    // The critical guard. An estimate is a guess about the future; treating it
    // as a report has the brief announce results a company has not published.
    const found = recentEarnings(
      [sq({ symbol: "EST", earningsTimestamp: (NOW - 5 * HOUR) / 1000, isEarningsDateEstimate: true })],
      NOW
    );
    expect(found).toEqual([]);
  });

  it("excludes a company that has NOT reported yet", () => {
    // A future-dated timestamp is a scheduled report, not a past one.
    const found = recentEarnings(
      [sq({ symbol: "SOON", earningsTimestamp: (NOW + 120 * HOUR) / 1000, isEarningsDateEstimate: false })],
      NOW
    );
    expect(found).toEqual([]);
  });

  it("excludes a report older than the lookback window", () => {
    const found = recentEarnings(
      [
        sq({
          symbol: "OLD",
          earningsTimestamp: (NOW - (EARNINGS_LOOKBACK_HOURS + 10) * HOUR) / 1000,
          isEarningsDateEstimate: false,
        }),
      ],
      NOW
    );
    expect(found).toEqual([]);
  });

  it("ignores rows with no earnings timestamp at all", () => {
    expect(recentEarnings([sq({ symbol: "NONE" })], NOW)).toEqual([]);
  });

  it("states the finding as a count and a list, with no adjective about quality", () => {
    const s = analyze(input()).find((x) => x.id === "earnings_catalyst");
    expect(s).toBeDefined();
    expect(s!.text).toContain("3 of the day's 3 largest gainers reported earnings");
    // No "blowout", no "strong", no "beat" — we did not read the results.
    expect(s!.text.toLowerCase()).not.toMatch(/blowout|strong|beat|miss|impressive/);
    expect(s!.evidence.join(" ")).toContain("confirmed date");
  });

  it("stays silent when only one leader reported — one is a coincidence", () => {
    const one = input({
      gainerQuotes: [
        sq({ symbol: "A", earningsTimestamp: (NOW - 5 * HOUR) / 1000, isEarningsDateEstimate: false }),
        sq({ symbol: "B" }),
        sq({ symbol: "C" }),
      ],
    });
    expect(analyze(one).find((x) => x.id === "earnings_catalyst")).toBeUndefined();
  });
});

describe("breadth divergence — the finding the headline number hides", () => {
  it("flags a narrow advance when the index rose but more names fell", () => {
    const narrow = input({ advancers: 40, decliners: 260 });
    const s = analyze(narrow).find((x) => x.id === "breadth_divergence");
    expect(s).toBeDefined();
    expect(s!.text).toContain("narrow");
    expect(s!.evidence.join(" ")).toContain("not a full advance/decline line");
  });

  it("confirms breadth when it agrees with the index", () => {
    const s = analyze(input()).find((x) => x.id === "breadth_confirms");
    expect(s).toBeDefined();
    expect(s!.text).toContain("196");
    expect(s!.text).toContain("132");
  });

  it("says nothing at all when the counts are missing", () => {
    const none = input({ advancers: null, decliners: null });
    const ids = analyze(none).map((s) => s.id);
    expect(ids).not.toContain("breadth_confirms");
    expect(ids).not.toContain("breadth_divergence");
  });
});

describe("leadership is arithmetic on three numbers, not a sector opinion", () => {
  it("reports growth leadership when the Nasdaq outpaces the Dow", () => {
    const s = analyze(input()).find((x) => x.id === "leadership_growth");
    expect(s).toBeDefined();
    expect(s!.text).toContain("1.37 points");
  });

  it("reports the reverse when the Dow outpaces the Nasdaq", () => {
    const value = input({
      indices: [lvl("^GSPC", 7000, 0.3), lvl("^IXIC", 24000, -0.5), lvl("^DJI", 51000, 1.1)],
    });
    const s = analyze(value).find((x) => x.id === "leadership_value");
    expect(s).toBeDefined();
    expect(s!.text).toContain("against technology weighting");
  });

  it("calls a tight spread uniform rather than inventing a leader", () => {
    const flat = input({
      indices: [lvl("^GSPC", 7000, 0.5), lvl("^IXIC", 24000, 0.6), lvl("^DJI", 51000, 0.5)],
    });
    expect(analyze(flat).find((x) => x.id === "leadership_uniform")).toBeDefined();
  });

  it("emits nothing when an index is missing rather than assuming zero", () => {
    const partial = input({ indices: [lvl("^GSPC", 7000, 0.5)] });
    const ids = analyze(partial).map((s) => s.id);
    expect(ids).not.toContain("leadership_growth");
    expect(ids).not.toContain("leadership_value");
    expect(ids).not.toContain("leadership_uniform");
  });
});

describe("risk appetite is a printed tally, not a black box", () => {
  it("prints every input that went into the verdict", () => {
    const s = analyze(input()).find((x) => x.id === "risk_appetite");
    expect(s).toBeDefined();
    expect(s!.text).toContain("risk-on");
    expect(s!.evidence.length).toBe(4);
    expect(s!.evidence.join(" ")).toContain("VIX");
    expect(s!.evidence.join(" ")).toContain("(risk-on)");
  });

  it("reads risk-off when the series point the other way", () => {
    const off = input({
      indices: [lvl("^GSPC", 7000, -1.5)],
      macro: { vix: lvl("^VIX", 30, 18), gold: lvl("GC=F", 4800, 2.1), russell: lvl("^RUT", 2800, -2) },
    });
    const s = analyze(off).find((x) => x.id === "risk_appetite");
    expect(s!.text).toContain("risk-off");
  });

  it("refuses a regime call on fewer than three measured series", () => {
    const thin = input({ indices: [lvl("^GSPC", 7000, 0.5)], macro: { vix: lvl("^VIX", 14, -2) } });
    expect(analyze(thin).find((x) => x.id === "risk_appetite")).toBeUndefined();
  });
});

describe("volatility", () => {
  it("bands the VIX and prints the band it used", () => {
    expect(vixRegime(12).label).toBe("calm");
    expect(vixRegime(17).label).toBe("normal");
    expect(vixRegime(24).label).toBe("elevated");
    expect(vixRegime(41).label).toBe("stressed");
    const s = analyze(input()).find((x) => x.id === "volatility");
    expect(s!.text).toContain("calm");
    expect(s!.text).toContain("below 15");
  });

  it("emits nothing when the VIX did not fetch", () => {
    const noVix = input({ macro: { us10y: lvl("^TNX", 4.6, -1) } });
    expect(analyze(noVix).find((x) => x.id === "volatility")).toBeUndefined();
  });
});

describe("participation uses a median, so one outlier does not describe the board", () => {
  it("reports the median relative volume", () => {
    const s = analyze(input()).find((x) => x.id === "participation");
    expect(s).toBeDefined();
    expect(s!.text).toContain("3.7x");
  });

  it("is not dragged by a single extreme reading", () => {
    const skewed = input({
      bullish: [
        scored("A", "1.1x average volume"),
        scored("B", "1.2x average volume"),
        scored("C", "40.0x average volume"),
      ],
    });
    const s = analyze(skewed).find((x) => x.id === "participation");
    expect(s!.text).toContain("1.2x");
    expect(s!.text).toContain("ordinary");
  });

  it("stays quiet when too few rows carried a volume measurement", () => {
    const thin = input({ bullish: [scored("A", null), scored("B", null), scored("C", null)] });
    expect(analyze(thin).find((x) => x.id === "participation")).toBeUndefined();
  });
});

describe("ordering and robustness", () => {
  it("produces the same narrative twice from the same input", () => {
    const a = narrate(analyze(input()), 20);
    const b = narrate(analyze(input()), 20);
    expect(a).toBe(b);
  });

  it("leads with the session direction", () => {
    expect(analyze(input())[0].id).toBe("session_direction");
  });

  it("returns nothing at all rather than a hedged paragraph when there is no data", () => {
    const empty = analyze({
      indices: [],
      macro: {},
      bullish: [],
      gainerQuotes: [],
      advancers: null,
      decliners: null,
      now: NOW,
    });
    expect(empty).toEqual([]);
    expect(narrate(empty)).toBe("");
  });

  it("survives a macro row whose percent change is unknown", () => {
    const partial = input({ macro: { vix: lvl("^VIX", 14.5, null) } });
    expect(() => analyze(partial)).not.toThrow();
    const s = analyze(partial).find((x) => x.id === "volatility");
    // The level is known even when the change is not — the sentence prints the
    // level and simply omits the move.
    expect(s!.text).toContain("14.50");
  });

  it("caps the narrative at the requested sentence count", () => {
    expect(narrate(analyze(input()), 3).split(". ").length).toBeLessThanOrEqual(4);
  });
});

describe("a count must agree with the population it names", () => {
  it("states the denominator the 52-week-high count was taken over", () => {
    // The bug this pins: counting across 40 fetched candidates while calling
    // them "the day's top gainers" (5) prints an impossible-looking number.
    const many = input({
      gainerQuotes: Array.from({ length: 40 }, (_, i) =>
        sq({ symbol: `S${i}`, fiftyTwoWeekHighChangePercent: i < 38 ? -0.1 : -12 })
      ),
    });
    const s = analyze(many).find((x) => x.id === "new_highs");
    expect(s!.text).toContain("38 of the 40 names on the day-gainers screen");
    expect(s!.text).not.toContain("38 of the day's top gainers");
  });

  it("counts only rows where the distance was actually measured", () => {
    const mixed = input({
      gainerQuotes: [
        sq({ symbol: "A", fiftyTwoWeekHighChangePercent: -0.1 }),
        sq({ symbol: "B", fiftyTwoWeekHighChangePercent: -30 }),
        sq({ symbol: "C", fiftyTwoWeekHighChangePercent: undefined }),
      ],
    });
    const s = analyze(mixed).find((x) => x.id === "new_highs");
    // C has no measurement, so it is not in the denominator either.
    expect(s!.text).toContain("1 of the 2 names");
  });
});

describe("the risk tally has a deadband, so noise is not read as direction", () => {
  it("excludes a series that barely moved from both sides of the tally", () => {
    const noisy = input({
      indices: [lvl("^GSPC", 7000, 0.72)],
      macro: {
        vix: lvl("^VIX", 14.5, -4.6),
        gold: lvl("GC=F", 4656.9, 0.08), // noise — must not count as risk-off
        russell: lvl("^RUT", 3014, 0.28),
      },
    });
    const s = analyze(noisy).find((x) => x.id === "risk_appetite");
    expect(s!.evidence.join(" ")).not.toContain("gold");
    expect(s!.text).toContain("3 of 3");
    expect(s!.text).toContain("moved more than 0.1%");
  });

  it("still counts a series that genuinely moved", () => {
    const real = input({
      indices: [lvl("^GSPC", 7000, 0.72)],
      macro: {
        vix: lvl("^VIX", 14.5, -4.6),
        gold: lvl("GC=F", 4800, 2.4),
        russell: lvl("^RUT", 3014, 0.28),
      },
    });
    const s = analyze(real).find((x) => x.id === "risk_appetite");
    expect(s!.evidence.join(" ")).toContain("gold +2.40% (risk-off)");
    expect(s!.text).toContain("3 of 4");
  });

  it("refuses a regime call when too few series moved at all", () => {
    const flat = input({
      indices: [lvl("^GSPC", 7000, 0.02)],
      macro: { vix: lvl("^VIX", 14.5, 0.01), gold: lvl("GC=F", 4656, -0.03) },
    });
    expect(analyze(flat).find((x) => x.id === "risk_appetite")).toBeUndefined();
  });
});
