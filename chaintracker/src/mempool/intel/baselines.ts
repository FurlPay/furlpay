// Live baselines: what "unusual" means on this chain today.
//
// Nothing in this file is a constant. Every threshold the scorer compares
// against is computed from transactions this bot actually observed, which is
// the difference between "large for Bitcoin" and "large according to a number
// somebody typed in 2026".
//
// THE SAMPLING RULE THAT MATTERS: samples come from EVERY transaction in a
// walked block, not from the whales. Measured on block 966016 — 4,552
// transactions, of which 28 were at or above 50 BTC. A median computed over
// those 28 lands near 80 BTC, so every whale scores as unremarkable against
// its own kind and the statistic inverts its own purpose. The population has
// to be the whole block.
//
// The sample is bounded and rolling, so the baseline tracks the chain rather
// than averaging over all history.

import { getDb } from "../../db/index.js";
import { buildBaseline, type Baseline } from "./stats.js";
import { makeLogger } from "../../util/logger.js";

const log = makeLogger("btc-baselines");

/** Metrics kept. Adding one costs nothing but a name. */
export const METRICS = ["value", "feeRate", "nIn", "nOut"] as const;
export type Metric = (typeof METRICS)[number];

/** Rows kept per metric. ~2 blocks of transactions, capped for query cost. */
export const SAMPLE_CAP = 12_000;

/** Minimum sample before a baseline is published at all. */
export const MIN_SAMPLES = 500;

/**
 * Record observations from one walked block.
 *
 * Written in a single transaction: 4,552 individual inserts through autocommit
 * takes seconds on SQLite and the block walk is already the slow part.
 */
export function recordSamples(rows: Array<{ metric: Metric; value: number }>): number {
  if (!rows.length) return 0;
  const db = getDb();
  const ts = Date.now();
  const stmt = db.prepare("INSERT INTO btc_samples (metric,value,ts) VALUES (?,?,?)");
  db.exec("BEGIN");
  try {
    let n = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.value)) continue;
      stmt.run(r.metric, r.value, ts);
      n += 1;
    }
    db.exec("COMMIT");
    return n;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Drop everything but the newest SAMPLE_CAP rows per metric. */
export function pruneSamples(cap = SAMPLE_CAP): number {
  const db = getDb();
  let removed = 0;
  for (const metric of METRICS) {
    const r = db
      .prepare(
        `DELETE FROM btc_samples WHERE metric = ? AND id NOT IN (
           SELECT id FROM btc_samples WHERE metric = ? ORDER BY id DESC LIMIT ?
         )`,
      )
      .run(metric, metric, cap);
    removed += Number(r.changes);
  }
  return removed;
}

/** The current sample for a metric, newest first. */
export function sampleOf(metric: Metric, limit = SAMPLE_CAP): number[] {
  return (
    getDb()
      .prepare("SELECT value FROM btc_samples WHERE metric = ? ORDER BY id DESC LIMIT ?")
      .all(metric, limit) as Array<{ value: number }>
  ).map((r) => r.value);
}

/**
 * Recompute and persist every baseline.
 *
 * Returns null for a metric whose sample is still too small. A caller that
 * receives null must score without that component rather than substituting a
 * default — see the coverage handling in score.ts.
 */
export function refreshBaselines(): Record<Metric, Baseline | null> {
  const out = {} as Record<Metric, Baseline | null>;
  const db = getDb();
  for (const metric of METRICS) {
    const xs = sampleOf(metric);
    const b = buildBaseline(metric, xs, MIN_SAMPLES);
    out[metric] = b;
    if (!b) continue;
    db.prepare(
      `INSERT INTO btc_baselines (metric,median,mad,p95,p99,samples,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(metric) DO UPDATE SET
         median=excluded.median, mad=excluded.mad, p95=excluded.p95,
         p99=excluded.p99, samples=excluded.samples, updated_at=excluded.updated_at`,
    ).run(b.metric, b.median, b.mad, b.p95, b.p99, b.samples, b.updatedAt);
  }
  const ready = METRICS.filter((m) => out[m]).length;
  log.info("baselines refreshed", {
    ready: `${ready}/${METRICS.length}`,
    valueMedianBtc: out.value ? (out.value.median / 1e8).toFixed(6) : "not yet",
    valueSamples: out.value?.samples ?? sampleOf("value", 1).length,
  });
  return out;
}

/** Load persisted baselines without recomputing. */
export function loadBaselines(): Record<Metric, Baseline | null> {
  const out = {} as Record<Metric, Baseline | null>;
  const rows = getDb().prepare("SELECT * FROM btc_baselines").all() as Array<Record<string, unknown>>;
  const byMetric = new Map(rows.map((r) => [r.metric as string, r]));
  for (const metric of METRICS) {
    const r = byMetric.get(metric);
    out[metric] = r
      ? {
          metric,
          median: r.median as number,
          mad: r.mad as number,
          p95: (r.p95 as number) ?? null,
          p99: (r.p99 as number) ?? null,
          samples: r.samples as number,
          updatedAt: r.updated_at as number,
        }
      : null;
  }
  return out;
}

/**
 * Recent transaction values, ascending — the array percentiles are read from.
 *
 * Sorted here rather than in the scorer because the scorer runs once per
 * transaction and this runs once per tick.
 */
export function sortedValues(): number[] {
  return sampleOf("value").sort((a, b) => a - b);
}

/** How ready the statistical layer is, for the board's health line. */
export function baselineStatus(): { metric: Metric; samples: number; ready: boolean }[] {
  const db = getDb();
  return METRICS.map((metric) => {
    const r = db
      .prepare("SELECT COUNT(*) n FROM btc_samples WHERE metric = ?")
      .get(metric) as { n: number };
    return { metric, samples: r.n, ready: r.n >= MIN_SAMPLES };
  });
}
