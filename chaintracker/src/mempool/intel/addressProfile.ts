// Per-address behavioural history.
//
// This is the module the pattern engine has been waiting on. Without it every
// address-relative detector — dormancy, drain, structure, counterparty novelty
// — falls back to comparing against the whole chain, which answers the wrong
// question. "Is 500 BTC large for Bitcoin?" is nearly always yes and nearly
// always uninteresting. "Is 500 BTC large FOR THIS ADDRESS, and is a five-year
// silence normal for it?" is the question that separates an exchange doing its
// job from a dormant wallet being emptied.
//
// TWO STORES, DELIBERATELY.
//
//   btc_address_profile   durable aggregates: counters, Welford mean, last
//                         spend time, counterparty count. Never pruned, so
//                         dormancy survives a restart and a retention sweep.
//
//   btc_address_spends    a bounded ring of recent spends, because a median
//                         and a MAD need the observations themselves and an
//                         aggregate cannot reconstruct them.
//
// The ring is bounded PER ADDRESS. A global cap would let one exchange
// spending every block evict the entire history of a cold wallet that spends
// twice a year — and the cold wallet is where the signal is.
//
// BASELINE POISONING. An attacker who can write to the baseline can teach it
// that their behaviour is normal. Two things make that expensive here: an
// address's own history only ever softens judgements about that address, so
// poisoning one wallet buys nothing anywhere else; and observations are
// recorded from CONFIRMED blocks only, so priming the baseline costs real fees
// and real confirmations rather than free mempool spam.

import { getDb } from "../../db/index.js";
import { buildBaseline } from "./stats.js";
import type { AddressProfile } from "./patterns.js";
import type { RawTx } from "./features.js";
import { makeLogger } from "../../util/logger.js";

const log = makeLogger("btc-profiles");

/** Spends retained per address. Enough for a stable median, cheap to query. */
export const SPENDS_PER_ADDRESS = 200;

/** Counterparties retained per address before the oldest are dropped. */
export const COUNTERPARTIES_PER_ADDRESS = 500;

/** Below this, a median is noise rather than a baseline. */
export const MIN_OBSERVATIONS = 4;

export interface SpendObservation {
  address: string;
  ts: number;
  valueSats: number;
  /** Share of balance removed, when the balance was readable. */
  drainRatio: number | null;
  nIn: number;
  nOut: number;
  feeRate: number | null;
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

/**
 * Record what a transaction reveals about the addresses it touched.
 *
 * `balanceOf` supplies pre-spend balances so drain ratios can be recorded; it
 * is optional and returning null simply leaves that column null, which the
 * detectors read as "not measured" rather than as zero.
 *
 * Runs in ONE database transaction. A block walk touches thousands of
 * addresses and per-statement autocommit on SQLite makes that the slowest step
 * in the pipeline by a wide margin.
 */
export function observeTransaction(
  tx: RawTx,
  ts: number,
  opts: { balanceOf?: (address: string) => number | null } = {},
): { spenders: number; receivers: number } {
  const db = getDb();

  // Value spent per input address, and received per output address.
  const spent = new Map<string, number>();
  const received = new Map<string, number>();
  for (const i of tx.vin) {
    if (i.is_coinbase) continue;
    const a = i.prevout?.scriptpubkey_address;
    if (!a) continue;
    spent.set(a, (spent.get(a) ?? 0) + (Number(i.prevout?.value) || 0));
  }
  for (const o of tx.vout) {
    const a = o.scriptpubkey_address;
    if (!a) continue;
    received.set(a, (received.get(a) ?? 0) + (Number(o.value) || 0));
  }

  const vsize = Number.isFinite(tx.weight) ? Math.ceil((tx.weight as number) / 4) : null;
  const feeRate = vsize && Number.isFinite(tx.fee) ? (tx.fee as number) / vsize : null;
  const outputAddrs = [...received.keys()];

  db.exec("BEGIN");
  try {
    for (const [address, valueSats] of spent) {
      const prior = db
        .prepare("SELECT last_spend_at, spend_count, spend_mean, spend_m2 FROM btc_address_profile WHERE address = ?")
        .get(address) as
        | { last_spend_at: number | null; spend_count: number; spend_mean: number; spend_m2: number }
        | undefined;

      const gapMs = prior?.last_spend_at ? ts - prior.last_spend_at : null;

      let drainRatio: number | null = null;
      const balanceAfter = opts.balanceOf?.(address);
      if (balanceAfter !== null && balanceAfter !== undefined) {
        // The balance read back is post-spend, so the pre-spend figure is what
        // remains plus what left. Reading it the other way round turns a 95%
        // drain into 2,040% — or divides by ~0 on a total sweep.
        const before = balanceAfter + valueSats;
        if (before > 0) drainRatio = Math.min(1, valueSats / before);
      }

      // Welford, so a mean and variance survive without keeping every point.
      const n = (prior?.spend_count ?? 0) + 1;
      const mean = prior?.spend_mean ?? 0;
      const delta = valueSats - mean;
      const newMean = mean + delta / n;
      const newM2 = (prior?.spend_m2 ?? 0) + delta * (valueSats - newMean);

      db.prepare(
        `INSERT INTO btc_address_profile
           (address,first_seen,last_seen,last_spend_at,spend_count,receive_count,
            total_in_sats,total_out_sats,spend_mean,spend_m2,max_spend_sats,
            mean_n_in,mean_n_out,mean_fee_rate,counterparties,mean_drain_ratio,
            drain_samples,updated_at)
         VALUES (?,?,?,?,1,0,0,?,?,?,?,?,?,?,0,?,?,?)
         ON CONFLICT(address) DO UPDATE SET
           last_seen      = excluded.last_seen,
           last_spend_at  = excluded.last_spend_at,
           spend_count    = btc_address_profile.spend_count + 1,
           total_out_sats = btc_address_profile.total_out_sats + excluded.total_out_sats,
           spend_mean     = ?,
           spend_m2       = ?,
           max_spend_sats = MAX(btc_address_profile.max_spend_sats, excluded.max_spend_sats),
           -- Running means over spend_count observations.
           mean_n_in      = (btc_address_profile.mean_n_in * btc_address_profile.spend_count + excluded.mean_n_in)
                            / (btc_address_profile.spend_count + 1),
           mean_n_out     = (btc_address_profile.mean_n_out * btc_address_profile.spend_count + excluded.mean_n_out)
                            / (btc_address_profile.spend_count + 1),
           mean_fee_rate  = COALESCE(
                              (COALESCE(btc_address_profile.mean_fee_rate, excluded.mean_fee_rate) * btc_address_profile.spend_count
                               + COALESCE(excluded.mean_fee_rate, btc_address_profile.mean_fee_rate))
                              / (btc_address_profile.spend_count + 1),
                              btc_address_profile.mean_fee_rate),
           mean_drain_ratio = CASE WHEN excluded.mean_drain_ratio IS NULL
                                THEN btc_address_profile.mean_drain_ratio
                                ELSE (COALESCE(btc_address_profile.mean_drain_ratio, 0) * btc_address_profile.drain_samples
                                      + excluded.mean_drain_ratio) / (btc_address_profile.drain_samples + 1) END,
           drain_samples  = btc_address_profile.drain_samples
                            + CASE WHEN excluded.mean_drain_ratio IS NULL THEN 0 ELSE 1 END,
           updated_at     = excluded.updated_at`,
      ).run(
        address, ts, ts, ts, valueSats, newMean, newM2, valueSats,
        tx.vin.length, tx.vout.length, feeRate, drainRatio, ts, ts,
        newMean, newM2,
      );

      db.prepare(
        `INSERT INTO btc_address_spends (address,ts,value_sats,drain_ratio,n_in,n_out,fee_rate,gap_ms)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(address, ts, valueSats, drainRatio, tx.vin.length, tx.vout.length, feeRate, gapMs);

      // Counterparties: who this address paid. Only outputs that are not the
      // address itself — change returning home is not a counterparty.
      for (const dest of outputAddrs) {
        if (dest === address) continue;
        db.prepare(
          `INSERT INTO btc_counterparties (address,counterparty,first_seen,last_seen,times)
           VALUES (?,?,?,?,1)
           ON CONFLICT(address,counterparty) DO UPDATE SET
             last_seen = excluded.last_seen, times = times + 1`,
        ).run(address, dest, ts, ts);
      }
    }

    for (const [address, valueSats] of received) {
      db.prepare(
        `INSERT INTO btc_address_profile
           (address,first_seen,last_seen,last_spend_at,spend_count,receive_count,
            total_in_sats,total_out_sats,spend_mean,spend_m2,max_spend_sats,
            mean_n_in,mean_n_out,mean_fee_rate,counterparties,mean_drain_ratio,
            drain_samples,updated_at)
         VALUES (?,?,?,NULL,0,1,?,0,0,0,0,0,0,NULL,0,NULL,0,?)
         ON CONFLICT(address) DO UPDATE SET
           last_seen     = excluded.last_seen,
           receive_count = btc_address_profile.receive_count + 1,
           total_in_sats = btc_address_profile.total_in_sats + excluded.total_in_sats,
           updated_at    = excluded.updated_at`,
      ).run(address, ts, ts, valueSats, ts);
    }

    // Keep the counterparty count on the profile in step with the table.
    for (const address of spent.keys()) {
      db.prepare(
        `UPDATE btc_address_profile SET counterparties =
           (SELECT COUNT(*) FROM btc_counterparties WHERE address = ?) WHERE address = ?`,
      ).run(address, address);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { spenders: spent.size, receivers: received.size };
}

/** Trim the per-address rings. Called after a block, not after a transaction. */
export function pruneProfiles(
  spendsPerAddress = SPENDS_PER_ADDRESS,
  counterpartiesPerAddress = COUNTERPARTIES_PER_ADDRESS,
): { spends: number; counterparties: number } {
  const db = getDb();
  // Only addresses actually over the cap are touched, so this is proportional
  // to the busy tail rather than to the whole table.
  const overSpends = db
    .prepare(
      `SELECT address FROM btc_address_spends GROUP BY address HAVING COUNT(*) > ?`,
    )
    .all(spendsPerAddress) as Array<{ address: string }>;
  let spends = 0;
  for (const { address } of overSpends) {
    spends += Number(
      db.prepare(
        `DELETE FROM btc_address_spends WHERE address = ? AND id NOT IN (
           SELECT id FROM btc_address_spends WHERE address = ? ORDER BY id DESC LIMIT ?
         )`,
      ).run(address, address, spendsPerAddress).changes,
    );
  }

  const overCps = db
    .prepare(`SELECT address FROM btc_counterparties GROUP BY address HAVING COUNT(*) > ?`)
    .all(counterpartiesPerAddress) as Array<{ address: string }>;
  let counterparties = 0;
  for (const { address } of overCps) {
    counterparties += Number(
      db.prepare(
        `DELETE FROM btc_counterparties WHERE address = ? AND counterparty NOT IN (
           SELECT counterparty FROM btc_counterparties WHERE address = ?
           ORDER BY last_seen DESC LIMIT ?
         )`,
      ).run(address, address, counterpartiesPerAddress).changes,
    );
  }
  return { spends, counterparties };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Build the profile the pattern engine consumes.
 *
 * Returns null for an address never observed. Null is the honest answer and
 * the detectors handle it by lowering confidence — an empty profile would be
 * indistinguishable from a genuinely quiet address, which is exactly the
 * unknown-versus-normal confusion this system exists to avoid.
 */
export function profileFor(address: string): AddressProfile | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM btc_address_profile WHERE address = ?")
    .get(address) as Record<string, unknown> | undefined;
  if (!row) return null;

  const spends = db
    .prepare(
      `SELECT value_sats, drain_ratio, n_in, n_out, gap_ms
       FROM btc_address_spends WHERE address = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(address, SPENDS_PER_ADDRESS) as Array<{
    value_sats: number; drain_ratio: number | null; n_in: number; n_out: number; gap_ms: number | null;
  }>;

  const values = spends.map((s) => s.value_sats);
  const gaps = spends.map((s) => s.gap_ms).filter((g): g is number => g !== null && g > 0);
  const drains = spends.map((s) => s.drain_ratio).filter((d): d is number => d !== null);

  return {
    address,
    spendBaseline: buildBaseline("spend", values, MIN_OBSERVATIONS),
    gapBaseline: buildBaseline("gap", gaps, MIN_OBSERVATIONS),
    drainBaseline: buildBaseline("drain", drains, MIN_OBSERVATIONS),
    meanNIn: num(row.mean_n_in),
    meanNOut: num(row.mean_n_out),
    lastSpendAt: num(row.last_spend_at),
    counterparties: (row.counterparties as number) ?? 0,
    observations: (row.spend_count as number) ?? 0,
  };
}

/** How many of a transaction's destinations this sender has never paid. */
export function countNovelDestinations(
  address: string,
  destinations: readonly string[],
): { novel: number; total: number } {
  const targets = [...new Set(destinations.filter((d) => d && d !== address))];
  if (!targets.length) return { novel: 0, total: 0 };
  const rows = getDb()
    .prepare(
      `SELECT counterparty FROM btc_counterparties
       WHERE address = ? AND counterparty IN (${targets.map(() => "?").join(",")})`,
    )
    .all(address, ...targets) as Array<{ counterparty: string }>;
  const known = new Set(rows.map((r) => r.counterparty));
  return { novel: targets.filter((t) => !known.has(t)).length, total: targets.length };
}

/**
 * Which of these addresses have we ever profiled?
 *
 * Resolved in ONE query for a whole block. The per-transaction alternative is
 * ~15,000 round trips on a busy block, which is the cost the staged triage
 * exists to avoid — so asking per transaction would defeat its own purpose.
 *
 * SQLite has a parameter ceiling (999 by default), so the input is chunked
 * rather than assumed to fit.
 */
export function knownAddresses(
  addresses: readonly string[],
  minObservations = MIN_OBSERVATIONS,
): Set<string> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const known = new Set<string>();
  if (!unique.length) return known;
  const db = getDb();
  const CHUNK = 800;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    // Requires ENOUGH history to say something, not merely a row.
    //
    // Measured consequence of getting this wrong: admitting on the existence of
    // a profile took Stage 1 from 5.2% of a block to 59.8%. Every address the
    // walker had ever touched counted as "known", so after one block most of
    // the chain qualified — a feedback loop where profiling more addresses
    // admitted more transactions which profiled more addresses.
    //
    // An address with one recorded spend supports no median, no MAD and no
    // dormancy judgement, so it is not something we know anything about.
    const rows = db
      .prepare(
        `SELECT address FROM btc_address_profile
         WHERE address IN (${slice.map(() => "?").join(",")})
           AND spend_count >= ?`,
      )
      .all(...slice, minObservations) as Array<{ address: string }>;
    for (const r of rows) known.add(r.address);
  }
  return known;
}

/** Coverage of the profile store, for the board's health line. */
export function profileStats(): {
  addresses: number; withHistory: number; spendRows: number; counterpartyRows: number;
} {
  const db = getDb();
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    addresses: one("SELECT COUNT(*) n FROM btc_address_profile"),
    withHistory: one(`SELECT COUNT(*) n FROM btc_address_profile WHERE spend_count >= ${MIN_OBSERVATIONS}`),
    spendRows: one("SELECT COUNT(*) n FROM btc_address_spends"),
    counterpartyRows: one("SELECT COUNT(*) n FROM btc_counterparties"),
  };
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

export { log as profileLog };
