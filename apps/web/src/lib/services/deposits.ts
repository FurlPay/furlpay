import { Chain, Token } from "../types";

// ---------------------------------------------------------------------------
// Real-time on-chain deposit tracking. Node providers (QuickNode Streams /
// Alchemy Notify) fire a webhook when a watched address receives funds; each
// transaction moves through a three-state machine that the UI renders live:
//
//   pending     mempool detection, not yet in a block
//   processing  included in a block, awaiting confirmation target
//   success     confirmation target reached, balance credited
//
// The store is in-memory (demo-ledger parity with the rest of the app); a
// live build persists to the DB keyed by user.
// ---------------------------------------------------------------------------

export type DepositStatus = "pending" | "processing" | "success";

export interface DepositEvent {
  txHash: string;
  /** Binance-style human order reference, stable across status updates. */
  orderId: string;
  token: Token;
  chain: Chain;
  amount: number; // human units
  from: string;
  to: string;
  status: DepositStatus;
  confirmations: number;
  requiredConfirmations: number;
  createdAt: string;
  updatedAt: string;
}

export const EXPLORER_TX: Record<Chain, string> = {
  ethereum: "https://etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  solana: "https://solscan.io/tx/",
  gnosis: "https://gnosisscan.io/tx/",
  robinhood: "https://robinhoodchain.blockscout.com/tx/",
  bsc: "https://bscscan.com/tx/",
};

// Confirmation targets per chain (fast-finality chains credit on 1 block).
const CONFIRM_TARGET: Record<Chain, number> = {
  ethereum: 12,
  polygon: 30,
  base: 1,
  arbitrum: 1,
  solana: 1,
  gnosis: 1,
  robinhood: 1,
  bsc: 1,
};

const MAX_EVENTS = 200;
const events = new Map<string, DepositEvent>(); // keyed by txHash

function orderId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/\D/g, "").slice(0, 14);
  return `FP${stamp}${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
}

/**
 * Upsert a deposit event from a webhook delivery. Status only moves forward
 * (pending → processing → success) — an out-of-order or replayed mempool
 * webhook can never regress a mined transaction.
 */
export function recordDepositEvent(input: {
  txHash: string;
  token: Token;
  chain: Chain;
  amount: number;
  from: string;
  to: string;
  confirmations: number;
}): DepositEvent {
  const rank: Record<DepositStatus, number> = { pending: 0, processing: 1, success: 2 };
  const required = CONFIRM_TARGET[input.chain];
  const status: DepositStatus =
    input.confirmations >= required ? "success" : input.confirmations > 0 ? "processing" : "pending";

  const existing = events.get(input.txHash);
  if (existing) {
    if (rank[status] > rank[existing.status]) {
      existing.status = status;
      existing.confirmations = input.confirmations;
      existing.updatedAt = new Date().toISOString();
    }
    return existing;
  }

  const event: DepositEvent = {
    txHash: input.txHash,
    orderId: orderId(),
    token: input.token,
    chain: input.chain,
    amount: input.amount,
    from: input.from,
    to: input.to,
    status,
    confirmations: input.confirmations,
    requiredConfirmations: required,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  events.set(input.txHash, event);

  // Bound memory: evict oldest settled events first.
  if (events.size > MAX_EVENTS) {
    const oldest = [...events.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const e of oldest) {
      if (events.size <= MAX_EVENTS) break;
      if (e.status === "success") events.delete(e.txHash);
    }
  }
  return event;
}

/** Whether this event's success transition already credited the ledger. */
const credited = new Set<string>();
export function markCredited(txHash: string): boolean {
  if (credited.has(txHash)) return false;
  credited.add(txHash);
  return true;
}

export function listRecentDeposits(limit = 10): DepositEvent[] {
  return [...events.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
