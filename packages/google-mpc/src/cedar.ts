// ---------------------------------------------------------------------------
// Cedar policy helpers for Google Cloud MPC transaction authorization.
//
// Cedar (github.com/cedar-policy) is the policy language Google Cloud MPC uses
// to evaluate whether a signing request should be permitted or forbidden. The
// engine is default-deny: at least one PERMIT rule must match, and no FORBID
// rule may match, for a threshold-signing operation to proceed.
//
// These helpers generate Cedar policy source code for the most common
// transaction controls a payments company needs. The output is a string that
// goes into the `cedarPolicy` field of a `TransactionPolicy` — it is NOT
// evaluated locally; the policy engine runs inside Google's Confidential Space.
//
// Why generate rather than template? Cedar's syntax is simple but its
// semantics are subtle (e.g. `when { ... }` clauses are conjunctive, not
// disjunctive; a missing field fails closed). Incorrect policies silently
// block all transactions — or worse, silently permit ones they should block.
// Builder functions make the correct shape easy and the wrong shape impossible.
// ---------------------------------------------------------------------------

import type { PolicyEffect } from "./types.js";

// ── Policy builders ─────────────────────────────────────────────────────────

/**
 * FORBID transactions whose USD value exceeds a ceiling.
 *
 * Enforces at the signing layer, not the application layer — even if a
 * compromised server constructs a high-value transaction, the MPC key circle
 * will refuse to sign it.
 *
 * @param maxUsd - Maximum permitted transaction value in USD.
 * @returns Cedar policy source code.
 */
export function maxTransactionAmount(maxUsd: number): CedarPolicyDef {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("maxTransactionAmount: maxUsd must be a positive finite number");
  }
  // Cedar uses decimal literals. The comparison is >, so a $10,000 cap
  // permits exactly $10,000 and forbids $10,000.01.
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `when {`,
    `  context.transaction.amountUsd > decimal("${maxUsd.toFixed(2)}")`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: `Forbid transactions above $${maxUsd.toFixed(2)}`,
  };
}

/**
 * PERMIT transactions only to a known set of recipient addresses.
 *
 * Use for treasury operations where the set of valid destinations is small
 * and known in advance (e.g. exchange deposit addresses, payroll contracts).
 *
 * @param addresses - Allowed destination addresses (case-insensitive match).
 * @returns Cedar policy source code.
 */
export function allowedRecipients(addresses: string[]): CedarPolicyDef {
  if (!addresses.length) {
    throw new Error("allowedRecipients: at least one address is required");
  }
  // Cedar's `in` operator works on sets. Addresses are lowercased because
  // Ethereum addresses are case-insensitive (EIP-55 is a checksum, not a
  // different address).
  const set = addresses
    .map((a) => `"${a.toLowerCase()}"`)
    .join(", ");

  const policy = [
    `permit (principal, action == Action::"sign", resource)`,
    `when {`,
    `  context.transaction.to.toLowerCase() in [${set}]`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "PERMIT" as PolicyEffect,
    description: `Permit transactions only to ${addresses.length} allowed recipient(s)`,
  };
}

/**
 * FORBID transactions unless N human approvals have been recorded.
 *
 * For high-value operations (treasury sweeps, large settlements) that should
 * require multi-person authorization beyond the MPC threshold itself.
 *
 * @param threshold - Minimum number of human approvals required.
 * @returns Cedar policy source code.
 */
export function requireApproval(threshold: number): CedarPolicyDef {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("requireApproval: threshold must be a positive integer");
  }
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `when {`,
    `  context.approvals.count < ${threshold}`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: `Require at least ${threshold} human approval(s) before signing`,
  };
}

/**
 * FORBID transactions that would exceed a velocity limit.
 *
 * The policy engine tracks cumulative transaction volume over a sliding
 * window. This policy caps that volume so a key compromise cannot drain
 * more than the limit before detection.
 *
 * @param maxUsd      - Maximum cumulative USD in the window.
 * @param windowSecs  - Window duration in seconds.
 * @returns Cedar policy source code.
 */
export function velocityLimit(maxUsd: number, windowSecs: number): CedarPolicyDef {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("velocityLimit: maxUsd must be a positive finite number");
  }
  if (!Number.isInteger(windowSecs) || windowSecs < 1) {
    throw new Error("velocityLimit: windowSecs must be a positive integer");
  }
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `when {`,
    `  context.velocity.windowSeconds == ${windowSecs} &&`,
    `  context.velocity.cumulativeUsd + context.transaction.amountUsd > decimal("${maxUsd.toFixed(2)}")`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: `Forbid cumulative volume above $${maxUsd.toFixed(2)} in ${windowSecs}s`,
  };
}

/**
 * FORBID transactions to sanctioned addresses.
 *
 * The actual sanctions list is maintained by the policy engine (populated
 * from OFAC SDN, EU sanctions, etc.). This policy activates the check.
 *
 * @returns Cedar policy source code.
 */
export function sanctionsCheck(): CedarPolicyDef {
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `when {`,
    `  context.compliance.sanctioned == true`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: "Forbid transactions to sanctioned addresses",
  };
}

/**
 * FORBID transactions on chains not in an explicit allowlist.
 *
 * Prevents signing for chains the organization hasn't approved, even if
 * the key circle's algorithm supports them.
 *
 * @param chains - Allowed chain identifiers (e.g. "ethereum", "solana").
 * @returns Cedar policy source code.
 */
export function allowedChains(chains: string[]): CedarPolicyDef {
  if (!chains.length) {
    throw new Error("allowedChains: at least one chain is required");
  }
  const set = chains.map((c) => `"${c}"`).join(", ");
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `unless {`,
    `  context.transaction.chain in [${set}]`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: `Forbid signing for chains not in: ${chains.join(", ")}`,
  };
}

/**
 * FORBID transactions outside business hours.
 *
 * For organizations that want to restrict automated signing to monitored
 * hours. Out-of-hours transactions require a human override.
 *
 * @param startHourUtc - Start of business hours (0–23, UTC).
 * @param endHourUtc   - End of business hours (0–23, UTC, exclusive).
 * @returns Cedar policy source code.
 */
export function businessHoursOnly(startHourUtc: number, endHourUtc: number): CedarPolicyDef {
  if (!Number.isInteger(startHourUtc) || startHourUtc < 0 || startHourUtc > 23) {
    throw new Error("businessHoursOnly: startHourUtc must be 0–23");
  }
  if (!Number.isInteger(endHourUtc) || endHourUtc < 0 || endHourUtc > 23) {
    throw new Error("businessHoursOnly: endHourUtc must be 0–23");
  }
  const policy = [
    `forbid (principal, action == Action::"sign", resource)`,
    `unless {`,
    `  context.time.hourUtc >= ${startHourUtc} && context.time.hourUtc < ${endHourUtc}`,
    `};`,
  ].join("\n");

  return {
    cedarPolicy: policy,
    effect: "FORBID" as PolicyEffect,
    description: `Forbid signing outside ${startHourUtc}:00–${endHourUtc}:00 UTC`,
  };
}

// ── Output type ─────────────────────────────────────────────────────────────

/** A Cedar policy definition ready to be submitted to the MPC API. */
export interface CedarPolicyDef {
  /** Cedar policy source code. */
  cedarPolicy: string;
  /** Whether the policy is a PERMIT or FORBID rule. */
  effect: PolicyEffect;
  /** Human-readable description. */
  description: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Basic Cedar syntax validation.
 *
 * This is NOT a full Cedar parser — it checks structural requirements that
 * catch the most common mistakes (missing semicolons, mismatched braces,
 * missing action clause). Full validation happens server-side.
 *
 * @returns An array of issues (empty = valid as far as we can tell).
 */
export function validateCedarSyntax(source: string): string[] {
  const issues: string[] = [];
  const trimmed = source.trim();

  if (!trimmed) {
    issues.push("Policy source is empty");
    return issues;
  }

  // Must start with permit or forbid
  if (!/^(permit|forbid)\s*\(/.test(trimmed)) {
    issues.push('Policy must start with "permit (" or "forbid ("');
  }

  // Must end with semicolon
  if (!trimmed.endsWith(";")) {
    issues.push("Policy must end with a semicolon");
  }

  // Balanced parentheses
  let parens = 0;
  for (const ch of trimmed) {
    if (ch === "(") parens++;
    if (ch === ")") parens--;
    if (parens < 0) break;
  }
  if (parens !== 0) {
    issues.push("Unbalanced parentheses");
  }

  // Balanced braces
  let braces = 0;
  for (const ch of trimmed) {
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (braces < 0) break;
  }
  if (braces !== 0) {
    issues.push("Unbalanced braces");
  }

  return issues;
}
