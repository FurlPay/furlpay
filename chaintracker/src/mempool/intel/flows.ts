// Fund-flow tracking: following money across transactions.
//
// The problem this solves. A thousand BTC leaves address A, lands on B, and
// five minutes later B splits it three ways. Transaction-at-a-time alerting
// reports that as four unrelated whale movements totalling 2,990 BTC — double
// the money that actually moved, spread over four messages nobody can connect.
// The Liquid incident had exactly this shape: a drain to a pass-through hop
// which forwarded everything onward, verified on chain as 3,996.02 BTC in and
// 3,996.02 BTC straight back out across two transactions.
//
// A flow is a chain of transactions where value leaving one is spent again by
// the next, within a window. Tracking it gives three things a single
// transaction cannot: VELOCITY (how fast money is being moved), HOPS (how many
// times it has been forwarded), and FAN-OUT (how many destinations it reached).
// Rapid, multi-hop, high-fan-out movement is the signature of funds being
// moved by someone who wants them gone, and none of those three is visible
// from any one transaction in isolation.
//
// What this is NOT: address clustering. Two addresses in the same flow are
// connected because coins moved between them, which is an observable fact.
// That is not a claim of common ownership — a deposit to an exchange is also a
// hop. The wording in the alerts follows that distinction.

import { getDb } from "../../db/index.js";
import { makeLogger } from "../../util/logger.js";
import type { RawTx } from "./features.js";

const log = makeLogger("btc-flows");

/** How long after a transaction a spend of its outputs still counts as a hop. */
export const FLOW_WINDOW_MS = 6 * 3_600_000;

/** A flow with no new hop for this long is closed. */
export const FLOW_IDLE_MS = 2 * 3_600_000;

export interface Flow {
  id: string;
  startedAt: number;
  updatedAt: number;
  rootTxid: string;
  hops: number;
  txCount: number;
  totalSats: number;
  destinations: number;
  /** Satoshis per minute over the life of the flow. */
  velocity: number | null;
  risk: number;
  status: "open" | "closed";
  messageId: string | null;
  alertedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Address index                                                       */
/* ------------------------------------------------------------------ */

/**
 * Record the addresses a transaction touched.
 *
 * Only inputs and outputs carrying real value are stored, and only for
 * transactions that already cleared the whale threshold. Indexing every
 * address on the chain is a different and much larger product.
 */
export function indexAddresses(tx: RawTx, ts: number): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO btc_tx_addresses (txid,address,side,value_sats,ts) VALUES (?,?,?,?,?)
     ON CONFLICT(txid,address,side) DO UPDATE SET value_sats = value_sats + excluded.value_sats`,
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const i of tx.vin) {
      const a = i.prevout?.scriptpubkey_address;
      if (!a) continue;
      stmt.run(tx.txid, a, "in", Number(i.prevout?.value) || 0, ts);
      n += 1;
    }
    for (const o of tx.vout) {
      const a = o.scriptpubkey_address;
      if (!a) continue;
      stmt.run(tx.txid, a, "out", Number(o.value) || 0, ts);
      n += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

export interface Predecessor {
  txid: string;
  address: string;
  valueSats: number;
  ts: number;
}

/**
 * Find transactions whose OUTPUTS this transaction now SPENDS.
 *
 * Direction is the whole correctness question here. A predecessor is a
 * transaction that paid an address which this transaction is now spending
 * from — output-then-input, in that order in time. Matching on shared
 * addresses without checking side and order links every transaction that ever
 * reused an address, which on Bitcoin is a great many of them.
 */
export function findPredecessors(
  tx: RawTx,
  ts: number,
  windowMs = FLOW_WINDOW_MS,
): Predecessor[] {
  const inputAddrs = [...new Set(
    tx.vin.map((i) => i.prevout?.scriptpubkey_address).filter((a): a is string => Boolean(a)),
  )];
  if (!inputAddrs.length) return [];

  const db = getDb();
  const placeholders = inputAddrs.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT txid, address, value_sats, ts FROM btc_tx_addresses
       WHERE side = 'out' AND address IN (${placeholders})
         AND ts >= ? AND ts <= ? AND txid != ?
       ORDER BY ts DESC LIMIT 50`,
    )
    .all(...inputAddrs, ts - windowMs, ts, tx.txid) as Array<{
    txid: string; address: string; value_sats: number; ts: number;
  }>;

  return rows.map((r) => ({
    txid: r.txid, address: r.address, valueSats: r.value_sats, ts: r.ts,
  }));
}

/* ------------------------------------------------------------------ */
/* Flow maintenance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Attach a transaction to a flow, creating or extending one.
 *
 * When a transaction descends from several existing flows they are MERGED,
 * because they were always one movement observed in pieces. The oldest flow
 * wins the identity so its message id survives and the Discord post is edited
 * rather than replaced.
 */
export function attach(
  tx: RawTx,
  valueSats: number,
  ts: number,
  windowMs = FLOW_WINDOW_MS,
): { flow: Flow; isNew: boolean; hop: number } {
  const db = getDb();
  const preds = findPredecessors(tx, ts, windowMs);

  const flowIds = new Set<string>();
  let maxHop = 0;
  for (const p of preds) {
    const r = db
      .prepare("SELECT flow_id, hop FROM btc_flow_txs WHERE txid = ?")
      .get(p.txid) as { flow_id: string; hop: number } | undefined;
    if (r) {
      flowIds.add(r.flow_id);
      maxHop = Math.max(maxHop, r.hop);
    }
  }

  let flowId: string;
  let isNew = false;
  if (!flowIds.size) {
    flowId = `F${ts.toString(36).toUpperCase()}${tx.txid.slice(0, 4).toUpperCase()}`;
    isNew = true;
    db.prepare(
      `INSERT INTO btc_flows (id,started_at,updated_at,root_txid,hops,tx_count,total_sats,destinations,velocity,risk,status)
       VALUES (?,?,?,?,1,0,0,0,NULL,0,'open') ON CONFLICT(id) DO NOTHING`,
    ).run(flowId, ts, ts, tx.txid);
  } else {
    const ids = [...flowIds];
    const oldest = db
      .prepare(
        `SELECT id FROM btc_flows WHERE id IN (${ids.map(() => "?").join(",")})
         ORDER BY started_at ASC LIMIT 1`,
      )
      .get(...ids) as { id: string } | undefined;
    flowId = oldest?.id ?? ids[0]!;
    for (const other of ids) {
      if (other === flowId) continue;
      mergeFlows(flowId, other);
    }
  }

  const hop = maxHop + 1;
  db.prepare(
    `INSERT INTO btc_flow_txs (flow_id,txid,hop,value_sats,ts) VALUES (?,?,?,?,?)
     ON CONFLICT(flow_id,txid) DO UPDATE SET hop = MIN(hop, excluded.hop)`,
  ).run(flowId, tx.txid, hop, valueSats, ts);

  return { flow: recompute(flowId)!, isNew, hop };
}

/** Fold `from` into `into`, keeping the surviving flow's identity. */
function mergeFlows(into: string, from: string): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE OR REPLACE btc_flow_txs SET flow_id = ? WHERE flow_id = ?`,
    ).run(into, from);
    db.prepare("DELETE FROM btc_flows WHERE id = ?").run(from);
    db.exec("COMMIT");
    log.info("flows merged", { into, from });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Recompute a flow's aggregates from its transactions.
 *
 * `totalSats` is the value of the ROOT hop only, not the sum of every
 * transaction. Summing hops counts the same coins once per forward: a 1,000
 * BTC movement through three hops would report 3,000 BTC moved, which is the
 * specific error that made per-transaction alerting misleading in the first
 * place.
 */
export function recompute(flowId: string): Flow | null {
  const db = getDb();
  const head = db.prepare("SELECT * FROM btc_flows WHERE id = ?").get(flowId) as
    | Record<string, unknown>
    | undefined;
  if (!head) return null;

  const txs = db
    .prepare("SELECT txid, hop, value_sats, ts FROM btc_flow_txs WHERE flow_id = ? ORDER BY hop, ts")
    .all(flowId) as Array<{ txid: string; hop: number; value_sats: number; ts: number }>;
  if (!txs.length) return null;

  const hops = Math.max(...txs.map((t) => t.hop));
  const firstHop = txs.filter((t) => t.hop === 1);
  const totalSats = firstHop.reduce((s, t) => s + t.value_sats, 0);
  const startedAt = Math.min(...txs.map((t) => t.ts));
  const updatedAt = Math.max(...txs.map((t) => t.ts));

  const destRow = db
    .prepare(
      `SELECT COUNT(DISTINCT address) n FROM btc_tx_addresses
       WHERE side = 'out' AND txid IN (${txs.map(() => "?").join(",")})`,
    )
    .get(...txs.map((t) => t.txid)) as { n: number };

  const minutes = (updatedAt - startedAt) / 60_000;
  // Velocity needs elapsed time to be meaningful. A single transaction has
  // none, so it gets null rather than a division by zero dressed up as speed.
  const velocity = minutes >= 1 ? totalSats / minutes : null;

  const risk = flowRisk({ hops, txCount: txs.length, totalSats, destinations: destRow.n, velocity });

  db.prepare(
    `UPDATE btc_flows SET started_at=?, updated_at=?, hops=?, tx_count=?, total_sats=?,
       destinations=?, velocity=?, risk=? WHERE id=?`,
  ).run(startedAt, updatedAt, hops, txs.length, totalSats, destRow.n, velocity, risk, flowId);

  return {
    id: flowId,
    startedAt,
    updatedAt,
    rootTxid: head.root_txid as string,
    hops,
    txCount: txs.length,
    totalSats,
    destinations: destRow.n,
    velocity,
    risk,
    status: (head.status as Flow["status"]) ?? "open",
    messageId: (head.message_id as string) ?? null,
    alertedAt: (head.alerted_at as number) ?? null,
  };
}

/**
 * Risk of a flow, 0..100, from four observable properties.
 *
 * Deliberately not a model. Each term is a plain statement about the movement,
 * and the weights say which of those statements a reader should care about
 * most. Funds being forwarded repeatedly, quickly, to many destinations is the
 * shape of somebody dispersing money; any one of those alone is routine.
 */
export function flowRisk(f: {
  hops: number;
  txCount: number;
  totalSats: number;
  destinations: number;
  velocity: number | null;
}): number {
  const btc = f.totalSats / 1e8;
  const size = clamp01((Math.log10(Math.max(1, btc)) - 1) / 2.5) * 30;
  // Depth: one hop is a payment. Four is a chain.
  const depth = clamp01((f.hops - 1) / 4) * 25;
  const fan = clamp01(Math.log2(Math.max(1, f.destinations)) / 6) * 20;
  // Velocity in BTC/min. 10 BTC/min sustained is fast for an honest process.
  const speed = f.velocity === null ? 0 : clamp01(f.velocity / 1e8 / 10) * 25;
  return round1(size + depth + fan + speed);
}

/** Flows worth showing, most concerning first. */
export function activeFlows(sinceMs: number, limit = 5): Flow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM btc_flows WHERE updated_at >= ? AND hops > 1
       ORDER BY risk DESC, total_sats DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<Record<string, unknown>>;
  return rows.map(toFlow);
}

export function flowById(id: string): Flow | null {
  const r = getDb().prepare("SELECT * FROM btc_flows WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toFlow(r) : null;
}

export function flowTxs(id: string): Array<{ txid: string; hop: number; valueSats: number; ts: number }> {
  return (
    getDb()
      .prepare("SELECT txid,hop,value_sats,ts FROM btc_flow_txs WHERE flow_id=? ORDER BY hop, ts")
      .all(id) as Array<{ txid: string; hop: number; value_sats: number; ts: number }>
  ).map((r) => ({ txid: r.txid, hop: r.hop, valueSats: r.value_sats, ts: r.ts }));
}

export function recordFlowMessage(id: string, messageId: string): void {
  getDb()
    .prepare("UPDATE btc_flows SET message_id=?, alerted_at=? WHERE id=?")
    .run(messageId, Date.now(), id);
}

/** Close flows that have stopped moving, and prune the address index. */
export function sweep(now = Date.now()): { closed: number; pruned: number } {
  const db = getDb();
  const closed = Number(
    db.prepare("UPDATE btc_flows SET status='closed' WHERE status='open' AND updated_at < ?")
      .run(now - FLOW_IDLE_MS).changes,
  );
  const pruned = Number(
    db.prepare("DELETE FROM btc_tx_addresses WHERE ts < ?").run(now - 7 * 86_400_000).changes,
  );
  return { closed, pruned };
}

function toFlow(r: Record<string, unknown>): Flow {
  return {
    id: r.id as string,
    startedAt: r.started_at as number,
    updatedAt: r.updated_at as number,
    rootTxid: r.root_txid as string,
    hops: r.hops as number,
    txCount: r.tx_count as number,
    totalSats: r.total_sats as number,
    destinations: r.destinations as number,
    velocity: (r.velocity as number) ?? null,
    risk: (r.risk as number) ?? 0,
    status: (r.status as Flow["status"]) ?? "open",
    messageId: (r.message_id as string) ?? null,
    alertedAt: (r.alerted_at as number) ?? null,
  };
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round1 = (x: number): number => Math.round(x * 10) / 10;
