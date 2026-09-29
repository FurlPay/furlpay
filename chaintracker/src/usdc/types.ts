// Core types for the USDC Movement Tracker.
//
// A USDC transfer is never accepted merely on symbol == "USDC" — it must
// match the verified native contract or mint address for that chain.

import type { AddressCategory } from "../types/index.js";

export type UsdcClassification =
  | "WHALE_TRANSFER"
  | "EXCHANGE_DEPOSIT"
  | "EXCHANGE_WITHDRAWAL"
  | "BRIDGE_TRANSFER"
  | "CCTP_TRANSFER"
  | "TREASURY_TRANSFER"
  | "MINT"
  | "BURN"
  | "DEX_TRANSFER"
  | "FURLPAY_TRANSFER"
  | "INTERNAL_REBALANCE"
  | "LIKELY_PAYMENT"
  | "RAW_TRANSFER"
  | "UNKNOWN";

export type UsdcWhaleTier = "fish" | "dolphin" | "shark" | "whale" | "humpback" | "mega" | "titan";

export interface UsdcTierInfo {
  tier: UsdcWhaleTier;
  minUsd: number;
  label: string;
  glyph: string;
  color: number;
}

export interface UsdcAsset {
  chainSlug: string;
  chainName: string;
  chainId: number | null;
  /** Transaction model. Drives which scanner handles the chain. */
  kind: "evm" | "solana";
  contractOrMint: string;
  decimals: number;
  isNative: boolean;
  circleVerified: boolean;
  /** null means the chain has native USDC but no CCTP deployment (e.g. Celo). */
  cctpDomain: number | null;
  explorerUrl: string;
  txUrlPrefix: string;
  addressUrlPrefix: string;
  alchemySubdomain: string | null;
  publicRpc: string[];
  /**
   * Whether a scanner actually reads this chain. False means the contract is
   * trusted but no logs are being read, and `doctor` must say so rather than
   * implying coverage.
   */
  scan: boolean;
}

export interface UsdcTransfer {
  chainSlug: string;
  tokenAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: number | null;
  timestamp: number; // ms epoch
  fromAddress: string;
  toAddress: string;
  amount: number; // token units
  amountUsd: number;
  fromLabel: string | null;
  toLabel: string | null;
  fromCategory: AddressCategory;
  toCategory: AddressCategory;
  fromEntity: string | null;
  toEntity: string | null;
  classification: UsdcClassification;
  isWhale: boolean;
  isExchange: boolean;
  isCctp: boolean;
  isFurlPay: boolean;
  cctpNonce: string | null;
  source: string;
  explorerUrl: string | null;
  alerted: boolean;
  createdAt: number;
  /**
   * True when this transfer is money being relayed onward rather than moved — its
   * sender received the same amount moments earlier. Resolved once at ingestion so
   * the alert path and the daily reconciliation read the same decision.
   */
  passThrough?: boolean;
  /** "reversal" = a there-and-back; "hop" = a link in a relay chain. */
  passThroughKind?: "reversal" | "hop" | null;
  /** The leg that fed this one, so a suppression can be audited. */
  predecessorId?: number | null;
  /**
   * The hash of the block this transfer came from.
   *
   * How a reorg is applied: transfers are invalidated by matching block hash, so a
   * replayed block's replacement rows stay distinguishable from the orphaned ones.
   * Null on rows predating migration 0016.
   */
  blockHash?: string | null;
  /**
   * observed -> canonical -> final, or reorged.
   *
   * Pre-0016 rows read as 'observed', which is honest: it is what was known about
   * them. Back-dating them to 'final' would assert a check that never happened.
   */
  finality?: "observed" | "canonical" | "final" | "reorged";
  /** True when the block was reorganised away. The row is kept, not deleted. */
  removed?: boolean;
}

/**
 * How a burn was matched to its mint. Stored on the row so a figure quoted from
 * this table can always be traced back to the evidence that produced it.
 *
 *   iris_nonce   Circle's attestation service returned the nonce for the burn
 *                tx, and the destination MessageReceived carried the same one.
 *                Authoritative.
 *   heuristic    Matched on (sourceDomain, destDomain, amount, mintRecipient)
 *                inside a time window because Iris was unreachable. Good, not
 *                proof — reported as such.
 *   none         Not yet matched.
 */
export type CctpCorrelation = "iris_nonce" | "heuristic" | "none";

export interface CctpTransfer {
  sourceChain: string;
  sourceTx: string;
  sourceDomain: number;
  destChain: string | null;
  destTx: string | null;
  destDomain: number;
  /**
   * The CCTP V2 nonce: a bytes32 hex string assigned by Circle's attestation
   * service, NOT a number and NOT present in the source-chain event. V1 used a
   * uint64 emitted on the source chain; V2 does not, which is why this is a
   * string and why an unattested burn carries a synthetic pending key instead.
   */
  nonce: string;
  sender: string;
  recipient: string;
  amount: number;
  /** CCTP V2 fee taken by a fast transfer, in USDC. null when not known yet. */
  feeUsdc: number | null;
  /** 1000 = fast, 2000 = standard. null until the mint is seen. */
  finalityExecuted: number | null;
  burnTs: number;
  mintTs: number | null;
  status: "burned" | "minted" | "completed";
  correlation: CctpCorrelation;
  cctpVersion: 1 | 2;
  alerted: boolean;
}

export interface ExchangeFlowSummary {
  chainSlug: string;
  chainName: string;
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  inflowCount: number;
  outflowCount: number;
}

export interface DailyUsdcMetrics {
  dateUtc: string; // YYYY-MM-DD
  totalVolumeUsd: number;
  totalTransfers: number;
  chainsActive: number;
  whaleTransfers: number;
  whaleVolumeUsd: number;
  largestTransferUsd: number;
  largestTransferChain: string | null;
  largestTransferHash: string | null;
  exchangeInflowUsd: number;
  exchangeOutflowUsd: number;
  cctpVolumeUsd: number;
  furlpayVolumeUsd: number;
  paymentVolumeUsd: number;
  rebalanceVolumeUsd: number;
  chainBreakdown: Record<string, { volumeUsd: number; transfers: number; whales: number }>;
  updatedAt: number;
}

export interface TrackedWallet {
  chainSlug: string;
  address: string;
  label: string;
  walletType:
    | "furlpay_treasury"
    | "furlpay_settlement"
    | "furlpay_operations"
    | "furlpay_customer_deposit"
    | "furlpay_hot_wallet"
    | "exchange"
    | "whale"
    | "custom";
  entity: string;
  source: string;
}
