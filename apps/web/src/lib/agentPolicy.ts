import { keyIdOf } from "@furlpay/agent-trust";
import { audit } from "./audit";
import { kvGet, kvIncrBy, kvSet } from "./kv";
import { log } from "./log";
import { burstConfigFrom, releaseBurst, reserveBurst } from "./agent/burstWindow";

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

// ── Burst bound (atomic sliding window) ───────────────────────────────────
//
// THE GAP THIS CLOSES. The daily budget is a good spend LIMIT and a poor spend
// SHAPE: a compromised key can drain the whole day's budget in one second at
// 09:00:01, and a UTC-day counter has no opinion about that. lib/agent/
// decayingAllowance.ts was written to fix exactly this and was never wired to
// anything. This is the wiring — now over an ATOMIC counter (see burstWindow.ts);
// decayingAllowance remains as the pure reference model of the same bound.
//
// THE CAP IS A FRACTION OF THE DAILY BUDGET, ON PURPOSE. A bucket whose cap
// equals the daily budget permits one full-budget burst and bounds nothing —
// it starts full. Holding 25% means the largest instantaneous drain is a
// quarter of the day's authority, while the bucket still refills the full
// budget over 24h so an agent spending steadily is unaffected.
//
// ...BUT THE CAP CAN NEVER BE SMALLER THAN ONE PERMITTED TRANSACTION, AND THAT
// FLOOR IS LOAD-BEARING. With the cap at a flat 25% of the day, any single
// payment larger than a quarter of the daily budget could never clear the
// bucket at all: decayingAllowance's own comment records the consequence —
// "amountMinor > capMinor leaves retryAtMs null: waiting will never help". A
// policy of $50/day with a $25 per-transaction limit therefore had a real
// maximum transaction of $12.50, and the denial came back as
// `burst_rate_exceeded`, which tells the caller to retry something that can
// never succeed. An operator-configured perTxLimitUsd that the system silently
// refuses to honour is worse than no limit field at all, so the cap is raised
// to admit one full-size transaction.
//
// This bounds the RATE of large payments rather than forbidding them: a key
// permitted one $25 payment must wait for the bucket to refill before the next,
// which is exactly the property the burst bound exists to provide.
//
// CONCURRENCY: NOW HARD, NOT SOFT. This comment used to end by conceding that
// the bucket was read-modify-write and therefore "soft under concurrency" —
// which measured as the bound contributing nothing at all, since ten concurrent
// authorizations each read a full bucket. lib/agent/burstWindow.ts replaces it
// with a sliding-window counter over the atomic `kvIncrBy`, reserving before
// comparing exactly as the daily counter does. Two concurrent spends can now both
// be DENIED — a retry — but the cap cannot be exceeded, which would be money
// gone. No lock is taken, so there is nothing to deadlock and nothing an attacker
// can hold open.
const BURST_CAP_FRACTION = 0.25;
const bucketKey = (keyId: string) => `agent:bucket:${keyId}`;

function burstConfigFor(dailyBudgetUsd: number, perTxLimitUsd: number) {
  const dailyCents = Math.round(dailyBudgetUsd * 100);
  const perTxCents = Math.max(1, Math.round(perTxLimitUsd * 100));
  // At least one permitted transaction, and never more than the whole day.
  const capCents = Math.min(
    dailyCents,
    Math.max(1, Math.floor(dailyCents * BURST_CAP_FRACTION), perTxCents)
  );
  // The window is however long the daily refill rate takes to restore a full
  // cap, which is the same statement as the old bucket's drain rate.
  return burstConfigFrom({
    capMinor: capCents,
    refillMinorPerPeriod: Math.max(1, dailyCents),
    refillPeriodSeconds: 24 * 3600,
  });
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

  // Burst bound, checked BEFORE reserving the daily counter so a rate-denied
  // spend never needs a daily refund. Fails closed on a KV fault, matching the
  // posture the daily counter below already takes for agent money movement.
  //
  // NOW ATOMIC. This used to read the bucket, compute, and write it back, and the
  // comment here conceded what that cost: "two simultaneous spends can both
  // observe the same balance… the burst bound is therefore soft under
  // concurrency." Measured, ten concurrent authorizations all read a full bucket
  // and the bound contributed nothing, leaving the daily counter to do the whole
  // job — which is the spend-SHAPE problem the bucket exists to solve.
  //
  // lib/agent/burstWindow.ts replaces it with a sliding-window counter over
  // `kvIncrBy`, which is an atomic Redis INCRBY. Reserve first, compare second,
  // refund if it overshot — the same discipline the daily budget already uses. No
  // lock, so there is nothing to deadlock and nothing an attacker can hold.
  // A BURST CAP THAT IS NOT NARROWER THAN THE DAY IS NOT A CONSTRAINT, so it is
  // not consulted. This file's own reasoning above says it: "A bucket whose cap
  // equals the daily budget permits one full-budget burst and bounds nothing."
  // That happens whenever `perTxLimitUsd >= dailyBudgetUsd` — a policy where one
  // payment may legitimately spend the whole day.
  //
  // Consulting it anyway is not merely redundant, it is MISLEADING: both bounds
  // sit at the same number, the burst gate runs first, and an exhausted budget
  // comes back as `burst_rate_exceeded`. That reads as "wait and retry" when the
  // truth is "the day's budget is gone", and the two call for different actions.
  const cfg = burstConfigFor(record.policy.dailyBudgetUsd, record.policy.perTxLimitUsd);
  const burstNarrowsTheDay = cfg.capMinor < budgetCents;
  const burst = burstNarrowsTheDay
    ? await reserveBurst({ namespace: bucketKey(keyId), config: cfg, amountMinor: cents })
    : ({ allowed: true } as const);
  if (!burst.allowed) {
    return deny(burst.reason, record);
  }
  // THE BURST BUCKET IS REFUNDED ON EVERY DOWNSTREAM DENIAL, and that is not a
  // tidiness measure — it closes a lockout.
  //
  // The bucket is debited above, before the daily counter is consulted. Without
  // a refund, an authorization the daily counter then REFUSES has still
  // permanently consumed burst allowance, so a payment that moved no money
  // reduces the agent's future capacity. Ten rapid attempts that are all denied
  // drain the whole bucket, and because it refills at the daily budget over 24h,
  // the next legitimate payment waits hours. Anyone able to provoke denials —
  // including the agent itself, looping — can lock the key out of its own budget.
  //
  // This is the principle the rest of the codebase already states explicitly.
  // services/velocity.ts: "commit() records AFTER the money actually moved, so
  // declined/failed attempts can never lock a victim out". services/policyEngine
  // .ts: "Only money that actually moved counts: a declined authorization spent
  // nothing, and counting it would let an attacker (or one fat-fingered amount)
  // lock the card by stacking declines." The burst bucket was the one gate that
  // debited on ATTEMPT rather than on SUCCESS.
  const refundBurst = async (): Promise<void> => {
    // Nothing was reserved when the burst gate did not apply, so there is
    // nothing to return — releasing anyway would drive the window negative.
    if (!burstNarrowsTheDay) return;
    await releaseBurst({ namespace: bucketKey(keyId), config: cfg, amountMinor: cents });
  };

  let totalCents: number;
  try {
    totalCents = await kvIncrBy(spendKey(keyId), cents, SPEND_WINDOW_TTL_SECONDS);
  } catch (e) {
    // Counter backend down: fail CLOSED for agent money movement. The burst
    // debit is returned, because nothing was authorized.
    await refundBurst();
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
    await refundBurst();
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
