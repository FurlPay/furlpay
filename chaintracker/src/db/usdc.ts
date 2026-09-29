import { getDb } from "./index.js";
import type { CctpCorrelation, CctpTransfer, UsdcTransfer } from "../usdc/types.js";

// ---------------------------------------------------------------------------
// Persistence for USDC intelligence.
//
// EVERY ROW IN HERE CAME FROM A CHAIN. There is no seed data, no fixture path
// and no synthetic insert. `usdc_transfers` is written by the scanner from
// `eth_getLogs` results and by the Solana adapter from Helius, and by nothing
// else — so a row's existence is itself evidence that a transfer was observed.
//
// DEDUPLICATION IS THE DATABASE'S JOB, NOT THE CALLER'S. The UNIQUE index on
// (chain_slug, tx_hash, log_index) plus `ON CONFLICT DO NOTHING` makes an
// overlapping scan window, a replayed block, or a webhook redelivery harmless.
// `insert()` returns whether the row was NEW, which is what stops the same
// transfer being alerted twice.
//
// WHY `source` IS NOT NULLABLE. Every financial figure shown to a user has to
// be traceable to where it came from — `alchemy`, `rpc`, `helius`,
// `circle_cctp`. A row that cannot say which is a row nobody should quote.
// ---------------------------------------------------------------------------

/** Where a row's data actually came from. Recorded on every transfer. */
export type UsdcDataSource = "rpc" | "alchemy" | "helius" | "circle_cctp" | "backfill";

function rowToTransfer(r: Record<string, unknown>): UsdcTransfer & { id: number } {
  return {
    id: r.id as number,
    chainSlug: r.chain_slug as string,
    tokenAddress: r.token_address as string,
    txHash: r.tx_hash as string,
    logIndex: r.log_index as number,
    blockNumber: (r.block_number as number | null) ?? null,
    timestamp: r.ts as number,
    fromAddress: r.from_address as string,
    toAddress: r.to_address as string,
    amount: r.amount as number,
    amountUsd: r.amount_usd as number,
    fromLabel: (r.from_label as string | null) ?? null,
    toLabel: (r.to_label as string | null) ?? null,
    fromCategory: r.from_category as UsdcTransfer["fromCategory"],
    toCategory: r.to_category as UsdcTransfer["toCategory"],
    fromEntity: (r.from_entity as string | null) ?? null,
    toEntity: (r.to_entity as string | null) ?? null,
    classification: r.classification as UsdcTransfer["classification"],
    isWhale: Boolean(r.is_whale),
    isExchange: Boolean(r.is_exchange),
    isCctp: Boolean(r.is_cctp),
    isFurlPay: Boolean(r.is_furlpay),
    cctpNonce: (r.cctp_nonce as string | null) ?? null,
    source: r.source as string,
    explorerUrl: (r.explorer_url as string | null) ?? null,
    alerted: Boolean(r.alerted),
    createdAt: r.created_at as number,
    // Resolved at ingestion. Read here rather than recomputed so the alert path
    // and the daily report cannot disagree about whether a transfer was a relay.
    passThrough: Boolean(r.pass_through),
    passThroughKind: (r.pass_through_kind as UsdcTransfer["passThroughKind"]) ?? null,
    predecessorId: (r.predecessor_id as number | null) ?? null,
    blockHash: (r.block_hash as string | null) ?? null,
    finality: (r.finality as UsdcTransfer["finality"]) ?? "observed",
    removed: Boolean(r.removed),
  };
}

export const usdcDb = {
  /**
   * Store one observed transfer. Returns true when the row was NEW.
   *
   * The boolean is load-bearing: the alerting path only posts rows it inserted,
   * so a rescan of the same block range cannot produce a duplicate alert.
   */
  insert(
    t: UsdcTransfer,
    passThrough: { kind: "reversal" | "hop"; predecessorId: number } | null = null
  ): boolean {
    const r = getDb()
      .prepare(
        `INSERT INTO usdc_transfers (
           chain_slug, token_address, tx_hash, log_index, block_number, ts,
           from_address, to_address, amount, amount_usd,
           from_label, to_label, from_category, to_category, from_entity, to_entity,
           classification, is_whale, is_exchange, is_cctp, is_furlpay,
           cctp_nonce, source, explorer_url, alerted, created_at,
           pass_through, pass_through_kind, predecessor_id,
           block_hash, finality, removed
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(chain_slug, tx_hash, log_index) DO NOTHING`
      )
      .run(
        t.chainSlug,
        t.tokenAddress,
        t.txHash,
        t.logIndex,
        t.blockNumber,
        t.timestamp,
        t.fromAddress,
        t.toAddress,
        t.amount,
        t.amountUsd,
        t.fromLabel,
        t.toLabel,
        t.fromCategory,
        t.toCategory,
        t.fromEntity,
        t.toEntity,
        t.classification,
        t.isWhale ? 1 : 0,
        t.isExchange ? 1 : 0,
        t.isCctp ? 1 : 0,
        t.isFurlPay ? 1 : 0,
        t.cctpNonce,
        t.source,
        t.explorerUrl,
        t.alerted ? 1 : 0,
        t.createdAt,
        passThrough ? 1 : 0,
        passThrough?.kind ?? null,
        passThrough?.predecessorId ?? null,
        t.blockHash ?? null,
        t.finality ?? "observed",
        t.removed ? 1 : 0
      );
    return Number(r.changes) > 0;
  },

  /** Transfers observed but not yet posted, largest first. */
  pendingAlerts(limit = 20): Array<UsdcTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        // removed = 0 on every read that feeds a figure or an alert. A reorged
        // transfer did not happen on the chain that exists, so alerting on it would
        // publish a movement that is not there.
        `SELECT * FROM usdc_transfers WHERE alerted = 0 AND removed = 0
          ORDER BY is_furlpay DESC, amount_usd DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToTransfer);
  },

  /**
   * Record that these rows were POSTED to Discord.
   *
   * `posted_at` is the audit trail: it is the only thing that distinguishes a
   * message the channel actually sent from a row that was merely handled.
   * Without it, "did we report this movement twice?" cannot be answered, because
   * suppressed and retired rows carry the same `alerted` flag.
   */
  markPosted(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const stmt = getDb().prepare(
      "UPDATE usdc_transfers SET alerted = 1, posted_at = ? WHERE id = ?"
    );
    for (const id of ids) stmt.run(now, id);
  },

  /** Retained for callers that only need the "do not reconsider" flag. */
  markAlerted(ids: readonly number[]): void {
    this.markPosted(ids);
  },

  /**
   * Suppress an observed transfer from alerting without deleting it.
   *
   * Used for rows that are real but not worth posting — below threshold, an
   * internal rebalance, or a leg of a movement already reported. They stay in the
   * table because the daily aggregate is computed from ALL observed transfers, not
   * only the posted ones.
   *
   * The reason is stored, not just the flag. A suppressed nine-figure transfer has
   * to be explicable after the fact, and "why did this not appear in the channel"
   * is otherwise unanswerable.
   */
  markSuppressed(entries: readonly { id: number; reason: string }[]): void {
    if (entries.length === 0) return;
    const stmt = getDb().prepare(
      "UPDATE usdc_transfers SET alerted = 1, suppressed_reason = ? WHERE id = ?"
    );
    for (const e of entries) stmt.run(e.reason.slice(0, 120), e.id);
  },

  /**
   * Rows above a floor that have never been assessed for being relayed money.
   *
   * WHY THIS IS NEEDED ONCE. `pass_through` was added by migration 0014, so every
   * row ingested before it defaults to 0 — indistinguishable from "checked and
   * found independent". The daily report reads a rolling 24h window, so until that
   * window rolls past the migration the reconciliation silently under-deducts
   * relays and overstates money moving between distinct parties. `usdc
   * reclassify-relays` walks these once.
   *
   * `predecessor_id IS NULL AND pass_through = 0` is the "never assessed" marker: a
   * row the scanner checked and cleared also has both, so the walk is idempotent
   * rather than exactly-once — re-running it simply re-confirms.
   */
  unassessedForRelay(
    floorUsd: number,
    sinceMs: number,
    limit: number,
    /**
     * Keyset cursor: the highest id already walked.
     *
     * Paging on id rather than OFFSET, and NOT relying on the filter to shrink. A
     * row assessed and found independent is left unmarked — deliberately, since a
     * sentinel would need special-casing everywhere predecessor_id is read — so the
     * filter alone returns the same clear rows on every pass and a naive loop spins
     * forever, inflating its own progress count.
     */
    afterId = 0
  ): Array<UsdcTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_transfers
          WHERE ts >= ? AND removed = 0 AND amount_usd >= ? AND pass_through = 0 AND id > ?
          ORDER BY id ASC LIMIT ?`
      )
      .all(sinceMs, floorUsd, afterId, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToTransfer);
  },

  /** Record a relay decision on an existing row. */
  markPassThrough(id: number, kind: "reversal" | "hop", predecessorId: number): void {
    getDb()
      .prepare(
        `UPDATE usdc_transfers
            SET pass_through = 1, pass_through_kind = ?, predecessor_id = ?
          WHERE id = ?`
      )
      .run(kind, predecessorId, id);
  },

  /**
   * Delete rows whose timestamp cannot be real.
   *
   * Used by `usdc repair`. These are not recoverable — a row with a corrupt time
   * cannot be re-dated without re-reading the chain, and it poisons every windowed
   * figure it appears in. Deleting lets the scanner re-ingest the block cleanly,
   * since the UNIQUE key is (chain, tx, log_index) and not the timestamp.
   */
  deleteImpossibleTimestamps(now = Date.now()): number {
    const r = getDb()
      .prepare("DELETE FROM usdc_transfers WHERE ts > ? OR ts < 1420070400000")
      .run(now + 60 * 60 * 1000);
    return Number(r.changes);
  },

  /**
   * Transfers actually posted in a window, largest first.
   *
   * The audit view: what the channel claimed, and nothing else.
   *
   * DELIBERATELY NOT filtered on `removed`. Every other read excludes reorged rows,
   * but this one is the record of what was published — and an alert that was posted
   * and later reorganised away is exactly what an auditor needs to be able to find.
   */
  postedSince(sinceMs: number, limit = 50): Array<UsdcTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_transfers WHERE posted_at >= ?
          ORDER BY amount_usd DESC LIMIT ?`
      )
      .all(sinceMs, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToTransfer);
  },

  countSince(sinceMs: number): number {
    const r = getDb()
      .prepare("SELECT COUNT(*) AS n FROM usdc_transfers WHERE ts >= ? AND removed = 0")
      .get(sinceMs) as { n: number };
    return r.n;
  },

  /** Everything observed in a window, for the daily roll-up. */
  since(sinceMs: number): Array<UsdcTransfer & { id: number }> {
    const rows = getDb()
      .prepare("SELECT * FROM usdc_transfers WHERE ts >= ? AND removed = 0 ORDER BY ts DESC")
      .all(sinceMs) as Array<Record<string, unknown>>;
    return rows.map(rowToTransfer);
  },

  /** Per-chain volume in a window. */
  volumeByChain(sinceMs: number): Array<{ chainSlug: string; volumeUsd: number; count: number }> {
    return getDb()
      .prepare(
        `SELECT chain_slug AS chainSlug, SUM(amount_usd) AS volumeUsd, COUNT(*) AS count
           FROM usdc_transfers WHERE ts >= ? AND removed = 0
          GROUP BY chain_slug ORDER BY volumeUsd DESC`
      )
      .all(sinceMs) as Array<{ chainSlug: string; volumeUsd: number; count: number }>;
  },

  /**
   * Exchange flows in a window, from LABELLED addresses only.
   *
   * The restriction is the point, and the embed says so: an unlabelled exchange
   * wallet is invisible here, so this is a floor on exchange activity rather
   * than a measurement of it.
   */
  exchangeFlows(sinceMs: number): Array<{ chainSlug: string; inflowUsd: number; outflowUsd: number; inflowCount: number; outflowCount: number }> {
    return getDb()
      .prepare(
        `SELECT chain_slug AS chainSlug,
                SUM(CASE WHEN classification='EXCHANGE_DEPOSIT'    THEN amount_usd ELSE 0 END) AS inflowUsd,
                SUM(CASE WHEN classification='EXCHANGE_WITHDRAWAL' THEN amount_usd ELSE 0 END) AS outflowUsd,
                SUM(CASE WHEN classification='EXCHANGE_DEPOSIT'    THEN 1 ELSE 0 END) AS inflowCount,
                SUM(CASE WHEN classification='EXCHANGE_WITHDRAWAL' THEN 1 ELSE 0 END) AS outflowCount
           FROM usdc_transfers
          WHERE ts >= ? AND removed = 0
            AND classification IN ('EXCHANGE_DEPOSIT','EXCHANGE_WITHDRAWAL')
          GROUP BY chain_slug`
      )
      .all(sinceMs) as Array<{
      chainSlug: string;
      inflowUsd: number;
      outflowUsd: number;
      inflowCount: number;
      outflowCount: number;
    }>;
  },

  /**
   * The leg that fed this one, if there is one.
   *
   * Finds an earlier transfer of the same amount whose RECIPIENT is this
   * transfer's SENDER — i.e. this transfer is passing along money that just
   * arrived. That one condition catches both inflation patterns observed live:
   *
   *   ROUND TRIP        A -> B then B -> A for the same amount. The second leg's
   *                     sender is the first leg's recipient, so it matches. When
   *                     the predecessor's sender is also this transfer's
   *                     recipient, it is a there-and-back and nothing moved.
   *
   *   HOP CHAIN         A -> B -> C -> D, each hop a separate transaction for the
   *                     same amount. Each leg after the first matches its
   *                     predecessor.
   *
   * WHY THIS WAS NEEDED, measured in the first two live ticks that posted to
   * Discord — every one of these read as a legitimate whale alert on its own:
   *
   *   $243,777,790  0xf1ed… <-> 0x3117…, two transactions          reported 2x
   *   $228,105,276  0xbbbb… <-> 0x30cc…, ONE transaction           reported 2x
   *                 (log #2774 and #2792 — a flash loan)
   *   $24,400,000   Coinbase Prime -> 0x16f6… -> 0x3284… -> 0xee7a… reported 3x
   *   $9,999,999    Circle issuance -> 0xe69f… -> 0xee7a… -> …      reported 4x
   *
   * The $24.4M chain alone claimed $73.2M of movement for one withdrawal.
   *
   * `isReversal` lets the caller tell the reader which pattern it was, because
   * "nothing moved" and "this is the same money continuing onward" are different
   * facts about the same suppression.
   *
   * WHAT THIS DELIBERATELY DOES NOT SUPPRESS. One sender fanning out to several
   * recipients — 0x5695… sent $175.6M to two different addresses in that same tick
   * — has no predecessor feeding each leg, so both still post. Those are two real
   * movements and suppressing them would under-report.
   */
  precedingLeg(
    t: {
      chainSlug: string;
      fromAddress: string;
      toAddress: string;
      amountUsd: number;
      timestamp: number;
      id?: number;
    },
    windowMs: number
  ): { id: number; txHash: string; fromAddress: string; isReversal: boolean } | null {
    // Amounts are compared with a tolerance rather than exactly: money passing
    // through a pool or a fee-bearing hop arrives very nearly, not exactly, whole.
    const lo = t.amountUsd * 0.995;
    const hi = t.amountUsd * 1.005;

    // NO lower() ON EITHER SIDE, and that is a correctness point as well as a
    // performance one.
    //
    // PERFORMANCE: `lower(to_address)` cannot use idx_usdc_to_addr, so SQLite fell
    // back to idx_usdc_chain_ts and scanned the chain's entire window — on
    // Ethereum roughly 500,000 rows — once per alert candidate, up to 48 times a
    // tick. Confirmed with EXPLAIN QUERY PLAN: with lower() it reports
    // "SEARCH USING INDEX idx_usdc_chain_ts (chain_slug=? AND ts>? AND ts<?)";
    // without it, "SEARCH USING INDEX idx_usdc_to_addr (to_address=? ...)".
    //
    // CORRECTNESS: EVM addresses are already lowercased at ingestion — measured 0
    // of 722,091 stored rows carry a non-lowercase EVM address. The only
    // non-lowercase addresses are the 93 Solana ones, where base58 IS
    // case-sensitive and folding case could match a DIFFERENT valid account that
    // happens to differ only in case. So exact comparison is the right comparison
    // on both chain families.
    const row = getDb()
      .prepare(
        `SELECT id, tx_hash AS txHash, from_address AS fromAddress
           FROM usdc_transfers
          WHERE chain_slug = ?
            AND to_address = ?
            AND amount_usd BETWEEN ? AND ?
            AND ts BETWEEN ? AND ?
            AND (? IS NULL OR id != ?)
            -- A reorged leg never happened, so it must not suppress a live transfer
            -- as its predecessor.
            AND removed = 0
          ORDER BY ts ASC, id ASC LIMIT 1`
      )
      .get(
        t.chainSlug,
        // The predecessor's RECIPIENT is this transfer's SENDER.
        t.fromAddress,
        lo,
        hi,
        t.timestamp - windowMs,
        // A predecessor must not be in this transfer's future. The small forward
        // slack absorbs two legs sharing a block timestamp, which is exactly what
        // a flash loan's two legs do.
        t.timestamp + 1_000,
        t.id ?? null,
        t.id ?? null
      ) as { id: number; txHash: string; fromAddress: string } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      txHash: row.txHash,
      fromAddress: row.fromAddress,
      // Exact comparison, for the same reason the query above uses one: folding
      // case would let two different Solana accounts read as the same party.
      isReversal: row.fromAddress === t.toAddress,
    };
  },

  /**
   * Finality breakdown over a window.
   *
   * WHY THE REPORT NEEDS THIS. A figure computed from `observed` rows is provisional
   * — measured finality lag is 83 blocks on Ethereum and 4,127 on Arbitrum, so the
   * newest data is routinely not yet settled. Stating how much of a total rests on
   * unfinalised data is the difference between a number and a number you can act on.
   */
  finalityBreakdown(sinceMs: number): {
    observed: { count: number; usd: number };
    canonical: { count: number; usd: number };
    final: { count: number; usd: number };
    reorged: { count: number; usd: number };
  } {
    const rows = getDb()
      .prepare(
        `SELECT finality, COUNT(*) AS count, COALESCE(SUM(amount_usd),0) AS usd
           FROM usdc_transfers WHERE ts >= ? GROUP BY finality`
      )
      .all(sinceMs) as Array<{ finality: string; count: number; usd: number }>;

    const out = {
      observed: { count: 0, usd: 0 },
      canonical: { count: 0, usd: 0 },
      final: { count: 0, usd: 0 },
      reorged: { count: 0, usd: 0 },
    };
    for (const r of rows) {
      const k = r.finality as keyof typeof out;
      if (out[k]) out[k] = { count: r.count, usd: r.usd };
    }
    return out;
  },

  /**
   * Dollar volume in a window that is money being RELAYED rather than moved.
   *
   * Reads the flag resolved at ingestion — see migration 0014 for why it is stored
   * rather than recomputed. The equivalent read-time aggregate did not finish in
   * two minutes over 722,091 rows.
   *
   * `belowFloorUsd` is the honest residual: volume from transfers too small to have
   * been checked, which therefore MAY contain undetected relays. Reported rather
   * than absorbed, so the reconciliation states its own bound.
   */
  passThroughSince(
    sinceMs: number,
    floorUsd: number
  ): { count: number; volumeUsd: number; belowFloorUsd: number; belowFloorCount: number } {
    const hit = getDb()
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_usd), 0) AS volumeUsd
           FROM usdc_transfers WHERE ts >= ? AND removed = 0 AND pass_through = 1`
      )
      .get(sinceMs) as { count: number; volumeUsd: number };

    const below = getDb()
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_usd), 0) AS volumeUsd
           FROM usdc_transfers WHERE ts >= ? AND removed = 0 AND amount_usd < ?`
      )
      .get(sinceMs, floorUsd) as { count: number; volumeUsd: number };

    return {
      count: hit.count ?? 0,
      volumeUsd: hit.volumeUsd ?? 0,
      belowFloorUsd: below.volumeUsd ?? 0,
      belowFloorCount: below.count ?? 0,
    };
  },

  /**
   * Suppress rows that are too old to be worth posting.
   *
   * WHY A REALTIME CHANNEL NEEDS THIS. `pendingAlerts` orders by size, and a busy
   * hour produces far more threshold-crossing transfers than the per-tick cap can
   * post — measured: 804 unalerted transfers above a $1M floor after a single
   * backfill, against a cap of 6 per tick. Without a cutoff the queue never drains
   * and the channel posts progressively staler "realtime" alerts, largest first,
   * forever.
   *
   * So anything older than the freshness window is marked as handled without being
   * posted. It stays in the table and still counts in every aggregate — the daily
   * roll-up is computed from all observed transfers, not the posted ones.
   *
   * Returns how many were retired.
   */
  retireStale(olderThanMs: number): number {
    const r = getDb()
      .prepare(
        `UPDATE usdc_transfers
            SET alerted = 1, suppressed_reason = 'too stale to post as realtime'
          WHERE alerted = 0 AND ts < ?`
      )
      .run(olderThanMs);
    return Number(r.changes);
  },

  /** Transfers involving a specific address — for a user's own wallet view. */
  /**
   * Transfers involving a specific address.
   *
   * Takes the address as stored. Lowercasing the caller's input would break Solana
   * lookups outright — a base58 account folded to lower case matches nothing — and
   * indexing `lower(from_address)` is what made precedingLeg scan whole windows.
   * EVM callers should pass a lowercase address; `normaliseAddressFor` exists so
   * they do not have to remember which family they are on.
   */
  forAddress(address: string, limit = 25): Array<UsdcTransfer & { id: number }> {
    const a = address.trim();
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_transfers
          WHERE (from_address = ? OR to_address = ?) AND removed = 0
          ORDER BY ts DESC LIMIT ?`
      )
      .all(a, a, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToTransfer);
  },
};

/* ------------------------------------------------------------------ */
/* CCTP                                                               */
/* ------------------------------------------------------------------ */

// Correlating a burn to its mint is the single most consequential join in this
// schema. Get it wrong in one direction and a $10M cross-chain transfer is
// counted as $20M of movement; get it wrong in the other and two unrelated
// transfers are merged into one that never happened.
//
// CCTP V2 makes it harder than V1 did, because the nonce that joins the two legs
// is assigned off chain by Circle rather than emitted by the source contract. So
// a burn is stored the moment it is seen, under a deliberately synthetic
// `pending:` key, and acquires its real nonce later. `correlation` records which
// evidence produced the final join, and nothing reads a completed row without
// being able to see that.

function rowToCctp(r: Record<string, unknown>): CctpTransfer & { id: number } {
  return {
    id: r.id as number,
    sourceChain: r.source_chain as string,
    sourceTx: r.source_tx as string,
    sourceDomain: r.source_domain as number,
    destChain: (r.dest_chain as string | null) ?? null,
    destTx: (r.dest_tx as string | null) ?? null,
    destDomain: r.dest_domain as number,
    nonce: r.nonce as string,
    sender: r.sender as string,
    recipient: r.recipient as string,
    amount: r.amount as number,
    feeUsdc: (r.fee_usdc as number | null) ?? null,
    finalityExecuted: (r.finality_executed as number | null) ?? null,
    burnTs: r.burn_ts as number,
    mintTs: (r.mint_ts as number | null) ?? null,
    status: r.status as CctpTransfer["status"],
    correlation: (r.correlation as CctpCorrelation) ?? "none",
    cctpVersion: (r.cctp_version as 1 | 2) ?? 2,
    alerted: Boolean(r.alerted),
  };
}

export const cctpDb = {
  /**
   * Record a burn. Returns true when this (domain, nonce) pair was new.
   *
   * `matchKey` is stored alongside so the destination side can find this row
   * without Circle's nonce — see `completeMint`.
   */
  insertBurn(c: CctpTransfer, matchKey: string | null = null): boolean {
    const r = getDb()
      .prepare(
        `INSERT INTO usdc_cctp_transfers (
           source_chain, source_tx, source_domain, dest_chain, dest_tx, dest_domain,
           nonce, sender, recipient, amount, burn_ts, mint_ts, status,
           correlation, cctp_version, fee_usdc, finality_executed, match_key, alerted
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(source_domain, nonce) DO NOTHING`
      )
      .run(
        c.sourceChain,
        c.sourceTx,
        c.sourceDomain,
        c.destChain,
        c.destTx,
        c.destDomain,
        c.nonce,
        c.sender,
        c.recipient,
        c.amount,
        c.burnTs,
        c.mintTs,
        c.status,
        c.correlation,
        c.cctpVersion,
        c.feeUsdc,
        c.finalityExecuted,
        matchKey
      );
    return Number(r.changes) > 0;
  },

  /**
   * Burns still waiting for Circle to assign a nonce.
   *
   * Ordered by least-recently-attempted so one permanently unattestable burn —
   * an under-funded fast transfer, say — cannot starve every burn behind it.
   * `attest_last_at IS NULL` sorts first under SQLite's ordering, which is what
   * we want: never-tried before tried-and-failed.
   */
  pendingAttestation(limit = 15): Array<CctpTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_cctp_transfers
          WHERE correlation = 'none' AND nonce LIKE 'pending:%'
          ORDER BY attest_last_at ASC, burn_ts ASC
          LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToCctp);
  },

  /** Note that we asked Iris about a row, whether or not it answered. */
  markAttestAttempt(id: number): void {
    getDb()
      .prepare(
        `UPDATE usdc_cctp_transfers
            SET attest_attempts = attest_attempts + 1, attest_last_at = ?
          WHERE id = ?`
      )
      .run(Date.now(), id);
  },

  /**
   * Replace a burn's pending key with the nonce Circle assigned.
   *
   * Returns false if the real nonce is already on another row — which happens
   * when the same burn was ingested twice under two different pending keys, for
   * instance after a reorg changed its log index. The UNIQUE constraint catches
   * it; swallowing that specific conflict is correct because the other row is
   * the same transfer and is already keyed properly.
   */
  assignNonce(id: number, nonce: string, feeUsdc: number | null): boolean {
    try {
      const r = getDb()
        .prepare(
          `UPDATE usdc_cctp_transfers
              SET nonce = ?, correlation = 'iris_nonce', fee_usdc = COALESCE(?, fee_usdc)
            WHERE id = ? AND nonce LIKE 'pending:%'`
        )
        .run(nonce.toLowerCase(), feeUsdc, id);
      return Number(r.changes) > 0;
    } catch {
      // Duplicate nonce: the authoritative row already exists. Drop this
      // placeholder so the poller stops retrying it forever.
      getDb()
        .prepare("DELETE FROM usdc_cctp_transfers WHERE id = ? AND nonce LIKE 'pending:%'")
        .run(id);
      return false;
    }
  },

  /**
   * Attach a destination mint to its burn — the join that turns two on-chain
   * events into one economic transfer.
   *
   * Tries the authoritative key first, then the heuristic one. The order is the
   * whole point: a nonce match is proof, a match key is strong inference, and a
   * row must never claim the stronger of the two.
   *
   * Returns true when a burn was actually completed. A mint with no matching burn
   * returns false and is deliberately NOT stored as a half-transfer — we would
   * have no source chain, no sender and no burn time for it, and a row like that
   * pollutes every aggregate that touches it.
   */
  completeMint(m: {
    nonce: string;
    sourceDomain: number;
    destChain: string;
    destTx: string;
    mintTs: number;
    finalityExecuted: number | null;
    matchKey: string;
    heuristicWindowMs: number;
    /**
     * The fee CCTP actually took, from the destination's MintAndWithdraw event.
     * Recorded here rather than on the burn because the burn only knows the
     * maximum fee it authorised, not what was charged.
     */
    feeUsdc?: number | null;
  }): boolean {
    const db = getDb();

    const byNonce = db
      .prepare(
        `UPDATE usdc_cctp_transfers
            SET dest_tx = ?, dest_chain = ?, mint_ts = ?, status = 'completed',
                correlation = 'iris_nonce', finality_executed = ?,
                fee_usdc = COALESCE(?, fee_usdc)
          WHERE source_domain = ? AND nonce = ? AND status != 'completed'`
      )
      .run(
        m.destTx,
        m.destChain,
        m.mintTs,
        m.finalityExecuted,
        m.feeUsdc ?? null,
        m.sourceDomain,
        m.nonce.toLowerCase()
      );
    if (Number(byNonce.changes) > 0) return true;

    // Fallback. Scoped to still-open burns inside the window, oldest first, so
    // repeated identical transfers are consumed in the order they were made
    // rather than the newest swallowing an older burn's mint.
    const candidate = db
      .prepare(
        `SELECT id FROM usdc_cctp_transfers
          WHERE match_key = ? AND source_domain = ? AND status = 'burned'
            AND burn_ts >= ? AND burn_ts <= ?
          ORDER BY burn_ts ASC LIMIT 1`
      )
      .get(m.matchKey, m.sourceDomain, m.mintTs - m.heuristicWindowMs, m.mintTs + 60_000) as
      | { id: number }
      | undefined;

    if (!candidate) return false;

    const byKey = db
      .prepare(
        `UPDATE usdc_cctp_transfers
            SET dest_tx = ?, dest_chain = ?, mint_ts = ?, status = 'completed',
                correlation = 'heuristic', finality_executed = ?,
                fee_usdc = COALESCE(?, fee_usdc)
          WHERE id = ? AND status = 'burned'`
      )
      .run(
        m.destTx,
        m.destChain,
        m.mintTs,
        m.finalityExecuted,
        m.feeUsdc ?? null,
        candidate.id
      );
    return Number(byKey.changes) > 0;
  },

  /** Completed transfers not yet posted, largest first. */
  pendingAlerts(limit = 10): Array<CctpTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_cctp_transfers
          WHERE alerted = 0 AND status = 'completed'
          ORDER BY amount DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToCctp);
  },

  markAlerted(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const stmt = getDb().prepare("UPDATE usdc_cctp_transfers SET alerted = 1 WHERE id = ?");
    for (const id of ids) stmt.run(id);
  },

  /**
   * CCTP volume in a window, counted ONCE per economic transfer.
   *
   * Only completed transfers are counted. An in-flight burn has moved USDC out of
   * the source chain but the transfer is not finished, and counting it would make
   * the figure depend on when the window happened to close.
   *
   * `inflight` is reported alongside rather than folded in, because "how much is
   * mid-flight" is genuinely interesting and hiding it inside the total is how
   * the double-count gets reintroduced.
   */
  volumeSince(sinceMs: number): {
    count: number;
    volumeUsd: number;
    inflightCount: number;
    inflightUsd: number;
    heuristicCount: number;
    feesUsd: number;
  } {
    const r = getDb()
      .prepare(
        `SELECT
           SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)          AS count,
           COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END), 0) AS volumeUsd,
           SUM(CASE WHEN status='burned' THEN 1 ELSE 0 END)             AS inflightCount,
           COALESCE(SUM(CASE WHEN status='burned' THEN amount ELSE 0 END), 0)    AS inflightUsd,
           SUM(CASE WHEN correlation='heuristic' THEN 1 ELSE 0 END)     AS heuristicCount,
           COALESCE(SUM(fee_usdc), 0)                                   AS feesUsd
         FROM usdc_cctp_transfers WHERE burn_ts >= ?`
      )
      .get(sinceMs) as Record<string, number | null>;

    return {
      count: r.count ?? 0,
      volumeUsd: r.volumeUsd ?? 0,
      inflightCount: r.inflightCount ?? 0,
      inflightUsd: r.inflightUsd ?? 0,
      heuristicCount: r.heuristicCount ?? 0,
      feesUsd: r.feesUsd ?? 0,
    };
  },

  /** Completed cross-chain lanes in a window, busiest first. */
  lanesSince(
    sinceMs: number,
    limit = 8
  ): Array<{ sourceChain: string; destChain: string | null; count: number; volumeUsd: number }> {
    return getDb()
      .prepare(
        `SELECT source_chain AS sourceChain, dest_chain AS destChain,
                COUNT(*) AS count, SUM(amount) AS volumeUsd
           FROM usdc_cctp_transfers
          WHERE burn_ts >= ? AND status = 'completed'
          GROUP BY source_chain, dest_chain
          ORDER BY volumeUsd DESC LIMIT ?`
      )
      .all(sinceMs, limit) as Array<{
      sourceChain: string;
      destChain: string | null;
      count: number;
      volumeUsd: number;
    }>;
  },

  recentCompleted(sinceMs: number, limit = 50): Array<CctpTransfer & { id: number }> {
    const rows = getDb()
      .prepare(
        `SELECT * FROM usdc_cctp_transfers
          WHERE burn_ts >= ? AND status = 'completed'
          ORDER BY burn_ts DESC LIMIT ?`
      )
      .all(sinceMs, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToCctp);
  },
};
