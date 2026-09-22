// ---------------------------------------------------------------------------
// Chain Adapter Abstraction
//
// FurlPay operates across heterogeneous settlement rails — EVM rollups,
// app-chains like Arc, and non-EVM runtimes like Solana. 
//
// Previously, chain interactions were spread across chainRegistry,
// onchain/balances, and x402Settler. Adding a non-EVM chain meant
// duplicating every assumption about RPC polling, decimal handling, and
// transaction states.
//
// This module provides the canonical ChainAdapter interface. Every network
// we support MUST implement this port. It guarantees that higher-level
// logic (like intents and settlement) never has to branch on `if (isSolana)`
// just to read a balance or wait for a transaction to finalize.
// ---------------------------------------------------------------------------

export type ChainVm = "evm" | "solana" | "arc";

export interface TokenBalance {
  token: string;       // Contract/mint address
  rawAmount: string;   // bigint as string — never a JS number
  decimals: number;
  amount: number;      // Human-scale display only
  blockNumber: number | null;
}

export interface GasEstimate {
  gasUnits: bigint;
  gasPricePerUnit: bigint;
  totalCost: bigint;
  totalCostUsd: number;  // Approximate, for display
  chain: string;
}

export interface GasPrice {
  chain: string;
  pricePerUnit: bigint;
  unit: string;  // "gwei" | "lamports" | "usdc-wei"
  source: "live" | "mock";
}

export interface BroadcastResult {
  txHash: string;
  /** Whether the broadcast itself succeeded — NOT whether the tx landed */
  accepted: boolean;
  error?: string;
}

export type TxConfirmationState = 
  | "unknown"       // Not seen yet
  | "pending"       // Seen but not confirmed
  | "confirmed"     // In a block, may reorg
  | "finalized"     // Irreversible
  | "failed"        // Landed and failed
  | "expired";      // Can never land (Solana blockhash expired)

export interface TransactionStatus {
  txHash: string;
  state: TxConfirmationState;
  blockNumber: number | null;
  confirmations: number | null;
  error?: unknown;
  source: "live" | "mock";
}

export interface ConfirmationOpts {
  /** Minimum commitment/confirmations required */
  requiredConfirmations?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Poll interval in milliseconds */
  pollIntervalMs?: number;
}

export interface ConfirmationResult {
  confirmed: boolean;
  status: TransactionStatus;
  /** Why confirmation was not reached, if applicable */
  reason?: string;
}

export interface HealthResult {
  healthy: boolean;
  latencyMs: number;
  blockHeight: number | null;
  source: "live" | "mock";
  error?: string;
}

/**
 * The canonical chain adapter interface.
 *
 * Every blockchain FurlPay operates on MUST implement this interface. It is
 * the single port through which all chain interactions flow — balance reads,
 * gas estimation, transaction broadcast, and confirmation tracking.
 *
 * This exists because EVM logic was spread across x402Settler, chainRegistry,
 * and onchain/balances with no unified abstraction. Adding Solana without
 * this port would mean a second copy of every assumption.
 */
export interface ChainAdapter {
  readonly vm: ChainVm;
  readonly chainSlug: string;
  readonly chainId: number | string; // number for EVM, string for Solana ("mainnet-beta")

  // Balance
  getBalance(address: string, token?: string): Promise<TokenBalance | null>;
  getTokenBalances(address: string, tokens: string[]): Promise<(TokenBalance | null)[]>;

  // Gas
  estimateGas(params: { to: string; data?: string; value?: bigint }): Promise<GasEstimate>;
  getGasPrice(): Promise<GasPrice>;

  // Transaction lifecycle  
  broadcastTransaction(signedTx: string): Promise<BroadcastResult>;
  getTransactionStatus(txHash: string): Promise<TransactionStatus>;
  waitForConfirmation(txHash: string, opts?: ConfirmationOpts): Promise<ConfirmationResult>;

  // Chain state
  getBlockHeight(): Promise<number>;
  healthCheck(): Promise<HealthResult>;
}
