// ---------------------------------------------------------------------------
// The analysis engine: turning measurements into sentences, and refusing to
// turn them into causes.
//
// THE LINE THIS FILE WALKS. A human market brief reads like this:
//
//     "NVIDIA's blowout earnings and ultra-optimistic guidance completely
//      reversed early session divergence, strongly boosting risk appetite."
//
// Three claims are stacked there. The first is checkable (did NVIDIA report?).
// The second is an opinion ("blowout", "ultra-optimistic"). The third is a
// causal assertion about the mechanism of a whole market, which nobody can
// verify and which is, in the strict sense, made up. An automated poster that
// emits sentence three is generating fiction in the register of fact — and it
// will do so every single day, unattended, with total confidence.
//
// So this engine has exactly one rule: EVERY SENTENCE CARRIES THE MEASUREMENT
// THAT PRODUCED IT, and each is tagged with what kind of claim it is:
//
//   "measured"      A restatement of a number we fetched. "Nasdaq +1.57%."
//                   Wrong only if the upstream is wrong.
//
//   "relationship"  A CO-MOVEMENT between two measured series, worded as
//                   co-movement. "Equities rose while the 10-year yield fell
//                   1.39%." Not "equities rose BECAUSE yields fell" — that
//                   sentence is not in this codebase and cannot be produced
//                   by it.
//
//   "context"       A measured fact placed beside another measured fact where
//                   the adjacency is the point. "Four of the five leaders
//                   reported earnings in the last 48 hours" — both halves are
//                   checkable; the reader draws the inference, not us.
//
// There is no fourth tier. There is no rule in this file that outputs a cause.
//
// WHY EARNINGS DETECTION IS SOUND HERE. Yahoo's screener rows carry
// `earningsTimestamp` and, critically, `isEarningsDateEstimate`. An ESTIMATED
// date is a guess about the future and is discarded — using it would let the
// brief announce that a company reported when it did not. Only confirmed
// timestamps inside the lookback window produce a finding. Measured on
// 2026-08-27: the day's five largest gainers each carried a confirmed
// timestamp 24.6 hours old, which is a fact about the data, not an opinion
// about the market.
//
// NOTHING HERE INVENTS A NUMBER. Every field is nullable, every rule checks its
// inputs, and a rule with missing inputs emits NOTHING rather than a hedged
// sentence built on a default.
// ---------------------------------------------------------------------------

import type { LevelRow } from "./brief";
import type { ScreenerQuote } from "./screener";
import type { ScoredQuote } from "./score";

/** What kind of claim a finding is. See the header — there is no "cause" tier. */
export type ClaimKind = "measured" | "relationship" | "context";

export interface Signal {
  /** Stable id, for tests and for suppressing a rule without touching prose. */
  id: string;
  kind: ClaimKind;
  /** One sentence, safe to print verbatim. */
  text: string;
  /** The measurements that produced it. Rendered under the narrative so a
   *  reader can check the sentence against the numbers behind it. */
  evidence: string[];
  /** Ordering weight — higher leads the narrative. */
  weight: number;
}

// ---------------------------------------------------------------------------
// Macro inputs. All from the same keyless Yahoo chart endpoint as the indices.
// ---------------------------------------------------------------------------

//
// `short` fits the narrow table column; `label` is for prose. `unit: "yield"`
// changes how the change is RENDERED, and that is a correctness fix, not a
// cosmetic one: ^TNX quotes the 10-year yield as a number that is already a
// percentage, so a "+0.17%" percent-change next to "4.67" reads as 17 basis
// points when it actually means 0.8. Yields are shown in basis points.
export const MACRO_SYMBOLS = [
  { symbol: "^VIX", label: "VIX", short: "VIX", key: "vix", unit: "level" },
  { symbol: "^TNX", label: "US 10Y", short: "US10Y", key: "us10y", unit: "yield" },
  { symbol: "DX-Y.NYB", label: "Dollar (DXY)", short: "DXY", key: "dxy", unit: "level" },
  { symbol: "CL=F", label: "WTI crude", short: "WTI", key: "wti", unit: "level" },
  { symbol: "GC=F", label: "Gold", short: "GOLD", key: "gold", unit: "level" },
  { symbol: "^RUT", label: "Russell 2000", short: "RUT", key: "russell", unit: "level" },
] as const;

export type MacroKey = (typeof MACRO_SYMBOLS)[number]["key"];

/** Macro levels, keyed. A missing key means the fetch failed — never zero. */
export type MacroSnapshot = Partial<Record<MacroKey, LevelRow>>;

export interface AnalysisInput {
  indices: LevelRow[];
  macro: MacroSnapshot;
  bullish: ScoredQuote[];
  /** The raw screener rows, which carry earnings timestamps and 52-week
   *  distances that the rendered board rows drop. */
  gainerQuotes: ScreenerQuote[];
  advancers: number | null;
  decliners: number | null;
  now: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function idx(indices: LevelRow[], symbol: string): LevelRow | null {
  return indices.find((i) => i.symbol === symbol) ?? null;
}

function signed(n: number, dp = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Median, so one 40x volume outlier does not describe the whole board. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** How long after a confirmed earnings timestamp a move may still be called
 *  post-earnings. Two sessions: a company reporting after Wednesday's close is
 *  still the story on Thursday. */
export const EARNINGS_LOOKBACK_HOURS = 48;

/**
 * Companies on the board with a CONFIRMED earnings timestamp in the window.
 *
 * `isEarningsDateEstimate` is the guard that matters. Yahoo supplies an
 * estimated date for companies that have not announced one; treating it as a
 * report would have the brief state that a company published results it has
 * not published. Estimates are discarded, not down-weighted.
 */
export function recentEarnings(
  quotes: ScreenerQuote[],
  now: number,
  lookbackHours = EARNINGS_LOOKBACK_HOURS
): Array<{ symbol: string; changePercent: number | null; hoursAgo: number }> {
  const out: Array<{ symbol: string; changePercent: number | null; hoursAgo: number }> = [];
  for (const q of quotes) {
    if (q.isEarningsDateEstimate === true) continue;
    const ts = num(q.earningsTimestamp);
    if (ts === null) continue;
    const hoursAgo = (now - ts * 1000) / 3_600_000;
    // Future-dated (a scheduled report) and anything older than the window are
    // both excluded. A negative age is a company that has NOT yet reported.
    if (hoursAgo < 0 || hoursAgo > lookbackHours) continue;
    out.push({
      symbol: q.symbol,
      changePercent: num(q.regularMarketChangePercent),
      hoursAgo,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// VIX regime. Bands are conventional and stated, not derived — so they are
// printed alongside the reading rather than presented as a computed verdict.
// ---------------------------------------------------------------------------

export function vixRegime(level: number): { label: string; note: string } {
  if (level < 15) return { label: "calm", note: "below 15" };
  if (level < 20) return { label: "normal", note: "15-20" };
  if (level < 30) return { label: "elevated", note: "20-30" };
  return { label: "stressed", note: "above 30" };
}

// ---------------------------------------------------------------------------
// The rules.
//
// Each is a pure function of the input and returns zero or one signal. A rule
// whose inputs are missing returns null — it does not emit a hedged sentence
// built on a default, because a default is a number nobody measured.
// ---------------------------------------------------------------------------

type Rule = (i: AnalysisInput) => Signal | null;

/** The session's direction and size, from the S&P. */
const sessionDirection: Rule = (i) => {
  const sp = idx(i.indices, "^GSPC");
  const pct = sp?.changePercent ?? null;
  if (sp === null || pct === null) return null;
  const magnitude = Math.abs(pct) >= 1 ? "sharply " : Math.abs(pct) < 0.15 ? "narrowly " : "";
  const dir = pct > 0 ? "higher" : pct < 0 ? "lower" : "flat";
  return {
    id: "session_direction",
    kind: "measured",
    weight: 100,
    text: `The S&P 500 closed ${magnitude}${dir} at ${sp.price.toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })}, ${signed(pct)}.`,
    evidence: [`^GSPC ${sp.price.toFixed(2)} (${signed(pct)})`],
  };
};

/**
 * Leadership, from the spread between the three indices.
 *
 * This is arithmetic on three numbers, not a claim about sectors. The Nasdaq is
 * technology-weighted and the Dow is not; when they diverge, that weighting
 * difference is the measurable content, and the sentence says exactly that.
 */
const leadershipSpread: Rule = (i) => {
  const ndx = idx(i.indices, "^IXIC")?.changePercent ?? null;
  const dow = idx(i.indices, "^DJI")?.changePercent ?? null;
  if (ndx === null || dow === null) return null;
  const spread = ndx - dow;
  if (Math.abs(spread) < 0.4) {
    return {
      id: "leadership_uniform",
      kind: "measured",
      weight: 80,
      text: `Gains were evenly distributed: the Nasdaq (${signed(ndx)}) and Dow (${signed(
        dow
      )}) finished within ${Math.abs(spread).toFixed(2)} points of each other.`,
      evidence: [`^IXIC ${signed(ndx)}`, `^DJI ${signed(dow)}`, `spread ${spread.toFixed(2)}pp`],
    };
  }
  const growthLed = spread > 0;
  return {
    id: growthLed ? "leadership_growth" : "leadership_value",
    kind: "measured",
    weight: 85,
    text: growthLed
      ? `The move scaled with technology weighting: the Nasdaq (${signed(
          ndx
        )}) outpaced the Dow (${signed(dow)}) by ${spread.toFixed(2)} points.`
      : `The move ran against technology weighting: the Dow (${signed(
          dow
        )}) outpaced the Nasdaq (${signed(ndx)}) by ${Math.abs(spread).toFixed(2)} points.`,
    evidence: [`^IXIC ${signed(ndx)}`, `^DJI ${signed(dow)}`, `spread ${spread.toFixed(2)}pp`],
  };
};

/** Small caps against large, when the Russell answered. */
const smallCaps: Rule = (i) => {
  const rut = i.macro.russell?.changePercent ?? null;
  const sp = idx(i.indices, "^GSPC")?.changePercent ?? null;
  if (rut === null || sp === null) return null;
  const gap = rut - sp;
  if (Math.abs(gap) < 0.3) return null;
  return {
    id: "small_caps",
    kind: "measured",
    weight: 55,
    text:
      gap > 0
        ? `Small caps led: the Russell 2000 (${signed(rut)}) beat the S&P 500 (${signed(sp)}).`
        : `Small caps lagged: the Russell 2000 (${signed(rut)}) trailed the S&P 500 (${signed(sp)}).`,
    evidence: [`^RUT ${signed(rut)}`, `^GSPC ${signed(sp)}`],
  };
};

/**
 * Breadth against the index.
 *
 * The valuable case is the DIVERGENCE: an index that closed up on a day when
 * more names fell than rose is a narrow advance, and that is invisible in the
 * headline number. Note the counts are the screens' own populations (moves
 * beyond a threshold), not a full advance/decline line — the sentence says so.
 */
const breadthCheck: Rule = (i) => {
  const { advancers, decliners } = i;
  const sp = idx(i.indices, "^GSPC")?.changePercent ?? null;
  if (advancers === null || decliners === null || sp === null) return null;
  const total = advancers + decliners;
  if (total === 0) return null;
  const share = (advancers / total) * 100;

  const indexUp = sp > 0;
  const breadthUp = advancers > decliners;

  if (indexUp !== breadthUp) {
    return {
      id: "breadth_divergence",
      kind: "context",
      weight: 90,
      text: indexUp
        ? `The advance was narrow: ${decliners} names fell more than 2.5% against ${advancers} that rose more than 3%, even as the index closed up.`
        : `The decline was narrow: ${advancers} names rose more than 3% against ${decliners} that fell more than 2.5%, even as the index closed down.`,
      evidence: [
        `${advancers} up >3%`,
        `${decliners} down >2.5%`,
        `^GSPC ${signed(sp)}`,
        "counts are Yahoo screen populations, not a full advance/decline line",
      ],
    };
  }

  return {
    id: "breadth_confirms",
    kind: "context",
    weight: 60,
    text: `Breadth backed the move: ${advancers} names rose more than 3% against ${decliners} down more than 2.5% (${share.toFixed(
      0
    )}% of large movers advancing).`,
    evidence: [`${advancers} up >3%`, `${decliners} down >2.5%`, `${share.toFixed(1)}% advancing`],
  };
};

/**
 * Earnings catalyst — the strongest finding this engine can make, because it is
 * the one case where the reason for a move is itself a published fact.
 */
const earningsCatalyst: Rule = (i) => {
  const leaders = i.gainerQuotes.slice(0, 5);
  if (leaders.length === 0) return null;
  const reported = recentEarnings(leaders, i.now);
  if (reported.length < 2) return null;

  const names = reported
    .slice(0, 4)
    .map((r) => `${r.symbol}${r.changePercent === null ? "" : ` ${signed(r.changePercent)}`}`)
    .join(", ");
  const oldest = Math.max(...reported.map((r) => r.hoursAgo));

  return {
    id: "earnings_catalyst",
    kind: "context",
    weight: 95,
    text: `${reported.length} of the day's ${leaders.length} largest gainers reported earnings within the last ${Math.ceil(
      oldest
    )} hours: ${names}.`,
    evidence: [
      ...reported.map((r) => `${r.symbol} reported ${r.hoursAgo.toFixed(1)}h ago (confirmed date)`),
      "estimated earnings dates are excluded",
    ],
  };
};

/** Volatility level and direction. */
const volatility: Rule = (i) => {
  const vix = i.macro.vix;
  const level = vix?.price ?? null;
  if (vix === undefined || level === null) return null;
  const regime = vixRegime(level);
  const chg = vix.changePercent;
  const move =
    chg === null
      ? ""
      : chg < 0
        ? `, down ${Math.abs(chg).toFixed(1)}%`
        : `, up ${chg.toFixed(1)}%`;
  return {
    id: "volatility",
    kind: "measured",
    weight: 70,
    text: `Volatility sat in ${regime.label} territory: VIX ${level.toFixed(2)}${move} (${regime.note}).`,
    evidence: [`^VIX ${level.toFixed(2)}${chg === null ? "" : ` (${signed(chg, 1)})`}`],
  };
};

/**
 * Rates and equities, as CO-MOVEMENT.
 *
 * The wording is load-bearing. "Equities rose as yields fell" states two
 * measured facts and their ordering in one sentence. "Equities rose BECAUSE
 * yields fell" is a claim about mechanism that this data cannot support, and it
 * is not a sentence this file can emit.
 */
const ratesCoMovement: Rule = (i) => {
  const tnx = i.macro.us10y;
  const yieldPct = tnx?.price ?? null;
  const yieldChg = tnx?.changePercent ?? null;
  const sp = idx(i.indices, "^GSPC")?.changePercent ?? null;
  if (tnx === undefined || yieldPct === null || yieldChg === null || sp === null) return null;
  if (Math.abs(yieldChg) < 0.3) return null;

  const yDir = yieldChg < 0 ? "fell" : "rose";
  const eDir = sp > 0 ? "rose" : "fell";
  return {
    id: "rates_comovement",
    kind: "relationship",
    weight: 75,
    text: `Equities ${eDir} while the US 10-year yield ${yDir} to ${yieldPct.toFixed(
      3
    )}% (${signed(yieldChg, 2)} on the day).`,
    evidence: [`^TNX ${yieldPct.toFixed(3)}% (${signed(yieldChg, 2)})`, `^GSPC ${signed(sp)}`],
  };
};

/** Commodities and the dollar, when they moved enough to be worth a line. */
const commodities: Rule = (i) => {
  const parts: string[] = [];
  const evidence: string[] = [];
  const wti = i.macro.wti;
  const gold = i.macro.gold;
  const dxy = i.macro.dxy;

  if (wti?.changePercent != null && Math.abs(wti.changePercent) >= 1) {
    parts.push(`WTI crude ${signed(wti.changePercent)} to $${wti.price.toFixed(2)}`);
    evidence.push(`CL=F $${wti.price.toFixed(2)} (${signed(wti.changePercent)})`);
  }
  if (gold?.changePercent != null && Math.abs(gold.changePercent) >= 1) {
    parts.push(`gold ${signed(gold.changePercent)} to $${gold.price.toFixed(2)}`);
    evidence.push(`GC=F $${gold.price.toFixed(2)} (${signed(gold.changePercent)})`);
  }
  if (dxy?.changePercent != null && Math.abs(dxy.changePercent) >= 0.4) {
    parts.push(`the dollar index ${signed(dxy.changePercent)}`);
    evidence.push(`DXY ${dxy.price.toFixed(2)} (${signed(dxy.changePercent)})`);
  }
  if (parts.length === 0) return null;

  return {
    id: "commodities",
    kind: "measured",
    weight: 45,
    text: `Elsewhere: ${parts.join(", ")}.`,
    evidence,
  };
};

/**
 * Whether the leaders moved on real participation.
 *
 * Median relative volume across the bullish board. A board of double-digit
 * gainers on ordinary volume is a materially different day from the same board
 * on triple volume, and the headline percentages look identical.
 */
const participation: Rule = (i) => {
  const rels = i.bullish
    .map((b) => b.components.participation.raw)
    .filter((r): r is number => r !== null);
  if (rels.length < 3) return null;
  // `raw` is (rel - 1) / 2 clamped to 0..1 — recover the multiple for display.
  const multiples = i.bullish
    .map((b) => {
      const detail = b.components.participation.detail;
      const m = detail?.match(/^([\d.]+)x/);
      return m ? Number(m[1]) : null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const med = median(multiples);
  if (med === null) return null;

  const strong = med >= 2;
  return {
    id: "participation",
    kind: "context",
    weight: 65,
    text: strong
      ? `The leaders traded on real participation: median volume across the top board was ${med.toFixed(
          1
        )}x its own three-month average.`
      : `Participation was ordinary: median volume across the top board was ${med.toFixed(
          1
        )}x its own three-month average.`,
    evidence: multiples.map((m, n) => `${i.bullish[n]?.symbol ?? "?"} ${m.toFixed(1)}x`),
  };
};

/**
 * How many advancers are pressed against their 52-week high.
 *
 * THE COUNT AND THE NAMED POPULATION MUST AGREE. An earlier version counted
 * across every candidate fetched (40) while calling them "the day's top
 * gainers" (5), which reads as an impossible number and is the exact species of
 * plausible-but-wrong sentence this engine exists to prevent. The denominator is
 * now stated.
 */
const newHighs: Rule = (i) => {
  const measured = i.gainerQuotes.filter(
    (q) => num(q.fiftyTwoWeekHighChangePercent) !== null
  );
  if (measured.length === 0) return null;
  const atHigh = measured.filter((q) => (num(q.fiftyTwoWeekHighChangePercent) as number) >= -0.5);
  if (atHigh.length === 0) return null;
  return {
    id: "new_highs",
    kind: "measured",
    weight: 50,
    text: `${atHigh.length} of the ${measured.length} names on the day-gainers screen finished within half a percent of a 52-week high, among them ${atHigh
      .slice(0, 5)
      .map((q) => q.symbol)
      .join(", ")}.`,
    evidence: atHigh
      .slice(0, 6)
      .map(
        (q) =>
          `${q.symbol} ${Math.abs(num(q.fiftyTwoWeekHighChangePercent) ?? 0).toFixed(2)}% from high`
      ),
  };
};

/**
 * Risk appetite, as an explicit tally of its inputs.
 *
 * Not a black box: the score is a count of how many of four measured series
 * pointed the same way, and every one of them is printed. A reader who
 * disagrees with the weighting can see exactly what went into it.
 */
const riskAppetite: Rule = (i) => {
  const sp = idx(i.indices, "^GSPC")?.changePercent ?? null;
  const vix = i.macro.vix?.changePercent ?? null;
  const gold = i.macro.gold?.changePercent ?? null;
  const rut = i.macro.russell?.changePercent ?? null;

  // A DEADBAND, because a 0.08% move is noise and scoring it as a direction
  // makes the tally look decisive on a day nothing happened. Series inside the
  // band are dropped from BOTH sides, which shrinks the denominator — the
  // sentence prints that denominator, so the reader sees how many actually
  // counted.
  const FLAT_BAND_PCT = 0.1;
  const inputs: Array<{ name: string; riskOn: boolean; detail: string }> = [];
  const consider = (name: string, value: number | null, riskOnWhen: "up" | "down", dp = 2) => {
    if (value === null || Math.abs(value) < FLAT_BAND_PCT) return;
    inputs.push({
      name,
      riskOn: riskOnWhen === "up" ? value > 0 : value < 0,
      detail: signed(value, dp),
    });
  };
  consider("S&P 500", sp, "up");
  consider("VIX", vix, "down", 1);
  consider("gold", gold, "down");
  consider("Russell 2000", rut, "up");

  // Fewer than three moving inputs is not a regime call, it is a guess.
  if (inputs.length < 3) return null;
  const on = inputs.filter((x) => x.riskOn).length;
  const ratio = on / inputs.length;
  const label = ratio >= 0.75 ? "risk-on" : ratio <= 0.25 ? "risk-off" : "mixed";

  return {
    id: "risk_appetite",
    kind: "relationship",
    weight: 88,
    text: `Cross-asset signals read ${label}: ${on} of ${inputs.length} series that moved more than ${FLAT_BAND_PCT}% pointed that way.`,
    evidence: inputs.map((x) => `${x.name} ${x.detail}${x.riskOn ? " (risk-on)" : " (risk-off)"}`),
  };
};

const RULES: Rule[] = [
  sessionDirection,
  earningsCatalyst,
  breadthCheck,
  riskAppetite,
  leadershipSpread,
  ratesCoMovement,
  volatility,
  participation,
  smallCaps,
  newHighs,
  commodities,
];

/**
 * Run every rule and return the findings, strongest first.
 *
 * The order is total: weight descending, then rule id ascending, so the same
 * inputs always produce the same narrative in the same order. A brief whose
 * sentences shuffle between runs on identical data looks like it is thinking.
 */
export function analyze(input: AnalysisInput): Signal[] {
  const signals: Signal[] = [];
  for (const rule of RULES) {
    let s: Signal | null = null;
    try {
      s = rule(input);
    } catch {
      // A rule that throws is a bug in that rule, not a reason to lose the
      // other ten findings and the whole post with them.
      s = null;
    }
    if (s) signals.push(s);
  }
  return signals.sort((a, b) => (b.weight - a.weight) || a.id.localeCompare(b.id));
}

/**
 * Compose the narrative paragraph.
 *
 * Sentences are concatenated verbatim — there is no rewriting layer, because a
 * rewriting layer is exactly where an unsupported claim would get introduced.
 */
export function narrate(signals: Signal[], maxSentences = 5): string {
  return signals
    .slice(0, maxSentences)
    .map((s) => s.text)
    .join(" ");
}
