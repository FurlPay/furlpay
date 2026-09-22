// ---------------------------------------------------------------------------
// Intent authorization for x402 agent wallets.
//
// THE GAP: An AI agent with an x402 allowance can spend up to its limit on
// anything. There's no mechanism to:
// - Require human approval for high-value or unusual intents
// - Restrict agent spending to specific categories/merchants
// - Implement multi-step approval for complex transactions
// - Log intent chains for audit
//
// THIS MODULE: adds intent-level authorization that sits between the
// agent's spending request and the actual x402 payment.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";

export type IntentCategory =
  | "compute"         // AI inference, API calls
  | "data"            // Data access, search
  | "infrastructure"  // Hosting, storage
  | "financial"       // Payments, transfers
  | "communication"   // Email, SMS
  | "uncategorized";

export type ApprovalRequirement =
  | "auto_approve"    // Within policy, no human needed
  | "notify"          // Auto-approve but notify the owner
  | "require_approval" // Block until human approves
  | "deny";           // Policy forbids this

export interface IntentRequest {
  agentId: string;
  sessionId: string;
  intent: string;          // Human-readable description
  category: IntentCategory;
  estimatedCostUsd: number;
  recipient: string;       // x402 resource URL or merchant
  metadata?: Record<string, string>;
  parentIntentId?: string; // For chained intents
}

export interface IntentDecision {
  intentId: string;
  approval: ApprovalRequirement;
  reason: string;
  remainingBudget: number;  // USD remaining in agent's allowance
  expiresAt: string;        // Intent approval expires
}

export interface AgentSpendingPolicy {
  agentId: string;
  /** Per-transaction auto-approve ceiling in USD */
  autoApproveMaxUsd: number;
  /** Per-session budget in USD */
  sessionBudgetUsd: number;
  /** Allowed spending categories */
  allowedCategories: IntentCategory[];
  /** Blocked recipients (domains, addresses) */
  blockedRecipients: string[];
  /** Require approval for first-time recipients */
  requireApprovalNewRecipient: boolean;
  /** Maximum chain depth for multi-step intents */
  maxIntentChainDepth: number;
}

export const DEFAULT_POLICY: AgentSpendingPolicy = {
  agentId: "",
  autoApproveMaxUsd: 5,
  sessionBudgetUsd: 50,
  allowedCategories: ["compute", "data"],
  blockedRecipients: [],
  requireApprovalNewRecipient: true,
  maxIntentChainDepth: 5,
};

/**
 * Checks if the recipient is explicitly blocked or allowed.
 */
export function isRecipientAllowed(recipient: string, policy: AgentSpendingPolicy): boolean {
  if (policy.blockedRecipients.includes(recipient)) {
    return false;
  }
  return true;
}

/**
 * Tracks and validates the maximum depth of chained intents.
 * Returns false if the intent chain exceeds the maximum allowed depth.
 */
export function trackIntentChain(
  intentId: string, 
  parentId: string | undefined, 
  currentDepth: number, 
  policy: AgentSpendingPolicy
): boolean {
  // A simplistic tracking simulation. In reality, you'd query the DB to count the depth recursively.
  if (currentDepth >= policy.maxIntentChainDepth) {
    return false;
  }
  return true;
}

/**
 * Evaluates a new intent request against the agent's spending policy.
 */
export function evaluateIntent(
  request: IntentRequest,
  policy: AgentSpendingPolicy,
  sessionSpentUsd: number,
  isNewRecipient: boolean = false,
  currentChainDepth: number = 0
): IntentDecision {
  const intentId = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry
  
  const remainingBudget = Math.max(0, policy.sessionBudgetUsd - sessionSpentUsd);

  // 1. Check if recipient is blocked
  if (!isRecipientAllowed(request.recipient, policy)) {
    return {
      intentId,
      approval: "deny",
      reason: "Recipient is blocked by policy.",
      remainingBudget,
      expiresAt
    };
  }

  // 2. Check category
  if (!policy.allowedCategories.includes(request.category)) {
    return {
      intentId,
      approval: "deny",
      reason: `Category '${request.category}' is not allowed by policy.`,
      remainingBudget,
      expiresAt
    };
  }

  // 3. Check session budget
  if (sessionSpentUsd + request.estimatedCostUsd > policy.sessionBudgetUsd) {
    return {
      intentId,
      approval: "require_approval",
      reason: "Request exceeds remaining session budget.",
      remainingBudget,
      expiresAt
    };
  }

  // 4. Check chain depth
  if (!trackIntentChain(intentId, request.parentIntentId, currentChainDepth, policy)) {
    return {
      intentId,
      approval: "deny",
      reason: "Maximum intent chain depth exceeded.",
      remainingBudget,
      expiresAt
    };
  }

  // 5. Check new recipient rule
  if (isNewRecipient && policy.requireApprovalNewRecipient) {
    return {
      intentId,
      approval: "require_approval",
      reason: "Approval required for new recipient.",
      remainingBudget,
      expiresAt
    };
  }

  // 6. Check per-transaction ceiling
  if (request.estimatedCostUsd > policy.autoApproveMaxUsd) {
    return {
      intentId,
      approval: "require_approval",
      reason: "Amount exceeds auto-approve ceiling.",
      remainingBudget,
      expiresAt
    };
  }

  // Passed all checks, safe to auto-approve
  return {
    intentId,
    approval: "auto_approve",
    reason: "Within all policy limits.",
    remainingBudget: remainingBudget - request.estimatedCostUsd, // Optimistic subtraction
    expiresAt
  };
}

export interface IntentAuditRecord {
  auditId: string;
  timestamp: string;
  request: IntentRequest;
  decision: IntentDecision;
}

/**
 * Builds a structured audit record for an intent decision.
 */
export function buildIntentAuditTrail(
  request: IntentRequest,
  decision: IntentDecision
): IntentAuditRecord {
  return {
    auditId: randomUUID(),
    timestamp: new Date().toISOString(),
    request,
    decision,
  };
}
