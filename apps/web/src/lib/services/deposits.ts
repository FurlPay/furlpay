import { Chain, Token } from "../types";
import { kvGet, kvSet, kvSetNx, kvListPush, kvListRange } from "../kv";
import { randomInt } from "crypto";

// ---------------------------------------------------------------------------
// Real-time on-chain deposit tracking. Node providers (QuickNode Streams /
// Alchemy Notify) fire a webhook when a watched address receives funds; each
// transaction moves through a three-state machine that the UI renders live:
//
//   pending     mempool detection, not yet in a block
//   processing  included in a block, awaiting confirmation target
//   success     confirmation target reached, balance credited
//
// State lives in the durable KV layer (Upstash Redis in prod) so a webhook
// landing on one serverless instance is visible to the poller on another:
//   deposit:{txHash}           event record         TTL 24h
//   deposit:credited:{txHash}  single-credit guard  TTL 24h (atomic NX)
//   deposit:recent             newest-first index (bounded list)
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

const TTL_SECONDS = 86_400; // 24h — deposit history beyond this lives in the ledger
const RECENT_MAX = 50;
const EVENT_KEY = (txHash: string) => `deposit:${txHash}`;
const CREDIT_KEY = (txHash: string) => `deposit:credited:${txHash}`;
const RECENT_KEY = "deposit:recent";

function orderId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/\D/g, "").slice(0, 14);
  return `FP${stamp}${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
}

/**
 * Upsert a deposit event from a webhook delivery. Status only moves forward
 * (pending → processing → success) — an out-of-order or replayed mempool
 * webhook can never regress a mined transaction.
 */
export async function recordDepositEvent(input: {
  txHash: string;
  token: Token;
  chain: Chain;
  amount: number;
  from: string;
  to: string;
  confirmations: number;
}): Promise<DepositEvent> {
  const rank: Record<DepositStatus, number> = { pending: 0, processing: 1, success: 2 };
  const required = CONFIRM_TARGET[input.chain];
  const status: DepositStatus =
    input.confirmations >= required ? "success" : input.confirmations > 0 ? "processing" : "pending";

  const existing = await kvGet<DepositEvent>(EVENT_KEY(input.txHash));
  if (existing) {
    if (rank[status] > rank[existing.status]) {
      existing.status = status;
      existing.confirmations = input.confirmations;
      existing.updatedAt = new Date().toISOString();
      await kvSet(EVENT_KEY(input.txHash), existing, TTL_SECONDS);
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
  await kvSet(EVENT_KEY(input.txHash), event, TTL_SECONDS);
  await kvListPush(RECENT_KEY, input.txHash, RECENT_MAX);
  return event;
}

/**
 * Whether this transaction's success transition should credit the ledger —
 * atomic across instances, so a replayed "mined" webhook can never credit
 * twice even when it lands on a different lambda.
 */
export async function markCredited(txHash: string): Promise<boolean> {
  return kvSetNx(CREDIT_KEY(txHash), true, TTL_SECONDS);
}

export async function listRecentDeposits(limit = 10): Promise<DepositEvent[]> {
  const hashes = await kvListRange(RECENT_KEY, RECENT_MAX);
  const events = (await Promise.all(hashes.slice(0, limit * 2).map((h) => kvGet<DepositEvent>(EVENT_KEY(h)))))
    .filter((e): e is DepositEvent => e !== null);
  return events.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
