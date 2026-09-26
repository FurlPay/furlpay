// Repositories for the Bitcoin mempool surface and the threat feed.
//
// Kept out of db/index.ts because that file is already the whole EVM/Solana
// story; these tables are a separate subject with a separate lifecycle. The
// pattern is the same though: every write is idempotent, so a replayed block
// or a re-fetched incident feed can never double-insert and never double-alert.

import { getDb } from "./index.js";
import type { BlockScan, BtcWhaleTx, HackIncident, NetworkSnapshot } from "../mempool/types.js";

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/* ================================================================== */
/* Network snapshots                                                   */
/* ================================================================== */

export const btcNetwork = {
  insert(s: NetworkSnapshot): void {
    getDb()
      .prepare(
        `INSERT INTO btc_network (ts,tip_height,mempool_count,mempool_vsize,mempool_total_fee,
           fastest_fee,half_hour_fee,hour_fee,economy_fee,minimum_fee,projected_blocks,
           difficulty_change,difficulty_progress,retarget_eta,hashrate,price_usd,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(ts) DO NOTHING`,
      )
      .run(
        s.ts, s.tipHeight, s.mempoolCount, s.mempoolVsize, s.mempoolTotalFee,
        s.fees.fastest, s.fees.halfHour, s.fees.hour, s.fees.economy, s.fees.minimum,
        s.projectedBlocks, s.difficultyChangePct, s.difficultyProgressPct, s.retargetEta,
        s.hashrate, s.priceUsd, s.sources.join("+"),
      );
  },

  latest(): NetworkSnapshot | null {
    const r = getDb()
      .prepare("SELECT * FROM btc_network ORDER BY ts DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return r ? rowToSnapshot(r) : null;
  },

  /** The reading closest to `atMs`, for "vs 24h ago" comparisons. */
  nearest(atMs: number, toleranceMs = 6 * 3_600_000): NetworkSnapshot | null {
    const r = getDb()
      .prepare(
        `SELECT * FROM btc_network WHERE ABS(ts - ?) <= ?
         ORDER BY ABS(ts - ?) ASC LIMIT 1`,
      )
      .get(atMs, toleranceMs, atMs) as Record<string, unknown> | undefined;
    return r ? rowToSnapshot(r) : null;
  },

  since(sinceMs: number): NetworkSnapshot[] {
    return (
      getDb()
        .prepare("SELECT * FROM btc_network WHERE ts >= ? ORDER BY ts ASC")
        .all(sinceMs) as Array<Record<string, unknown>>
    ).map(rowToSnapshot);
  },

  prune(olderThanMs: number): number {
    return Number(
      getDb().prepare("DELETE FROM btc_network WHERE ts < ?").run(olderThanMs).changes,
    );
  },
};

function rowToSnapshot(r: Record<string, unknown>): NetworkSnapshot {
  return {
    ts: r.ts as number,
    tipHeight: num(r.tip_height),
    mempoolCount: num(r.mempool_count),
    mempoolVsize: num(r.mempool_vsize),
    mempoolTotalFee: num(r.mempool_total_fee),
    fees: {
      fastest: num(r.fastest_fee),
      halfHour: num(r.half_hour_fee),
      hour: num(r.hour_fee),
      economy: num(r.economy_fee),
      minimum: num(r.minimum_fee),
    },
    projectedBlocks: num(r.projected_blocks),
    difficultyChangePct: num(r.difficulty_change),
    difficultyProgressPct: num(r.difficulty_progress),
    retargetEta: num(r.retarget_eta),
    hashrate: num(r.hashrate),
    priceUsd: num(r.price_usd),
    sources: String(r.source ?? "").split("+").filter(Boolean),
  };
}

/* ================================================================== */
/* Bitcoin whale transactions                                          */
/* ================================================================== */

export const btcWhales = {
  /**
   * Records a whale, returning whether this txid had never been seen before.
   *
   * A transaction seen first in the mempool and again in a block must UPGRADE,
   * not duplicate: the block pass carries the confirmation height and the
   * complete input/output picture, so it enriches the sampled row. The reverse
   * never happens — `discovery` only ever moves mempool → block, so a
   * confirmed transaction can never be demoted back to a sampled one by a
   * late-arriving mempool observation.
   *
   * The prior-existence check and the write are one statement apart rather than
   * one statement, so they run inside the caller's transaction where there is
   * one; `changes` alone cannot answer it, because ON CONFLICT DO UPDATE
   * reports a change for an update just as it does for an insert.
   */
  upsert(t: BtcWhaleTx): { isNew: boolean } {
    const db = getDb();
    const existed = Boolean(db.prepare("SELECT 1 FROM btc_whale_txs WHERE txid = ?").get(t.txid));
    db
      .prepare(
        `INSERT INTO btc_whale_txs (txid,first_seen,value_sats,fee_sats,vsize,n_in,n_out,
           top_in_addr,top_in_sats,top_out_addr,top_out_sats,self_spend,block_height,block_time,
           price_usd,value_usd,discovery,sanctioned,sanctioned_addr)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(txid) DO UPDATE SET
           block_height    = COALESCE(excluded.block_height, btc_whale_txs.block_height),
           block_time      = COALESCE(excluded.block_time,   btc_whale_txs.block_time),
           fee_sats        = COALESCE(excluded.fee_sats,     btc_whale_txs.fee_sats),
           n_in            = COALESCE(excluded.n_in,         btc_whale_txs.n_in),
           n_out           = COALESCE(excluded.n_out,        btc_whale_txs.n_out),
           top_in_addr     = COALESCE(excluded.top_in_addr,  btc_whale_txs.top_in_addr),
           top_in_sats     = COALESCE(excluded.top_in_sats,  btc_whale_txs.top_in_sats),
           top_out_addr    = COALESCE(excluded.top_out_addr, btc_whale_txs.top_out_addr),
           top_out_sats    = COALESCE(excluded.top_out_sats, btc_whale_txs.top_out_sats),
           self_spend      = excluded.self_spend,
           sanctioned      = MAX(excluded.sanctioned, btc_whale_txs.sanctioned),
           sanctioned_addr = COALESCE(excluded.sanctioned_addr, btc_whale_txs.sanctioned_addr),
           -- Confirmation is an upgrade in provenance and never a downgrade.
           discovery       = CASE WHEN excluded.discovery = 'block' THEN 'block'
                                  ELSE btc_whale_txs.discovery END`,
      )
      .run(
        t.txid, t.firstSeen, t.valueSats, t.feeSats, t.vsize, t.nIn, t.nOut,
        t.topInAddr, t.topInSats, t.topOutAddr, t.topOutSats, t.selfSpend ? 1 : 0,
        t.blockHeight, t.blockTime, t.priceUsd, t.valueUsd, t.discovery,
        t.sanctioned ? 1 : 0, t.sanctionedAddr,
      );
    return { isNew: !existed };
  },

  get(txid: string): BtcWhaleTx | null {
    const r = getDb()
      .prepare("SELECT * FROM btc_whale_txs WHERE txid = ?")
      .get(txid) as Record<string, unknown> | undefined;
    return r ? rowToWhale(r) : null;
  },

  /** Whales not yet pushed to Discord, largest first. */
  pendingAlerts(limit = 10): BtcWhaleTx[] {
    return (
      getDb()
        .prepare("SELECT * FROM btc_whale_txs WHERE alerted = 0 ORDER BY value_sats DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>
    ).map(rowToWhale);
  },

  markAlerted(txids: string[]): void {
    if (!txids.length) return;
    const stmt = getDb().prepare("UPDATE btc_whale_txs SET alerted = 1 WHERE txid = ?");
    for (const id of txids) stmt.run(id);
  },

  largest(sinceMs: number, limit = 10, discovery?: "block" | "mempool"): BtcWhaleTx[] {
    const d = getDb();
    const rows = discovery
      ? d.prepare(
          "SELECT * FROM btc_whale_txs WHERE first_seen >= ? AND discovery = ? ORDER BY value_sats DESC LIMIT ?",
        ).all(sinceMs, discovery, limit)
      : d.prepare(
          "SELECT * FROM btc_whale_txs WHERE first_seen >= ? ORDER BY value_sats DESC LIMIT ?",
        ).all(sinceMs, limit);
    return (rows as Array<Record<string, unknown>>).map(rowToWhale);
  },

  /**
   * Totals split by how the transaction was found, because summing the two
   * together would present a complete count and a sampled floor as one number.
   */
  statsSince(sinceMs: number): {
    block: { count: number; sats: number };
    mempool: { count: number; sats: number };
    sanctioned: number;
  } {
    const d = getDb();
    const q = (disc: string) =>
      d.prepare(
        "SELECT COUNT(*) n, COALESCE(SUM(value_sats),0) s FROM btc_whale_txs WHERE first_seen >= ? AND discovery = ?",
      ).get(sinceMs, disc) as { n: number; s: number };
    const b = q("block");
    const m = q("mempool");
    const sanc = d
      .prepare("SELECT COUNT(*) n FROM btc_whale_txs WHERE first_seen >= ? AND sanctioned = 1")
      .get(sinceMs) as { n: number };
    return {
      block: { count: b.n, sats: b.s },
      mempool: { count: m.n, sats: m.s },
      sanctioned: sanc.n,
    };
  },

  sanctionedSince(sinceMs: number, limit = 10): BtcWhaleTx[] {
    return (
      getDb()
        .prepare(
          "SELECT * FROM btc_whale_txs WHERE sanctioned = 1 AND first_seen >= ? ORDER BY first_seen DESC LIMIT ?",
        )
        .all(sinceMs, limit) as Array<Record<string, unknown>>
    ).map(rowToWhale);
  },

  prune(olderThanMs: number): number {
    return Number(
      getDb().prepare("DELETE FROM btc_whale_txs WHERE first_seen < ?").run(olderThanMs).changes,
    );
  },
};

function rowToWhale(r: Record<string, unknown>): BtcWhaleTx {
  return {
    txid: r.txid as string,
    firstSeen: r.first_seen as number,
    valueSats: r.value_sats as number,
    feeSats: num(r.fee_sats),
    vsize: num(r.vsize),
    nIn: num(r.n_in),
    nOut: num(r.n_out),
    topInAddr: (r.top_in_addr as string) ?? null,
    topInSats: num(r.top_in_sats),
    topOutAddr: (r.top_out_addr as string) ?? null,
    topOutSats: num(r.top_out_sats),
    selfSpend: Boolean(r.self_spend),
    blockHeight: num(r.block_height),
    blockTime: num(r.block_time),
    priceUsd: num(r.price_usd),
    valueUsd: num(r.value_usd),
    discovery: r.discovery as BtcWhaleTx["discovery"],
    sanctioned: Boolean(r.sanctioned),
    sanctionedAddr: (r.sanctioned_addr as string) ?? null,
  };
}

/* ================================================================== */
/* Block scan ledger                                                   */
/* ================================================================== */

export const btcScans = {
  record(s: BlockScan): void {
    getDb()
      .prepare(
        `INSERT INTO btc_block_scans (height,hash,block_time,tx_count,txs_walked,whales_found,
           requests,duration_ms,complete,scanned_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(height) DO UPDATE SET
           hash=excluded.hash, tx_count=excluded.tx_count, txs_walked=excluded.txs_walked,
           whales_found=excluded.whales_found, requests=excluded.requests,
           duration_ms=excluded.duration_ms, complete=excluded.complete,
           scanned_at=excluded.scanned_at`,
      )
      .run(
        s.height, s.hash, s.blockTime, s.txCount, s.txsWalked, s.whalesFound,
        s.requests, s.durationMs, s.complete ? 1 : 0, s.scannedAt,
      );
  },

  has(height: number): boolean {
    return Boolean(
      getDb().prepare("SELECT 1 FROM btc_block_scans WHERE height = ?").get(height),
    );
  },

  highest(): number | null {
    const r = getDb().prepare("SELECT MAX(height) h FROM btc_block_scans").get() as { h: number | null };
    return r?.h ?? null;
  },

  /**
   * Coverage over a window: how many blocks were mined against how many were
   * actually enumerated. This is what lets the digest say "whales in 138 of
   * 144 blocks" instead of quietly reporting a short count as a total.
   */
  coverage(sinceMs: number): {
    scanned: number;
    complete: number;
    txsWalked: number;
    lowest: number | null;
    highest: number | null;
  } {
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(complete),0) c, COALESCE(SUM(txs_walked),0) t,
                MIN(height) lo, MAX(height) hi
         FROM btc_block_scans WHERE block_time >= ?`,
      )
      .get(Math.floor(sinceMs / 1000)) as {
      n: number; c: number; t: number; lo: number | null; hi: number | null;
    };
    return { scanned: r.n, complete: r.c, txsWalked: r.t, lowest: r.lo, highest: r.hi };
  },

  prune(olderThanSec: number): number {
    return Number(
      getDb().prepare("DELETE FROM btc_block_scans WHERE block_time < ?").run(olderThanSec).changes,
    );
  },
};

/* ================================================================== */
/* Security incidents                                                  */
/* ================================================================== */

export const hacks = {
  /**
   * Records an incident, returning whether it had never been seen before.
   * Only a genuinely new key is worth an alert — the upstream feed republishes
   * every incident on every fetch, and revises loss figures on old ones.
   */
  insert(h: HackIncident): { isNew: boolean } {
    const db = getDb();
    const existed = Boolean(db.prepare("SELECT 1 FROM hack_incidents WHERE key = ?").get(h.key));
    db
      .prepare(
        `INSERT INTO hack_incidents (key,name,ts,amount_usd,classification,technique,chains,
           target_type,bridge_hack,returned_funds,source_url,first_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET
           amount_usd=excluded.amount_usd, returned_funds=excluded.returned_funds,
           source_url=COALESCE(excluded.source_url, hack_incidents.source_url)`,
      )
      .run(
        h.key, h.name, h.ts, h.amountUsd, h.classification, h.technique,
        JSON.stringify(h.chains), h.targetType, h.bridgeHack ? 1 : 0,
        h.returnedFunds, h.sourceUrl, h.firstSeen,
      );
    return { isNew: !existed };
  },

  pendingAlerts(limit = 10): HackIncident[] {
    return (
      getDb()
        .prepare("SELECT * FROM hack_incidents WHERE alerted = 0 ORDER BY ts DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>
    ).map(rowToHack);
  },

  markAlerted(keys: string[]): void {
    if (!keys.length) return;
    const stmt = getDb().prepare("UPDATE hack_incidents SET alerted = 1 WHERE key = ?");
    for (const k of keys) stmt.run(k);
  },

  since(sinceMs: number, limit = 25): HackIncident[] {
    return (
      getDb()
        .prepare("SELECT * FROM hack_incidents WHERE ts >= ? ORDER BY ts DESC, amount_usd DESC LIMIT ?")
        .all(sinceMs, limit) as Array<Record<string, unknown>>
    ).map(rowToHack);
  },

  totalsSince(sinceMs: number): { count: number; amountUsd: number; recovered: number } {
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_usd),0) a, COALESCE(SUM(returned_funds),0) f
         FROM hack_incidents WHERE ts >= ?`,
      )
      .get(sinceMs) as { n: number; a: number; f: number };
    return { count: r.n, amountUsd: r.a, recovered: r.f };
  },

  /** How many incidents the store holds — zero means the feed never loaded. */
  size(): number {
    const r = getDb().prepare("SELECT COUNT(*) n FROM hack_incidents").get() as { n: number };
    return r.n;
  },
};

function rowToHack(r: Record<string, unknown>): HackIncident {
  let chains: string[] = [];
  try {
    const p = JSON.parse(String(r.chains ?? "[]"));
    if (Array.isArray(p)) chains = p.map(String);
  } catch {
    /* a malformed chain list must not lose the incident */
  }
  return {
    key: r.key as string,
    name: r.name as string,
    ts: r.ts as number,
    amountUsd: num(r.amount_usd),
    classification: (r.classification as string) ?? null,
    technique: (r.technique as string) ?? null,
    chains,
    targetType: (r.target_type as string) ?? null,
    bridgeHack: Boolean(r.bridge_hack),
    returnedFunds: num(r.returned_funds),
    sourceUrl: (r.source_url as string) ?? null,
    firstSeen: r.first_seen as number,
  };
}

/* ================================================================== */
/* Sanctioned addresses                                                */
/* ================================================================== */

export const sanctions = {
  /** Replaces the list for one asset atomically — a delisting must take effect. */
  replace(asset: string, addresses: string[]): number {
    const d = getDb();
    const now = Date.now();
    d.exec("BEGIN");
    try {
      d.prepare("DELETE FROM sanctioned_addresses WHERE asset = ?").run(asset);
      const stmt = d.prepare(
        "INSERT INTO sanctioned_addresses (address,asset,fetched_at) VALUES (?,?,?) ON CONFLICT(address,asset) DO NOTHING",
      );
      for (const a of addresses) stmt.run(a, asset, now);
      d.exec("COMMIT");
    } catch (err) {
      d.exec("ROLLBACK");
      throw err;
    }
    return addresses.length;
  },

  all(asset: string): string[] {
    return (
      getDb()
        .prepare("SELECT address FROM sanctioned_addresses WHERE asset = ?")
        .all(asset) as Array<{ address: string }>
    ).map((r) => r.address);
  },

  fetchedAt(asset: string): number | null {
    const r = getDb()
      .prepare("SELECT MAX(fetched_at) t FROM sanctioned_addresses WHERE asset = ?")
      .get(asset) as { t: number | null };
    return r?.t ?? null;
  },
};
