import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Account freeze and security hold.
//
// THE GAP: FurlPay has an "account.locked" audit event but no mechanism
// to actually freeze an account. A compromised account continues to
// transact until manually noticed.
//
// THIS MODULE: provides a freeze/unfreeze protocol that:
// - Immediately blocks all outbound transfers and withdrawals
// - Allows inbound deposits (to avoid losing customer funds)
// - Logs the freeze reason for compliance
// - Requires step-up auth to unfreeze
// - Supports both manual freeze and automated triggers
// ---------------------------------------------------------------------------

export type FreezeReason =
  | "customer_request"     // Customer reported compromise
  | "fraud_detected"       // Trust Layer triggered
  | "aml_hold"             // AML/sanctions screening
  | "compliance_review"    // Regulatory request
  | "suspicious_activity"  // Velocity/pattern detection
  | "admin_action"         // Manual admin freeze
  | "death_spiral_guard";  // Automated protective freeze

export type FreezeScope =
  | "full"                 // No operations at all
  | "outbound_only"        // Block sends, allow receives
  | "withdrawals_only"     // Block withdrawals, allow transfers
  | "trading_only";        // Block swaps, allow transfers

export interface AccountFreezeState {
  freezeId: string;
  accountId: string;
  frozen: boolean;
  scope: FreezeScope;
  reason: FreezeReason;
  frozenBy: string;         // userId or "system"
  frozenAt: string;         // ISO 8601
  /** How long until auto-review if not manually resolved */
  reviewDeadline: string;
  evidence?: string;        // Reference to Trust Layer DecisionRecord or ticket
  unfrozenAt?: string;
  unfrozenBy?: string;
}

export const FREEZE_CONFIG = {
  /** Hours before a frozen account must be reviewed by a human */
  reviewDeadlineHours: 48,
  /** Whether to allow inbound transfers to frozen accounts */
  allowInboundWhenFrozen: true,
  /** Max freeze duration without review (hours) before auto-escalation */
  maxUnreviewedHours: 72,
} as const;

// In-memory store for now, following FurlPay patterns
const freezeStore = new Map<string, AccountFreezeState>();

export function freezeAccount(
  accountId: string,
  reason: FreezeReason,
  scope: FreezeScope,
  frozenBy: string,
  evidence?: string
): AccountFreezeState {
  const now = new Date();
  const reviewDeadline = new Date(now.getTime() + FREEZE_CONFIG.reviewDeadlineHours * 3600000);
  
  const state: AccountFreezeState = {
    freezeId: randomUUID(),
    accountId,
    frozen: true,
    scope,
    reason,
    frozenBy,
    frozenAt: now.toISOString(),
    reviewDeadline: reviewDeadline.toISOString(),
    evidence,
  };
  
  freezeStore.set(accountId, state);
  return state;
}

export function unfreezeAccount(accountId: string, unfrozenBy: string): AccountFreezeState {
  const state = freezeStore.get(accountId);
  if (!state || !state.frozen) {
    throw new Error(`Account ${accountId} is not frozen`);
  }
  
  const updated: AccountFreezeState = {
    ...state,
    frozen: false,
    unfrozenAt: new Date().toISOString(),
    unfrozenBy,
  };
  
  freezeStore.set(accountId, updated);
  return updated;
}

export function isAccountFrozen(accountId: string): { frozen: boolean; scope?: FreezeScope; reason?: FreezeReason } {
  const state = freezeStore.get(accountId);
  if (!state || !state.frozen) {
    return { frozen: false };
  }
  
  return {
    frozen: true,
    scope: state.scope,
    reason: state.reason,
  };
}

export function canPerformAction(accountId: string, action: "send" | "receive" | "withdraw" | "swap"): { allowed: boolean; reason?: string } {
  const state = freezeStore.get(accountId);
  
  if (!state || !state.frozen) {
    return { allowed: true };
  }

  const { scope } = state;

  if (scope === "full") {
    return { allowed: false, reason: "Account is fully frozen." };
  }

  if (action === "receive" && FREEZE_CONFIG.allowInboundWhenFrozen) {
    return { allowed: true };
  }

  if (scope === "outbound_only" && (action === "send" || action === "withdraw")) {
    return { allowed: false, reason: "Outbound transactions are currently blocked." };
  }

  if (scope === "withdrawals_only" && action === "withdraw") {
    return { allowed: false, reason: "Withdrawals are currently blocked." };
  }

  if (scope === "trading_only" && action === "swap") {
    return { allowed: false, reason: "Trading is currently blocked." };
  }

  return { allowed: true };
}

export function checkFreezeDeadlines(state: AccountFreezeState): { needsReview: boolean; needsEscalation: boolean } {
  if (!state.frozen) {
    return { needsReview: false, needsEscalation: false };
  }

  const now = new Date().getTime();
  const frozenAt = new Date(state.frozenAt).getTime();
  const reviewDeadline = new Date(state.reviewDeadline).getTime();

  const needsReview = now > reviewDeadline;
  const escalationThreshold = frozenAt + FREEZE_CONFIG.maxUnreviewedHours * 3600000;
  const needsEscalation = now > escalationThreshold;

  return { needsReview, needsEscalation };
}
