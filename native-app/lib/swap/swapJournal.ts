import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// The swap journal — what is in flight, and what happened.
//
// WRITTEN BEFORE THE FIRST BROADCAST, not after success. A row that exists only
// once a swap completes is useless for the case that matters: the app being
// killed while a bridge is mid-flight. The journal has to be able to say "we
// broadcast this and never learned the outcome", which means the write comes
// first and the outcome is an update.
//
// This is also the swap history. One table, because "recent swaps" and "swaps
// still running" are the same rows at different points in their life, and
// keeping two stores in step is a bug generator.
// ---------------------------------------------------------------------------

/**
 * Terminal states are `done` and `failed`. `pending` and `bridging` are
 * RESUMABLE — they mean the app stopped watching, not that the swap stopped.
 */
export type SwapRecordStatus = "pending" | "bridging" | "done" | "failed";

export interface SwapRecord {
  id: string;
  routeId: string | null;
  status: SwapRecordStatus;
  /** Last SwapStep seen, so a resumed swap can say where it was. */
  step: string | null;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amountIn: number;
  amountOut: number | null;
  txHash: string | null;
  approvalTxHash: string | null;
  /** Destination-chain transaction, only ever set for a bridged route. */
  destTxHash: string | null;
  bridgeStatus: string | null;
  bridgeSubstatus: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  route_id: string | null;
  status: string;
  step: string | null;
  from_chain: string;
  to_chain: string;
  from_token: string;
  to_token: string;
  amount_in: number;
  amount_out: number | null;
  tx_hash: string | null;
  approval_tx_hash: string | null;
  dest_tx_hash: string | null;
  bridge_status: string | null;
  bridge_substatus: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function toRecord(r: Row): SwapRecord {
  return {
    id: r.id,
    routeId: r.route_id,
    status: r.status as SwapRecordStatus,
    step: r.step,
    fromChain: r.from_chain,
    toChain: r.to_chain,
    fromToken: r.from_token,
    toToken: r.to_token,
    amountIn: r.amount_in,
    amountOut: r.amount_out,
    txHash: r.tx_hash,
    approvalTxHash: r.approval_tx_hash,
    destTxHash: r.dest_tx_hash,
    bridgeStatus: r.bridge_status,
    bridgeSubstatus: r.bridge_substatus,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface NewSwap {
  id: string;
  routeId?: string | null;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amountIn: number;
}

/** Opens a journal entry. Call this before anything is broadcast. */
export function openSwap(swap: NewSwap, now = Date.now()): void {
  getDb().runSync(
    `INSERT OR REPLACE INTO swaps
       (id, route_id, status, step, from_chain, to_chain, from_token, to_token,
        amount_in, amount_out, tx_hash, approval_tx_hash, dest_tx_hash,
        bridge_status, bridge_substatus, error, created_at, updated_at)
     VALUES (?, ?, 'pending', NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, ?, ?)`,
    [
      swap.id,
      swap.routeId ?? null,
      swap.fromChain,
      swap.toChain,
      swap.fromToken,
      swap.toToken,
      swap.amountIn,
      now,
      now,
    ]
  );
}

export interface SwapUpdate {
  status?: SwapRecordStatus;
  step?: string | null;
  txHash?: string | null;
  approvalTxHash?: string | null;
  destTxHash?: string | null;
  amountOut?: number | null;
  bridgeStatus?: string | null;
  bridgeSubstatus?: string | null;
  error?: string | null;
}

const COLUMN: Record<keyof SwapUpdate, string> = {
  status: "status",
  step: "step",
  txHash: "tx_hash",
  approvalTxHash: "approval_tx_hash",
  destTxHash: "dest_tx_hash",
  amountOut: "amount_out",
  bridgeStatus: "bridge_status",
  bridgeSubstatus: "bridge_substatus",
  error: "error",
};

/**
 * Patches an entry. Only the fields present are written.
 *
 * Partial on purpose: the bridge poller learns the destination hash long after
 * the source hash was recorded, and a whole-row write would need to carry
 * values it never knew about — and would clobber them with nulls.
 */
export function updateSwap(id: string, patch: SwapUpdate, now = Date.now()): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, column] of Object.entries(COLUMN) as [keyof SwapUpdate, string][]) {
    if (key in patch && patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(patch[key] as string | number | null);
    }
  }
  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  values.push(now, id);
  getDb().runSync(`UPDATE swaps SET ${sets.join(", ")} WHERE id = ?`, values);
}

export function getSwap(id: string): SwapRecord | null {
  const row = getDb().getFirstSync<Row>("SELECT * FROM swaps WHERE id = ?", [id]);
  return row ? toRecord(row) : null;
}

/** Newest first. This is the history screen's query. */
export function listSwaps(limit = 50): SwapRecord[] {
  return getDb()
    .getAllSync<Row>("SELECT * FROM swaps ORDER BY created_at DESC LIMIT ?", [limit])
    .map(toRecord);
}

/**
 * Swaps that were still running when we last looked.
 *
 * `pending` with no txHash is a swap that never got off the ground — the app
 * died between opening the journal and broadcasting — and there is nothing to
 * resume, so it is excluded. Everything else has a hash on chain and a real
 * outcome waiting to be read.
 */
export function listResumableSwaps(): SwapRecord[] {
  return getDb()
    .getAllSync<Row>(
      `SELECT * FROM swaps
        WHERE status IN ('pending', 'bridging')
          AND tx_hash IS NOT NULL
        ORDER BY created_at ASC`
    )
    .map(toRecord);
}

/**
 * Closes out entries too old to still be in flight.
 *
 * A bridge can legitimately take a long time, but not a day. Left alone these
 * rows would be retried on every launch forever; marked failed, they stay in
 * history with their hash so the user can still find them.
 */
export function expireStaleSwaps(olderThanMs = 24 * 60 * 60 * 1000, now = Date.now()): number {
  const result = getDb().runSync(
    `UPDATE swaps
        SET status = 'failed',
            error = COALESCE(error, 'Stopped tracking after 24 hours — check the explorer.'),
            updated_at = ?
      WHERE status IN ('pending', 'bridging')
        AND created_at < ?`,
    [now, now - olderThanMs]
  );
  return result.changes;
}

/** Wipes the journal. Used by sign-out, alongside the other caches. */
export function clearSwaps(): void {
  getDb().execSync("DELETE FROM swaps");
}
