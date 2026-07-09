import { keyIdOf } from "@furlpay/agent-trust";
import { audit } from "./audit";
import { kvGet, kvIncrBy, kvSet } from "./kv";
import { log } from "./log";

// ---------------------------------------------------------------------------
// Agent-spend control plane: user-owned agent keys with spend policies.
//
// An agent key is an Ed25519 public key (RFC 9421 signing, agentTrustGate)
// BOUND TO the user account that registered it, carrying a policy the money
// paths enforce on every spend:
//
//   perTxLimitUsd      — hard cap on a single authorization
//   dailyBudgetUsd     — rolling UTC-day budget (atomic cross-instance
//                        counter, reserve-then-refund so concurrent spends
//                        can never overshoot)
//   allowedCategories  — what kinds of money movement the key may initiate
//   expiresAt          — optional hard expiry
//
// Records live in the kv layer (Redis in prod) so a key registered on one
// instance authorizes on every instance, and revocation is immediate
// everywhere. Every allow/deny lands in the audit trail.
// ---------------------------------------------------------------------------

export const AGENT_SPEND_CATEGORIES = ["escrow", "travel", "transfer", "x402", "commerce"] as const;
export type AgentSpendCategory = (typeof AGENT_SPEND_CATEGORIES)[number];

export interface AgentPolicy {
  perTxLimitUsd: number;
  dailyBudgetUsd: number;
  /** Empty array = a read-only key: it can sign requests but never spend. */
  allowedCategories: AgentSpendCategory[];
  expiresAt?: string; // ISO 8601
}

export interface AgentKeyRecord {
  keyId: string;
  userId: string;
  name: string;
  publicKeyPem: string;
  policy: AgentPolicy;
  status: "active" | "revoked";
  createdAt: string;
}

/** The shape safe to return to clients — never the PEM (it is public key
 *  material, but echoing it back invites confused-deputy copy/paste). */
export interface AgentKeyPublic {
  keyId: string;
  name: string;
  policy: AgentPolicy;
  status: AgentKeyRecord["status"];
  createdAt: string;
}

const recordKey = (keyId: string) => `agent:key:${keyId}`;
const indexKey = (userId: string) => `agent:index:${userId}`;
// Spend windows are keyed by UTC day; the TTL only garbage-collects them.
const spendKey = (keyId: string) => `agent:spend:${keyId}:${new Date().toISOString().slice(0, 10)}`;
const SPEND_WINDOW_TTL_SECONDS = 48 * 3600;

export function redactAgentKey(r: AgentKeyRecord): AgentKeyPublic {
  return { keyId: r.keyId, name: r.name, policy: r.policy, status: r.status, createdAt: r.createdAt };
}

export async function getAgentKey(keyId: string): Promise<AgentKeyRecord | null> {
  return kvGet<AgentKeyRecord>(recordKey(keyId));
}

/** Register (or re-register) an agent key under its owning user. Re-posting
 *  the same PEM updates name/policy in place — same keyId, same owner check. */
export async function registerOwnedAgentKey(params: {
  userId: string;
  name: string;
  publicKeyPem: string;
  policy: AgentPolicy;
}): Promise<AgentKeyRecord> {
  const keyId = keyIdOf(params.publicKeyPem, "agent");

  const existing = await getAgentKey(keyId);
  if (existing && existing.userId !== params.userId) {
    throw new Error("key already registered to another account");
  }

  const record: AgentKeyRecord = {
    keyId,
    userId: params.userId,
    name: params.name,
    publicKeyPem: params.publicKeyPem,
    policy: params.policy,
    status: "active",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await kvSet(recordKey(keyId), record);

  const index = (await kvGet<string[]>(indexKey(params.userId))) ?? [];
  if (!index.includes(keyId)) {
    await kvSet(indexKey(params.userId), [...index, keyId]);
  }

  audit("agent.key_registered", params.userId, {
    keyId,
    name: params.name,
    perTxLimitUsd: params.policy.perTxLimitUsd,
    dailyBudgetUsd: params.policy.dailyBudgetUsd,
    categories: params.policy.allowedCategories,
  });
  return record;
}

export async function listAgentKeys(userId: string): Promise<AgentKeyRecord[]> {
  const index = (await kvGet<string[]>(indexKey(userId))) ?? [];
  const records = await Promise.all(index.map((id) => getAgentKey(id)));
  return records.filter((r): r is AgentKeyRecord => r !== null);
}

/** Revoke a key. Owner-checked; revocation is immediate on every instance
 *  because authorization always reads the durable record. */
export async function revokeAgentKey(userId: string, keyId: string): Promise<boolean> {
  const record = await getAgentKey(keyId);
  if (!record || record.userId !== userId) return false;
  if (record.status !== "revoked") {
    await kvSet(recordKey(keyId), { ...record, status: "revoked" });
    audit("agent.key_revoked", userId, { keyId, name: record.name });
  }
  return true;
}

export type AgentSpendDecision =
  | { allowed: true; record: AgentKeyRecord; spentTodayUsd: number }
  | { allowed: false; reason: string; record?: AgentKeyRecord };

/**
 * Policy gate for a spend initiated by a signed agent request. Budget
 * accounting is reserve-then-refund on the atomic day counter: the amount is
 * added first, and refunded if it overshoots — so two concurrent spends can
 * both be denied, but the budget can never be exceeded.
 */
export async function authorizeAgentSpend(params: {
  keyId: string;
  amountUsd: number;
  category: AgentSpendCategory;
}): Promise<AgentSpendDecision> {
  const { keyId, amountUsd, category } = params;

  const deny = (reason: string, record?: AgentKeyRecord): AgentSpendDecision => {
    audit("agent.spend_denied", record?.userId ?? "anonymous", { keyId, amountUsd, category, reason });
    return { allowed: false, reason, record };
  };

  const record = await getAgentKey(keyId);
  if (!record) return deny("unknown_agent_key");
  if (record.status !== "active") return deny("key_revoked", record);
  if (record.policy.expiresAt && new Date(record.policy.expiresAt).getTime() < Date.now()) {
    return deny("key_expired", record);
  }
  if (!record.policy.allowedCategories.includes(category)) {
    return deny("category_not_allowed", record);
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return deny("invalid_amount", record);
  if (amountUsd > record.policy.perTxLimitUsd) return deny("per_tx_limit_exceeded", record);

  const cents = Math.round(amountUsd * 100);
  const budgetCents = Math.round(record.policy.dailyBudgetUsd * 100);
  let totalCents: number;
  try {
    totalCents = await kvIncrBy(spendKey(keyId), cents, SPEND_WINDOW_TTL_SECONDS);
  } catch (e) {
    // Counter backend down: fail CLOSED for agent money movement.
    log.error("agent spend counter unavailable", { keyId, error: (e as Error).message });
    return deny("budget_counter_unavailable", record);
  }
  if (totalCents > budgetCents) {
    try {
      await kvIncrBy(spendKey(keyId), -cents, SPEND_WINDOW_TTL_SECONDS);
    } catch (e) {
      // Refund failed — the window stays over-reserved until it expires,
      // which under-spends rather than over-spends. Log and move on.
      log.error("agent budget refund failed", { keyId, error: (e as Error).message });
    }
    return deny("daily_budget_exceeded", record);
  }

  audit("agent.spend_authorized", record.userId, {
    keyId,
    amountUsd,
    category,
    spentTodayUsd: totalCents / 100,
    dailyBudgetUsd: record.policy.dailyBudgetUsd,
  });
  return { allowed: true, record, spentTodayUsd: totalCents / 100 };
}
