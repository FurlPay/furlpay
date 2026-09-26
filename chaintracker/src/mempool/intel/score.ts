// The scoring engine.
//
// A score nobody can decompose is a number nobody should act on, so every
// component returns its own points and its own one-line justification, and the
// total is exactly their sum. The embed prints the breakdown, not just the
// total.
//
// Two design rules that came out of looking at real transactions:
//
// 1. SCORE INTEREST, NOT SIZE. The old digest ranked by BTC and the top three
//    were all consolidations — a wallet tidying its own coins, three times.
//    Size is one component here and worth at most 26 of 100.
//
// 2. AN ABSENT MEASUREMENT SCORES ZERO, NEVER AVERAGE. If coin age could not
//    be resolved, dormancy contributes nothing and says so. Substituting a
//    default would invent a finding, and the score is meant to be evidence.
//
// Calibrated against the Liquid Network peg-out of 2026-09-06 (kept as a
// fixture): 4,019 BTC, 83 inputs into 13 outputs, all from one address, paying
// 34,097 sats — 1.02 sat/vB — to move $317M. That transaction should sit at
// the top of any ranking this engine produces, and a test asserts it does.

import type { TxFeatures } from "./features.js";
import { ageCoverage } from "./features.js";
import type { Classification } from "./classify.js";
import { robustZ, squash, type Baseline } from "./stats.js";

export const MODEL_VERSION = "btc-intel-1";

export type Severity = "INFO" | "WATCH" | "ALERT" | "HIGH" | "CRITICAL";

export interface Contribution {
  key: string;
  label: string;
  /** Points added to the total. Always >= 0; the sum is the score. */
  points: number;
  /** Why these points, with the measurement that produced them. */
  detail: string;
}

export interface Scored {
  txid: string;
  /** 0..100, normalised over the weight that could actually be evaluated. */
  score: number;
  severity: Severity;
  contributions: Contribution[];
  /** The two or three lines worth printing under "why it matters". */
  reasons: string[];
  /** Raw points before normalisation — the sum of `contributions`. */
  rawPoints: number;
  /**
   * Share of the total weight that was evaluable, 0..1.
   *
   * The distinction this encodes is between "measured, and found nothing"
   * and "could not measure". A transaction that drains no reserve genuinely
   * is less interesting, so that zero belongs in the denominator. A
   * transaction whose input ages could not be resolved is not thereby less
   * interesting — we simply do not know — so that weight is removed from the
   * denominator instead of being scored as zero. Without this a whale whose
   * coin age failed to resolve is silently ranked below an identical one
   * whose lookup happened to succeed.
   */
  coverage: number;
  model: string;
}

/** Population context. Any of these may be absent on a cold start. */
export interface ScoreContext {
  valueBaseline?: Baseline | null;
  feeRateBaseline?: Baseline | null;
  /** Sorted recent values, for a percentile the reader can act on. */
  recentValuesSats?: readonly number[];
  /** Balance drained from a watched reserve, when this spends one. */
  reserve?: { label: string; fractionOfBalance: number; balanceBefore: number } | null;
  /** An address on the transaction matched a sanctions or exploit list. */
  flagged?: { list: string; address: string } | null;
  /** Entity label, where one is genuinely known. */
  entity?: { name: string; category: string | null; side: "input" | "output" } | null;
}

/** Maximum points each component can contribute. They sum to 100. */
export const WEIGHTS = {
  amount: 26,
  dormancy: 16,
  feeAnomaly: 14,
  structure: 12,
  reserveDrain: 18,
  flagged: 10,
  entropy: 4,
} as const;

export function scoreTx(
  f: TxFeatures,
  cls: Classification,
  ctx: ScoreContext = {},
): Scored {
  const c: Contribution[] = [];
  const reasons: string[] = [];
  const btc = f.valueSats / 1e8;

  /* ---------- amount ---------- */
  // Measured against the live population rather than a constant, so "large"
  // means large for this chain today.
  {
    const z = ctx.valueBaseline ? robustZ(f.valueSats, ctx.valueBaseline) : null;
    const pctile = percentileOfSorted(f.valueSats, ctx.recentValuesSats);

    // Percentile alone is useless at the top of this distribution. The median
    // Bitcoin transaction moves a few thousandths of a coin, so ANY whale sits
    // at the 100th percentile and a 99 BTC transfer scores identically to the
    // 4,019 BTC Liquid drain. Magnitude has to carry most of the weight, with
    // the population term only confirming that this is unusual *here*.
    const populationTerm = z !== null ? squash(z, 4) : 0;
    const magnitudeTerm = clamp01((Math.log10(Math.max(1, btc)) - 1) / 2.5); // 10 BTC → 0, ~3162 BTC → 1
    const frac = z !== null ? 0.4 * populationTerm + 0.6 * magnitudeTerm : magnitudeTerm;
    const points = round1(WEIGHTS.amount * frac);
    if (points > 0) {
      c.push({
        key: "amount",
        label: "Amount",
        points,
        detail:
          pctile !== null
            ? `${fmtBtc(btc)} — ${pctile.toFixed(1)}th percentile of recent transactions`
            : `${fmtBtc(btc)}`,
      });
      if (pctile !== null && pctile >= 99) reasons.push(`${pctile.toFixed(1)}th percentile transaction size`);
      else if (btc >= 500) reasons.push(`${fmtBtc(btc)} moved in a single transaction`);
    }
  }

  /* ---------- dormancy ---------- */
  {
    const cov = ageCoverage(f);
    if (f.meanAgeDays === null || cov < 0.5) {
      c.push({
        key: "dormancy",
        label: "Coin age",
        points: 0,
        detail:
          f.inputsAged === 0
            ? "not measured — no input ages resolved"
            : `not scored — only ${f.inputsAged}/${f.nIn} input ages resolved`,
      });
    } else {
      const years = f.meanAgeDays / 365;
      // Nothing below a year counts. Coins that moved last month moving again
      // is the base rate, not a finding.
      const frac = clamp01((years - 1) / 6);
      const points = round1(WEIGHTS.dormancy * frac);
      c.push({
        key: "dormancy",
        label: "Coin age",
        points,
        detail:
          `${fmtAge(f.meanAgeDays)} value-weighted mean` +
          (f.dormantFrac !== null ? `, ${Math.round(f.dormantFrac * 100)}% dormant over a year` : "") +
          (cov < 1 ? ` (${f.inputsAged}/${f.nIn} inputs aged)` : ""),
      });
      if (years >= 2) {
        reasons.push(
          `coins averaging ${fmtAge(f.meanAgeDays)} old moved after sitting still`,
        );
      }
    }
  }

  /* ---------- fee anomaly ---------- */
  // The Liquid signal. A very large transfer paying the floor rate is not
  // normal behaviour: fee is chosen by whoever built the transaction, and
  // choosing the minimum to move a fortune says something about the process
  // that built it.
  {
    const z = ctx.feeRateBaseline && f.feeRate !== null ? robustZ(f.feeRate, ctx.feeRateBaseline) : null;
    let points = 0;
    let detail = f.feeRate === null ? "fee rate unknown" : `${f.feeRate.toFixed(2)} sat/vB`;

    if (f.feeRate !== null && f.valuePerFeeSat !== null && btc >= 100) {
      // Value-to-fee ratio, in orders of magnitude. Liquid's was 1.18e7.
      const mag = Math.log10(f.valuePerFeeSat);
      const frac = clamp01((mag - 5) / 3);
      points = round1(WEIGHTS.feeAnomaly * frac);
      detail =
        `${f.feeRate.toFixed(2)} sat/vB to move ${fmtBtc(btc)} — ` +
        `${fmtRatio(f.valuePerFeeSat)} of value per satoshi of fee`;
      if (frac > 0.5) {
        reasons.push(
          `paid only ${f.feeRate.toFixed(2)} sat/vB to move ${fmtBtc(btc)}`,
        );
      }
    } else if (z !== null && z > 0) {
      points = round1(WEIGHTS.feeAnomaly * squash(z, 4) * 0.5);
      detail = `${f.feeRate!.toFixed(2)} sat/vB, ${z.toFixed(1)}σ above the recent median`;
    }
    c.push({ key: "fee", label: "Fee anomaly", points, detail });
  }

  /* ---------- structure ---------- */
  {
    const fanIn = f.nIn / Math.max(1, f.nOut);
    const fanOut = f.nOut / Math.max(1, f.nIn);
    const extremity = Math.max(fanIn, fanOut);

    // Ratio AND absolute size, because they say different things. Ratio alone
    // scored the Liquid drain at a third of the available points: 83-into-13
    // is only a 6.4-to-1 fan-in, which is unremarkable as a ratio. Gathering
    // 83 separate UTXOs into one transaction is remarkable regardless of how
    // many outputs it produced, so the count is scored in its own right.
    const ratioFrac = clamp01((Math.log2(Math.max(1, extremity)) - 1) / 5);
    const countFrac = clamp01((Math.log2(Math.max(1, Math.max(f.nIn, f.nOut))) - 2) / 6);
    const frac = clamp01(0.5 * ratioFrac + 0.5 * countFrac);
    const points = round1(WEIGHTS.structure * frac);
    c.push({
      key: "structure",
      label: "Structure",
      points,
      detail: `${f.nIn} in → ${f.nOut} out · ${shapeOf(cls)} (${Math.round(cls.confidence * 100)}% confidence)`,
    });
    if (f.nIn >= 25) reasons.push(`${f.nIn} inputs gathered into ${f.nOut} outputs`);
  }

  /* ---------- reserve drain ---------- */
  // The highest-value detector in the system, and the one that would have
  // fired during the Liquid incident. A watched reserve losing most of its
  // balance is not an anomaly to be weighed against others — it is the event.
  if (ctx.reserve) {
    const frac = clamp01(ctx.reserve.fractionOfBalance);
    const points = round1(WEIGHTS.reserveDrain * frac);
    c.push({
      key: "reserve",
      label: "Reserve drain",
      points,
      detail:
        `${Math.round(frac * 100)}% of ${ctx.reserve.label}'s tracked balance ` +
        `(${fmtBtc(ctx.reserve.balanceBefore / 1e8)}) left in this transaction`,
    });
    reasons.push(
      `drains ${Math.round(frac * 100)}% of ${ctx.reserve.label}'s tracked balance`,
    );
  }

  /* ---------- flagged address ---------- */
  if (ctx.flagged) {
    c.push({
      key: "flagged",
      label: "Flagged address",
      points: WEIGHTS.flagged,
      detail: `an address on this transaction appears on ${ctx.flagged.list}`,
    });
    reasons.push(`touches an address listed on ${ctx.flagged.list}`);
  }

  /* ---------- output entropy ---------- */
  {
    const e = f.outEntropy;
    if (e !== null && f.nOut >= 10) {
      const points = round1(WEIGHTS.entropy * clamp01(e));
      c.push({
        key: "entropy",
        label: "Output spread",
        points,
        detail: `${f.nOut} outputs, evenness ${(e * 100).toFixed(0)}%`,
      });
    }
  }

  const rawPoints = round1(c.reduce((s, x) => s + x.points, 0));

  // Weight that could not be evaluated is removed from the denominator rather
  // than counted as zero. Today that is coin age, which needs one lookup per
  // funding transaction and is skipped when the budget or the host says no.
  const unmeasurable = unmeasuredWeight(f, c);
  const denominator = Math.max(1, 100 - unmeasurable);
  const score = round1(Math.min(100, (rawPoints / denominator) * 100));

  return {
    txid: f.txid,
    score,
    severity: severityFor(score, ctx),
    contributions: c.sort((a, b) => b.points - a.points),
    reasons: reasons.slice(0, 4),
    rawPoints,
    coverage: denominator / 100,
    model: MODEL_VERSION,
  };
}

/** Weight belonging to components that could not be evaluated at all. */
function unmeasuredWeight(f: TxFeatures, c: Contribution[]): number {
  let w = 0;
  const dormancy = c.find((x) => x.key === "dormancy");
  if (dormancy && /not measured|not scored/.test(dormancy.detail)) w += WEIGHTS.dormancy;
  // Output spread is only meaningful with enough outputs to spread across; on
  // a two-output payment it is not a finding of "no spread", it is undefined.
  if (f.nOut < 10) w += WEIGHTS.entropy;
  return w;
}

/**
 * Severity from score, with two overrides that outrank it.
 *
 * A sanctioned or exploit-listed address, and a majority drain of a watched
 * reserve, are categorical findings — they do not become less serious because
 * the transaction was otherwise unremarkable, so they set a floor rather than
 * adding points and hoping the total clears a threshold.
 */
export function severityFor(score: number, ctx: ScoreContext = {}): Severity {
  if (ctx.flagged) return "CRITICAL";
  if (ctx.reserve && ctx.reserve.fractionOfBalance >= 0.5) return "CRITICAL";
  if (ctx.reserve && ctx.reserve.fractionOfBalance >= 0.2) return "HIGH";
  if (score >= 75) return "HIGH";
  if (score >= 55) return "ALERT";
  if (score >= 35) return "WATCH";
  return "INFO";
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function percentileOfSorted(x: number, sorted?: readonly number[]): number | null {
  if (!sorted || !sorted.length) return null;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round1 = (x: number): number => Math.round(x * 10) / 10;
const shapeOf = (c: Classification): string => c.shape;

function fmtBtc(btc: number): string {
  return `${btc.toLocaleString("en-US", {
    minimumFractionDigits: btc >= 1000 ? 0 : 2,
    maximumFractionDigits: btc >= 1000 ? 0 : 2,
  })} BTC`;
}

function fmtAge(days: number): string {
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function fmtRatio(r: number): string {
  if (r >= 1e6) return `${(r / 1e6).toFixed(1)}M sats`;
  if (r >= 1e3) return `${(r / 1e3).toFixed(1)}K sats`;
  return `${r.toFixed(0)} sats`;
}
