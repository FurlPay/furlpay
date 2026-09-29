// Finality and reorg engine.
//
// WHAT WAS WRONG. Every stored transfer was implicitly final the instant it was
// seen. Measured on 2026-09-29, `latest - finalized` is 83 blocks on Ethereum and
// 4,127 on Arbitrum — so the newest rows in the table are routinely NOT final, and
// a reorg would leave transfers that never happened sitting in every total forever
// with nothing to indicate it.
//
// THE STATE MACHINE.
//
//     observed  ──►  canonical  ──►  final
//         │              │
//         └──────────────┴──►  reorged
//
//   observed   read from a provider; could still be reorganised away.
//   canonical  buried under enough confirmations that a reorg is unlikely.
//   final      at or below the chain's own `finalized` head AND past our own
//              confirmation floor.
//   reorged    the block at that height now has a different hash. The transfer did
//              not happen on the chain that exists.
//
// WHY A FLOOR ON TOP OF THE CHAIN'S OWN TAG. All twelve chains answer
// `eth_getBlockByNumber("finalized")`, but three of them — Polygon, Linea and Sonic
// — returned `finalized == latest`. That is a sequencer's optimistic claim, not
// settled finality. Trusting it verbatim would mark a block final in the same
// second it was produced, which is exactly the assumption this file exists to stop
// making. So a chain is final at `min(finalizedHead, latest - floor)`.
//
// REORGED ROWS ARE NEVER DELETED. They are marked, excluded from aggregates, and
// kept. Deleting them would silently change historical numbers and destroy the
// evidence that the reorg happened.

import { getDb } from "../db/index.js";
import { evm } from "../providers/index.js";
import { makeLogger } from "../util/logger.js";
import { chainRowFor } from "./scanner.js";
import { getEvmScanAssets, getUsdcAsset } from "./registry.js";
import type { UsdcAsset } from "./types.js";

const log = makeLogger("usdc:finality");

export type Finality = "observed" | "canonical" | "final" | "reorged";

/**
 * Minimum confirmations before this tracker will call a block final, regardless of
 * what the chain's own `finalized` tag says.
 *
 * These are floors, not estimates of reorg depth. The measured `latest - finalized`
 * lag is larger than the floor on every chain that reports honestly, so the floor
 * only binds where the tag is optimistic — which is precisely where it is needed.
 * A chain absent from this table gets DEFAULT_CONFIRMATION_FLOOR.
 */
export const CONFIRMATION_FLOOR: Record<string, number> = {
  // Measured lag 83. Post-merge finality is two epochs, ~64-95 blocks.
  ethereum: 64,
  // Measured lag 6. Avalanche reaches finality in about a second, so a small floor
  // is genuinely sufficient rather than merely conventional.
  avalanche: 12,
  // Optimistic rollups: the measured lag is large and honest, so the floor rarely
  // binds. It exists for the case where the endpoint starts reporting optimistically.
  optimism: 120,
  base: 120,
  arbitrum: 600,
  unichain: 120,
  worldchain: 120,
  // REPORTED finalized == latest when measured. The floor is doing all the work on
  // these three, which is why it is deliberately not small.
  polygon: 128,
  linea: 150,
  sonic: 150,
  celo: 60,
  zksync: 150,
};

export const DEFAULT_CONFIRMATION_FLOOR = 200;

export function confirmationFloor(chainSlug: string): number {
  return CONFIRMATION_FLOOR[chainSlug] ?? DEFAULT_CONFIRMATION_FLOOR;
}

/**
 * How far below the head a block must be before we call it merely `canonical`.
 *
 * A fraction of the final floor: deep enough that an ordinary one- or two-block
 * reorg has passed, shallow enough to be a useful intermediate state.
 */
export function canonicalDepth(chainSlug: string): number {
  return Math.max(6, Math.floor(confirmationFloor(chainSlug) / 8));
}

export interface ChainHeads {
  chainSlug: string;
  latest: number | null;
  safe: number | null;
  finalized: number | null;
  /** True when the chain reported finalized == latest, i.e. an optimistic tag. */
  optimistic: boolean;
  /** The height at or below which we are willing to call a block final. */
  finalThreshold: number | null;
  error: string | null;
}

/**
 * Read a chain's heads.
 *
 * `safe` is optional — Polygon rejects the tag outright — so a failure there is
 * recorded and not treated as an error. `finalized` failing IS notable, because
 * without it the floor is the only thing promoting blocks.
 */
export async function readHeads(asset: UsdcAsset): Promise<ChainHeads> {
  const chain = chainRowFor(asset);
  const out: ChainHeads = {
    chainSlug: asset.chainSlug,
    latest: null,
    safe: null,
    finalized: null,
    optimistic: false,
    finalThreshold: null,
    error: null,
  };

  try {
    out.latest = await evm.blockNumber(chain);
  } catch (err) {
    out.error = (err as Error).message.slice(0, 120);
    return out;
  }

  try {
    const b = await evm.getBlockByTag(chain, "finalized");
    out.finalized = b?.number ?? null;
  } catch {
    // Left null. The floor still promotes blocks, just more conservatively.
  }
  try {
    const b = await evm.getBlockByTag(chain, "safe");
    out.safe = b?.number ?? null;
  } catch {
    // Polygon does this. Not an error.
  }

  if (out.finalized !== null && out.latest !== null) {
    // The tag claiming the newest block is already final is a sequencer's optimism,
    // not settled finality. Recorded so the operator can see which chains it applies
    // to rather than having to rediscover it.
    out.optimistic = out.finalized >= out.latest;
  }

  const floorHeight = out.latest === null ? null : out.latest - confirmationFloor(asset.chainSlug);
  if (floorHeight !== null) {
    out.finalThreshold =
      out.finalized === null ? floorHeight : Math.min(out.finalized, floorHeight);
  }

  return out;
}

/** Persist the heads so `doctor` and the report can show finality lag. */
export function storeHeads(h: ChainHeads): void {
  getDb()
    .prepare(
      `INSERT INTO usdc_chain_heads (
         chain_slug, latest_block, safe_block, finalized_block, optimistic_finality, updated_at
       ) VALUES (?,?,?,?,?,?)
       ON CONFLICT(chain_slug) DO UPDATE SET
         latest_block = excluded.latest_block,
         safe_block = excluded.safe_block,
         finalized_block = excluded.finalized_block,
         optimistic_finality = excluded.optimistic_finality,
         updated_at = excluded.updated_at`
    )
    .run(h.chainSlug, h.latest, h.safe, h.finalized, h.optimistic ? 1 : 0, Date.now());
}

export function storedHeads(chainSlug: string): {
  latest: number | null;
  safe: number | null;
  finalized: number | null;
  optimistic: boolean;
  updatedAt: number | null;
} | null {
  const r = getDb()
    .prepare(
      `SELECT latest_block AS latest, safe_block AS safe, finalized_block AS finalized,
              optimistic_finality AS optimistic, updated_at AS updatedAt
         FROM usdc_chain_heads WHERE chain_slug = ?`
    )
    .get(chainSlug) as
    | { latest: number | null; safe: number | null; finalized: number | null; optimistic: number; updatedAt: number }
    | undefined;
  if (!r) return null;
  return { ...r, optimistic: r.optimistic === 1 };
}

/* ------------------------------------------------------------------ */
/* Promotion                                                           */
/* ------------------------------------------------------------------ */

export interface PromotionResult {
  chainSlug: string;
  toCanonical: number;
  toFinal: number;
  error: string | null;
}

/**
 * Advance blocks and their transfers through the state machine.
 *
 * Only ever moves forward — a row already `final` is not revisited, and a `reorged`
 * row is never promoted. Both are enforced in SQL rather than in a loop, so a
 * concurrent tick cannot interleave its way into an invalid transition.
 */
export function promote(heads: ChainHeads): PromotionResult {
  const out: PromotionResult = {
    chainSlug: heads.chainSlug,
    toCanonical: 0,
    toFinal: 0,
    error: heads.error,
  };
  if (heads.latest === null) return out;

  const db = getDb();
  const now = Date.now();
  const canonicalHeight = heads.latest - canonicalDepth(heads.chainSlug);

  // observed -> canonical
  if (canonicalHeight > 0) {
    const b = db
      .prepare(
        `UPDATE usdc_blocks SET status = 'canonical'
          WHERE chain_slug = ? AND status = 'observed' AND block_number <= ?`
      )
      .run(heads.chainSlug, canonicalHeight);
    out.toCanonical = Number(b.changes);

    db.prepare(
      `UPDATE usdc_transfers SET finality = 'canonical'
        WHERE chain_slug = ? AND finality = 'observed' AND removed = 0
          AND block_number IS NOT NULL AND block_number <= ?`
    ).run(heads.chainSlug, canonicalHeight);
  }

  // -> final
  if (heads.finalThreshold !== null && heads.finalThreshold > 0) {
    const b = db
      .prepare(
        `UPDATE usdc_blocks SET status = 'final', finalized_at = ?
          WHERE chain_slug = ? AND status IN ('observed','canonical') AND block_number <= ?`
      )
      .run(now, heads.chainSlug, heads.finalThreshold);
    out.toFinal = Number(b.changes);

    db.prepare(
      `UPDATE usdc_transfers SET finality = 'final'
        WHERE chain_slug = ? AND finality IN ('observed','canonical') AND removed = 0
          AND block_number IS NOT NULL AND block_number <= ?`
    ).run(heads.chainSlug, heads.finalThreshold);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Reorgs                                                              */
/* ------------------------------------------------------------------ */

export interface ReorgOutcome {
  chainSlug: string;
  blockNumber: number;
  transfersReorged: number;
  cctpInvalidated: number;
}

/**
 * Mark everything that came from a block whose hash changed.
 *
 * NOT A DELETE. The rows stay, flagged, for three reasons: deleting would silently
 * change historical figures; the evidence that a reorg happened is itself worth
 * keeping; and a transfer can reappear in the replacement block, in which case the
 * re-scan re-inserts it cleanly under the same (chain, tx, logIndex) key while the
 * orphaned copy remains distinguishable by its block hash.
 *
 * Derived state is invalidated too. A CCTP pairing built on a reorged burn is no
 * longer a pairing, and leaving it completed would report a cross-chain transfer
 * that did not occur.
 */
export function handleReorg(chainSlug: string, blockNumber: number, oldHash: string): ReorgOutcome {
  const db = getDb();
  const now = Date.now();

  const t = db
    .prepare(
      `UPDATE usdc_transfers
          SET removed = 1, finality = 'reorged', reorged_at = ?
        WHERE chain_slug = ? AND block_number = ?
          AND (block_hash = ? OR block_hash IS NULL)
          AND removed = 0`
    )
    .run(now, chainSlug, blockNumber, oldHash);

  // A burn or mint recorded in the orphaned block is no longer an observation, so
  // any completed pairing that rests on it must go back to being unresolved.
  const c = db
    .prepare(
      `UPDATE usdc_cctp_transfers
          SET status = 'burned', dest_tx = NULL, dest_chain = NULL, mint_ts = NULL,
              correlation = 'none'
        WHERE status = 'completed'
          AND (
            (source_chain = ? AND source_tx IN (
               SELECT tx_hash FROM usdc_transfers
                WHERE chain_slug = ? AND block_number = ? AND removed = 1))
            OR
            (dest_chain = ? AND dest_tx IN (
               SELECT tx_hash FROM usdc_transfers
                WHERE chain_slug = ? AND block_number = ? AND removed = 1))
          )`
    )
    .run(chainSlug, chainSlug, blockNumber, chainSlug, chainSlug, blockNumber);

  db.prepare(
    "UPDATE usdc_blocks SET status = 'reorged', reorged_at = ? WHERE chain_slug = ? AND block_number = ? AND block_hash = ?"
  ).run(now, chainSlug, blockNumber, oldHash);

  const outcome: ReorgOutcome = {
    chainSlug,
    blockNumber,
    transfersReorged: Number(t.changes),
    cctpInvalidated: Number(c.changes),
  };

  if (outcome.transfersReorged > 0 || outcome.cctpInvalidated > 0) {
    log.warn("reorg applied — derived intelligence invalidated", {
      chain: outcome.chainSlug,
      block: outcome.blockNumber,
      transfersReorged: outcome.transfersReorged,
      cctpInvalidated: outcome.cctpInvalidated,
    });
  }
  return outcome;
}

/**
 * Re-read the hashes of recent non-final blocks and detect silent reorgs.
 *
 * `recordBlocks` catches a reorg only when a scan happens to re-read the affected
 * range. A reorg in a range we have already passed would otherwise go unnoticed
 * until nothing looked at it again, which for a forward-only cursor is never. This
 * walks back over the not-yet-final window and checks.
 *
 * Bounded per tick, newest first: the shallow blocks are both the most likely to
 * reorg and the cheapest to re-check.
 */
export async function auditRecentBlocks(
  asset: UsdcAsset,
  heads: ChainHeads,
  limit = 12
): Promise<ReorgOutcome[]> {
  if (heads.latest === null) return [];
  const db = getDb();

  const candidates = db
    .prepare(
      `SELECT block_number AS number, block_hash AS hash FROM usdc_blocks
        WHERE chain_slug = ? AND status IN ('observed','canonical')
        ORDER BY block_number DESC LIMIT ?`
    )
    .all(asset.chainSlug, limit) as Array<{ number: number; hash: string }>;

  if (candidates.length === 0) return [];

  const chain = chainRowFor(asset);
  const outcomes: ReorgOutcome[] = [];

  for (const c of candidates) {
    let onChain: string | null = null;
    try {
      const b = await evm.getBlockHashAt(chain, c.number);
      onChain = b;
    } catch {
      // Unreadable is not the same as changed. Skipping leaves the block in its
      // current state for the next audit rather than declaring a reorg on a timeout.
      continue;
    }
    if (onChain === null) continue;

    if (onChain.toLowerCase() !== c.hash.toLowerCase()) {
      outcomes.push(handleReorg(asset.chainSlug, c.number, c.hash));
      // Record the replacement so the next audit compares against the new truth.
      db.prepare(
        `INSERT INTO usdc_blocks (chain_slug, block_number, block_hash, ts, usdc_log_count, status, observed_at)
         VALUES (?,?,?,0,0,'observed',?)
         ON CONFLICT(chain_slug, block_number) DO UPDATE SET
           block_hash = excluded.block_hash, status = 'observed', reorged_at = NULL`
      ).run(asset.chainSlug, c.number, onChain, Date.now());
    }
  }

  return outcomes;
}

/** Run the finality pass for every scanned EVM chain. */
export async function runFinalityPass(keepAlive: () => boolean = () => true): Promise<{
  heads: ChainHeads[];
  promotions: PromotionResult[];
  reorgs: ReorgOutcome[];
}> {
  const heads: ChainHeads[] = [];
  const promotions: PromotionResult[] = [];
  const reorgs: ReorgOutcome[] = [];

  for (const asset of getEvmScanAssets()) {
    if (!keepAlive()) break;
    const h = await readHeads(asset);
    heads.push(h);
    storeHeads(h);
    if (h.error) continue;

    // Audit BEFORE promoting: promoting a block that has actually been reorganised
    // would move it to `final` and make the violation harder to see.
    reorgs.push(...(await auditRecentBlocks(asset, h)));
    promotions.push(promote(h));
  }

  return { heads, promotions, reorgs };
}

export { getUsdcAsset };
