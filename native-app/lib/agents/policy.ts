// ---------------------------------------------------------------------------
// Agent spend policy — CLIENT MIRROR of the server contract.
//
// The authoritative implementation is apps/web/src/lib/agentPolicy.ts. This
// file exists so the app can EXPLAIN and PREVIEW a decision before the user
// commits, not so it can make one.
//
//   THE CLIENT NEVER AUTHORIZES A SPEND.
//
// Two reasons that is not merely a style rule:
//
//   1. The daily-budget counter is a cross-instance atomic in the server's kv
//      layer. A client cannot see concurrent spends by the same agent key from
//      another device or another process, so any client-side budget answer is
//      a guess that goes stale the instant it is computed.
//   2. A client is attacker-controlled. A rooted device can return `allowed`
//      from anything here.
//
// So `previewAgentSpend` returns a PreviewDecision, deliberately a DIFFERENT
// type from the server's AgentSpendDecision, and nothing in this app may treat
// it as permission. Its job is to stop the user submitting something that will
// obviously be refused, and to say why in words.
// ---------------------------------------------------------------------------

/** Mirrors AGENT_SPEND_CATEGORIES in apps/web/src/lib/agentPolicy.ts. */
export const AGENT_SPEND_CATEGORIES = [
  "escrow",
  "travel",
  "transfer",
  "x402",
  "commerce",
] as const;

export type AgentSpendCategory = (typeof AGENT_SPEND_CATEGORIES)[number];

export interface AgentPolicy {
  perTxLimitUsd: number;
  dailyBudgetUsd: number;
  /** Empty array = a read-only key: it can sign requests but never spend. */
  allowedCategories: AgentSpendCategory[];
  /** ISO 8601. Absent = no expiry. */
  expiresAt?: string;
}

export interface AgentKeyPublic {
  keyId: string;
  name: string;
  policy: AgentPolicy;
  status: "active" | "revoked";
  createdAt: string;
}

/**
 * Deny reasons, byte-identical to the server's strings.
 *
 * Kept identical on purpose: a decision the server made can be rendered by the
 * same code path that renders a local preview, so the user reads the same
 * sentence either way instead of two differently-worded refusals.
 */
export type DenyReason =
  | "unknown_agent_key"
  | "key_revoked"
  | "key_expired"
  | "category_not_allowed"
  | "invalid_amount"
  | "per_tx_limit_exceeded"
  | "daily_budget_exceeded"
  | "counter_unavailable";

/**
 * The client's non-authoritative read.
 *
 * `wouldAllow` is deliberately NOT called `allowed`. Any future reader looking
 * for an authorization boolean will not find one here.
 */
export interface PreviewDecision {
  wouldAllow: boolean;
  reason?: DenyReason;
  /** True when the answer depends on state only the server can see. */
  serverMustDecide: boolean;
}

/**
 * Evaluate what the server would probably say.
 *
 * Only checks the rules that are decidable from data the client actually holds:
 * key status, expiry, category and the per-transaction cap. It deliberately
 * does NOT attempt the daily budget — see `serverMustDecide`.
 */
export function previewAgentSpend(params: {
  key: AgentKeyPublic | null;
  amountUsd: number;
  category: AgentSpendCategory;
  now?: number;
}): PreviewDecision {
  const { key, amountUsd, category } = params;
  const now = params.now ?? Date.now();

  const deny = (reason: DenyReason): PreviewDecision => ({
    wouldAllow: false,
    reason,
    serverMustDecide: false,
  });

  if (!key) return deny("unknown_agent_key");
  if (key.status !== "active") return deny("key_revoked");
  if (key.policy.expiresAt && new Date(key.policy.expiresAt).getTime() < now) {
    return deny("key_expired");
  }
  if (!key.policy.allowedCategories.includes(category)) return deny("category_not_allowed");
  // Matches the server's guard exactly: NaN, Infinity, zero and negatives all
  // fail here rather than reaching a limit comparison that would pass them.
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return deny("invalid_amount");
  if (amountUsd > key.policy.perTxLimitUsd) return deny("per_tx_limit_exceeded");

  // Everything the client can check has passed. The daily budget is an atomic
  // counter shared across instances and devices; only the server knows it.
  return { wouldAllow: true, serverMustDecide: true };
}

/**
 * A sentence a person can act on.
 *
 * "Explainable internally" from the brief means the refusal must name the rule
 * that fired, not just say no. Every branch below names one.
 */
export function explainDenial(reason: DenyReason, key?: AgentKeyPublic | null): string {
  switch (reason) {
    case "unknown_agent_key":
      return "That agent is not registered on this account.";
    case "key_revoked":
      return `${key?.name ?? "This agent"} has been revoked and can no longer spend.`;
    case "key_expired":
      return `${key?.name ?? "This agent"}'s permission expired${
        key?.policy.expiresAt ? ` on ${key.policy.expiresAt.slice(0, 10)}` : ""
      }.`;
    case "category_not_allowed":
      return `${key?.name ?? "This agent"} is not allowed to make this kind of payment.`;
    case "invalid_amount":
      return "That amount is not valid.";
    case "per_tx_limit_exceeded":
      return key
        ? `This is over ${key.name}'s ${formatUsd(key.policy.perTxLimitUsd)} single-payment limit.`
        : "This is over the agent's single-payment limit.";
    case "daily_budget_exceeded":
      return key
        ? `${key.name} has used its ${formatUsd(key.policy.dailyBudgetUsd)} daily budget.`
        : "The agent has used its daily budget.";
    case "counter_unavailable":
      // The server fails CLOSED here. Say so plainly rather than implying the
      // user did something wrong.
      return "We could not check the agent's spending limit, so the payment was not made.";
  }
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Does this spend need a human before the server is even asked?
 *
 * Distinct from the policy limits: this is the user's OWN approval threshold
 * ("anything over $300 asks me first"), sitting above the agent's hard caps.
 * A policy limit blocks; this one pauses.
 */
export function requiresHumanApproval(
  key: AgentKeyPublic,
  amountUsd: number,
  approvalThresholdUsd: number | null
): boolean {
  if (approvalThresholdUsd === null) return false;
  if (!Number.isFinite(amountUsd)) return true; // unknown amount -> ask
  return amountUsd > approvalThresholdUsd;
}

/** A key that can sign but never spend. Worth surfacing distinctly in the UI. */
export function isReadOnly(key: AgentKeyPublic): boolean {
  return key.policy.allowedCategories.length === 0;
}

/** True when the key is past its expiry, regardless of stored status. */
export function isExpired(key: AgentKeyPublic, now: number = Date.now()): boolean {
  return !!key.policy.expiresAt && new Date(key.policy.expiresAt).getTime() < now;
}

/** Usable right now: active, unexpired, and permitted at least one category. */
export function isUsable(key: AgentKeyPublic, now: number = Date.now()): boolean {
  return key.status === "active" && !isExpired(key, now) && !isReadOnly(key);
}

/**
 * Validate a policy before sending it to the server.
 *
 * Returns the list of problems, empty when valid. Catching these locally gives
 * the user a field-level error instead of a 400.
 */
export function validatePolicy(p: AgentPolicy): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(p.perTxLimitUsd) || p.perTxLimitUsd <= 0) {
    errors.push("Set a single-payment limit above zero.");
  }
  if (!Number.isFinite(p.dailyBudgetUsd) || p.dailyBudgetUsd <= 0) {
    errors.push("Set a daily budget above zero.");
  }
  if (
    Number.isFinite(p.perTxLimitUsd) &&
    Number.isFinite(p.dailyBudgetUsd) &&
    p.perTxLimitUsd > p.dailyBudgetUsd
  ) {
    // Not fatal server-side, but it means the per-tx limit can never bind — a
    // policy that reads stricter than it is.
    errors.push("The single-payment limit is higher than the daily budget, so it will never apply.");
  }
  for (const c of p.allowedCategories) {
    if (!AGENT_SPEND_CATEGORIES.includes(c)) errors.push(`Unknown category: ${c}`);
  }
  if (p.expiresAt) {
    const t = new Date(p.expiresAt).getTime();
    if (Number.isNaN(t)) errors.push("Expiry date is not a valid date.");
    else if (t < Date.now()) errors.push("Expiry date is in the past.");
  }
  return errors;
}
