// Domain types for the Bitcoin mempool surface and the threat feed.
//
// The type that carries the most meaning here is `Discovery`. Bitcoin whale
// transactions reach us two ways, and the two are NOT interchangeable:
//
//   "block"   — every transaction in a block was enumerated, so the set of
//               whales in that block is complete and a count is a real count.
//   "mempool" — sampled from /mempool/recent, which exposes only the ten most
//               recent entries. Measured against blockstream.info on
//               2026-09-08: at a 2s poll, 8 of 29 polls returned ten entirely
//               new txids, i.e. the window had already overflowed. So the
//               sample misses transactions, and it misses them systematically
//               (whatever arrived earliest inside a refresh window), not at
//               random.
//
// Every count derived from mempool discovery is therefore a floor. The embeds
// say so in words rather than printing it as a total.

export type Discovery = "block" | "mempool";

/** A reading of Bitcoin network state at one instant. */
export interface NetworkSnapshot {
  ts: number;
  tipHeight: number | null;
  /** Transactions currently waiting. */
  mempoolCount: number | null;
  mempoolVsize: number | null;
  /** Total fees offered by everything waiting, in satoshis. */
  mempoolTotalFee: number | null;
  fees: {
    fastest: number | null;
    halfHour: number | null;
    hour: number | null;
    economy: number | null;
    minimum: number | null;
  };
  /** How many blocks it would take to clear the current backlog. */
  projectedBlocks: number | null;
  difficultyChangePct: number | null;
  difficultyProgressPct: number | null;
  /** Unix ms of the estimated next retarget. */
  retargetEta: number | null;
  /** Hashes per second. */
  hashrate: number | null;
  priceUsd: number | null;
  /** Which hosts actually answered — provenance for every number above. */
  sources: string[];
}

/** A Bitcoin transaction large enough to be worth naming. */
export interface BtcWhaleTx {
  txid: string;
  firstSeen: number;
  /** Sum of outputs, in satoshis — the figure block explorers show as "value". */
  valueSats: number;
  feeSats: number | null;
  vsize: number | null;
  nIn: number | null;
  nOut: number | null;
  /** Largest single input address, the closest thing a UTXO tx has to a sender. */
  topInAddr: string | null;
  topInSats: number | null;
  topOutAddr: string | null;
  topOutSats: number | null;
  /**
   * True when the largest output pays an address that also funded the inputs.
   * A consolidation or a change-heavy sweep is not somebody moving money to
   * somebody else, and calling one a "whale transfer" would be a lie of framing.
   */
  selfSpend: boolean;
  blockHeight: number | null;
  blockTime: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  discovery: Discovery;
  /** An address on the transaction appears on the OFAC list. */
  sanctioned: boolean;
  sanctionedAddr: string | null;
}

/** The outcome of enumerating one block. */
export interface BlockScan {
  height: number;
  hash: string;
  blockTime: number;
  txCount: number;
  txsWalked: number;
  whalesFound: number;
  requests: number;
  durationMs: number;
  /** False when the walk was cut short — the block's whale set is then partial. */
  complete: boolean;
  scannedAt: number;
}

/** A published security incident, as the upstream dataset describes it. */
export interface HackIncident {
  /** name + date, the dataset's own identity. Re-fetching never re-alerts. */
  key: string;
  name: string;
  ts: number;
  amountUsd: number | null;
  classification: string | null;
  technique: string | null;
  chains: string[];
  targetType: string | null;
  bridgeHack: boolean;
  returnedFunds: number | null;
  sourceUrl: string | null;
  firstSeen: number;
}

/** Severity bands for incident alerts, by reported loss. */
export type Severity = "critical" | "major" | "notable" | "minor";

export function severityOf(amountUsd: number | null): Severity {
  if (amountUsd === null || !Number.isFinite(amountUsd)) return "minor";
  if (amountUsd >= 50_000_000) return "critical";
  if (amountUsd >= 5_000_000) return "major";
  if (amountUsd >= 500_000) return "notable";
  return "minor";
}
