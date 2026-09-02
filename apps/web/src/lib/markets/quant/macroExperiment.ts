// ---------------------------------------------------------------------------
// The gold macro experiment: does real-yield, USD and risk information predict
// gold well enough to trade after costs, under strict walk-forward?
//
// Everything here is arranged so the answer can be "no". The benchmark is
// computed on the identical window, the placebo runs the same machinery on
// shuffled factors, and the registry records every model tried rather than the
// best one.
//
// ── INFORMATION TIMESTAMPS ─────────────────────────────────────────────────
//
// Each factor carries an `availableAt` rule. For the daily FRED series used
// here, the observation for date d is published the following business morning,
// so a position taken on date d may use the value observed at d-1. That one-day
// lag is applied in `buildFactorPanel` and is the difference between a real
// experiment and a very profitable fantasy.
//
// Series that are REVISED are not usable at all without vintages, which need an
// API key this deployment does not have. They are excluded and marked
// UNAVAILABLE_FOR_HISTORICAL_TRADING rather than silently included at today's
// vintage.
// ---------------------------------------------------------------------------

import type { Bar } from "./features";
import { zScore } from "./features";

export type Availability = "NEXT_DAY_AFTER_OBSERVATION" | "UNAVAILABLE_FOR_HISTORICAL_TRADING";

export interface FactorSpec {
  key: string;
  label: string;
  source: string;
  seriesId: string;
  availability: Availability;
  /** Why this rule, in one line, so a reviewer can challenge it. */
  availabilityNote: string;
}

/** Factors usable in a historical experiment. */
export const FACTORS: FactorSpec[] = [
  {
    key: "realYield10y", label: "US 10Y real yield (TIPS)", source: "FRED", seriesId: "DFII10",
    availability: "NEXT_DAY_AFTER_OBSERVATION",
    availabilityNote: "Daily constant-maturity series, published the next business morning and not revised.",
  },
  {
    key: "nominal10y", label: "US 10Y nominal yield", source: "FRED", seriesId: "DGS10",
    availability: "NEXT_DAY_AFTER_OBSERVATION",
    availabilityNote: "Daily, published the next business morning and not revised.",
  },
  {
    key: "breakeven10y", label: "10Y breakeven inflation", source: "FRED", seriesId: "T10YIE",
    availability: "NEXT_DAY_AFTER_OBSERVATION",
    availabilityNote: "Daily, derived from traded yields, not revised.",
  },
  {
    key: "broadDollar", label: "Trade-weighted USD (broad)", source: "FRED", seriesId: "DTWEXBGS",
    availability: "NEXT_DAY_AFTER_OBSERVATION",
    availabilityNote: "Daily index, published the next business morning and not revised.",
  },
];

/** Excluded, with the reason recorded rather than the series quietly used. */
export const EXCLUDED_FACTORS: FactorSpec[] = [
  {
    key: "cpi", label: "CPI", source: "FRED", seriesId: "CPIAUCSL",
    availability: "UNAVAILABLE_FOR_HISTORICAL_TRADING",
    availabilityNote: "Monthly and revised. fredgraph serves the current vintage, so historical use would trade on revisions nobody had. Needs ALFRED.",
  },
  {
    key: "corePce", label: "Core PCE", source: "FRED", seriesId: "PCEPILFE",
    availability: "UNAVAILABLE_FOR_HISTORICAL_TRADING",
    availabilityNote: "Monthly and revised. Same reason as CPI.",
  },
  {
    key: "unemployment", label: "Unemployment rate", source: "FRED", seriesId: "UNRATE",
    availability: "UNAVAILABLE_FOR_HISTORICAL_TRADING",
    availabilityNote: "Monthly and revised, and the payroll survey is revised twice. Needs ALFRED.",
  },
];

export interface FactorPanel {
  dates: string[];
  /** Gold close aligned to `dates`. */
  gold: number[];
  /** Feature name -> value per date, already lagged for availability. */
  features: Record<string, (number | null)[]>;
}

export interface RawSeries {
  /** date -> value, observation-dated. */
  points: { date: string; value: number }[];
}

/**
 * Build the aligned, availability-lagged factor panel.
 *
 * The lag is the load-bearing part. For a position taken at the close of date
 * d, the most recent factor observation a participant could have used is the
 * one dated d-1, because d's value is published the following morning. Using
 * d's own observation is a one-day look-ahead that is almost invisible in the
 * code and worth a large fraction of any apparent edge.
 */
export function buildFactorPanel(
  goldBars: readonly Bar[],
  raw: Record<string, RawSeries>,
  crossAsset: Record<string, readonly Bar[]>
): FactorPanel {
  const dates = goldBars.map((b) => b.date);
  const gold = goldBars.map((b) => b.close);
  const features: Record<string, (number | null)[]> = {};

  // FRED levels, forward-filled and lagged one observation.
  for (const [key, series] of Object.entries(raw)) {
    const sorted = [...series.points].sort((a, b) => (a.date < b.date ? -1 : 1));
    const out: (number | null)[] = [];
    let i = 0;
    let prev: number | null = null;
    let curr: number | null = null;
    for (const d of dates) {
      while (i < sorted.length && sorted[i]!.date <= d) {
        prev = curr;
        curr = sorted[i]!.value;
        i++;
      }
      // `prev` is the last observation STRICTLY before the most recent one, so
      // it is the newest value certainly published before this bar's close.
      out.push(prev);
    }
    features[key] = out;
  }

  // Cross-asset closes, aligned by date and lagged one bar for symmetry with
  // the FRED series. These are observable intraday, so the lag is conservative.
  for (const [key, bars] of Object.entries(crossAsset)) {
    const byDate = new Map(bars.map((b) => [b.date, b.close]));
    const raw2 = dates.map((d) => byDate.get(d) ?? null);
    features[key] = raw2.map((_, idx) => (idx === 0 ? null : raw2[idx - 1] ?? null));
  }

  return { dates, gold, features };
}

/** Change over k observations, null where either endpoint is missing. */
export function deltaSeries(values: readonly (number | null)[], k: number): (number | null)[] {
  return values.map((v, i) => {
    if (i < k) return null;
    const prev = values[i - k];
    if (v === null || prev === null || prev === undefined) return null;
    return v - prev;
  });
}

/** Log-return over k observations for a positive price series. */
export function logChangeSeries(values: readonly (number | null)[], k: number): (number | null)[] {
  return values.map((v, i) => {
    if (i < k) return null;
    const prev = values[i - k];
    if (v === null || prev === null || prev === undefined) return null;
    if (!(v > 0) || !(prev > 0)) return null;
    return Math.log(v / prev);
  });
}

/** Rolling z-score of a series, trailing window only. */
export function rollingZ(values: readonly (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < window) { out.push(null); continue; }
    const w: number[] = [];
    let ok = true;
    for (let j = i + 1 - window; j <= i; j++) {
      const v = values[j];
      if (v === null || v === undefined) { ok = false; break; }
      w.push(v);
    }
    out.push(ok ? zScore(w, window) : null);
  }
  return out;
}

/** Forward log return of gold over h bars, aligned so index t holds the return
 *  earned from t to t+h. The last h entries are null by construction. */
export function forwardReturn(gold: readonly number[], h: number): (number | null)[] {
  return gold.map((_, i) => {
    if (i + h >= gold.length) return null;
    const a = gold[i]!, b = gold[i + h]!;
    if (!(a > 0) || !(b > 0)) return null;
    return Math.log(b / a);
  });
}

export interface ExperimentRecord {
  id: string;
  model: string;
  features: string[];
  horizon: number;
  trainWindow: number | null;
  threshold: number | null;
  costBps: number;
  oosSharpe: number | null;
  oosReturn: number;
  maxDrawdown: number | null;
  timeInvested: number | null;
  turnover: number | null;
}

/**
 * Every experiment run, not just the best one.
 *
 * With enough models one of them will look good by chance. The registry makes
 * the count visible, so a Sharpe of 1.8 chosen from 100 attempts is reported as
 * what it is rather than as a discovery.
 */
export class ExperimentRegistry {
  private records: ExperimentRecord[] = [];
  add(r: ExperimentRecord): void { this.records.push(r); }
  all(): ExperimentRecord[] { return [...this.records]; }
  count(): number { return this.records.length; }
  best(): ExperimentRecord | null {
    let b: ExperimentRecord | null = null;
    for (const r of this.records) {
      if (r.oosSharpe === null) continue;
      if (!b || (b.oosSharpe ?? -Infinity) < r.oosSharpe) b = r;
    }
    return b;
  }
}
