// ---------------------------------------------------------------------------
// Independent evidence.
//
// WHAT "INDEPENDENT" HAS TO MEAN, OR THE WORD IS DECORATION. An audit trail the
// agent runtime can write to is an audit trail the agent runtime can rewrite. If
// the only record of "policy said ALLOW" is a row the same compromised process
// could have inserted, then after an incident there is nothing to distinguish a
// legitimate payment from one an attacker authorized and then documented.
//
// SO EVIDENCE HAS THREE PROPERTIES HERE, AND EACH ONE ANSWERS A DIFFERENT
// QUESTION AN INVESTIGATOR WILL ACTUALLY ASK:
//
//   APPEND-ONLY        "was this record changed after the fact?" A leaf hash is
//                      computed from the bundle at decision time and stored with
//                      it. Recomputing it later either matches or does not.
//
//   CHAINED            "was a record DELETED?" A hash alone cannot answer that —
//                      removing a row leaves no trace in the remaining rows. Each
//                      leaf therefore commits to its predecessor, so a gap breaks
//                      the chain at the point of removal.
//
//   EXTERNALLY ANCHORED "could the operator have rewritten the whole chain?" Yes,
//                      unless the root was published where we cannot reach it.
//                      `merkleRoot` over a batch is the value to anchor; the
//                      anchoring transport is the caller's (a public chain, an
//                      S3 Object-Lock bucket, a WORM log). This module produces
//                      the commitment and does not pretend to publish it.
//
// THE BUNDLE IS THE WHOLE AUTHORIZATION CHAIN, NOT A SUMMARY. Intent, principal,
// delegation, agent identity, revocation state, policy decision with the policy
// VERSIONS it used, recipient verification, approval, route, signing
// authorization, settlement, ledger entries. A receipt that records the outcome
// but not the inputs cannot answer "was this decision correct given what was
// known at the time", which is the only question that matters in a dispute.
//
// CANONICALIZATION IS SHARED WITH mandate.ts. Two components hashing the same
// bundle differently produce an evidence record nobody can verify, and the
// failure presents as tampering.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { canonicalize } from "./mandate";
import type { PolicyCheck, PolicyVerdict } from "./policy";
import type { RecipientDenial } from "./recipient";
import type { Atomic } from "./units";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ── The bundle ─────────────────────────────────────────────────────────────

export interface EvidenceIntent {
  readonly mandateId: string;
  /** Hash of the mandate's signing payload — commits to the exact authority. */
  readonly mandatePayloadHash: string;
  readonly credentialFormat?: string;
  readonly credentialKeyId?: string;
  readonly expiresAt: string;
  readonly authorityScopeHash: string;
}

export interface EvidenceDelegation {
  readonly principalId: string;
  readonly delegationId: string;
  readonly operatorId: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly attestation: string;
  /** Ordered link ids, so the chain can be re-walked from the receipt alone. */
  readonly chain: readonly string[];
}

export interface EvidenceRevocation {
  readonly live: boolean;
  readonly checkedSubjects: number;
  readonly snapshotAgeMs: number;
  readonly maxStalenessMs: number;
}

export interface EvidencePolicy {
  readonly verdict: PolicyVerdict;
  readonly checks: readonly PolicyCheck[];
  readonly evaluatedPolicies: readonly { readonly policyId: string; readonly version: number }[];
  readonly driftScore: number;
  readonly driftSignals: readonly string[];
  readonly requiresApproval: boolean;
}

export interface EvidenceRecipient {
  readonly recipientId: string;
  readonly networkId: string;
  readonly asset: string;
  readonly canonicalDestination: string;
  readonly attestationMethod: string;
  readonly attestedAt: string;
  readonly firstUse: boolean;
  readonly denial?: RecipientDenial;
  readonly invoiceId?: string;
  readonly cartHash?: string;
}

export interface EvidenceApproval {
  readonly required: boolean;
  readonly approverRole?: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly timeoutSeconds?: number;
  readonly onTimeout?: string;
  /** Hash of the step-up evidence, never the evidence itself. */
  readonly approvalEvidenceHash?: string;
}

export interface EvidenceRoute {
  readonly railId: string;
  readonly railQuoteId: string;
  readonly score: number;
  readonly feeAtomic: Atomic;
  readonly finality: string;
  /** Rails considered and why each was excluded. */
  readonly rejected: readonly { readonly railId: string; readonly reason: string }[];
}

export interface EvidenceSigning {
  readonly executionTokenId: string;
  readonly payloadHash: string;
  readonly backend: string;
  readonly keyId: string;
  readonly keyVersion?: string;
  readonly hardwareBacked: boolean;
  readonly signedAt?: string;
}

export interface EvidenceSettlement {
  readonly state: string;
  readonly railRef?: string;
  readonly settlementRef?: string;
  readonly settledAt?: string;
  readonly feeAtomic?: Atomic;
  readonly failureReason?: string;
}

export interface EvidenceLedger {
  readonly ledgerTxId?: string;
  readonly postings: readonly {
    readonly accountCode: string;
    readonly side: "debit" | "credit";
    readonly amountMinor: number;
  }[];
  readonly balanced: boolean;
}

/**
 * Everything known about one payment's authorization and execution.
 *
 * `sequence` is the payment's position in this organization's evidence chain and
 * `previousLeafHash` is the leaf before it. Together they are what makes a
 * DELETION detectable; without them the strongest available statement is "each
 * surviving record is unmodified", which an attacker satisfies by removing the
 * inconvenient one.
 */
export interface EvidenceBundle {
  readonly paymentId: string;
  readonly organizationId: string;
  readonly sequence: number;
  readonly previousLeafHash: string | null;
  readonly decidedAt: string;
  readonly amountAtomic: Atomic;
  readonly asset: string;
  readonly intent: EvidenceIntent;
  readonly delegation: EvidenceDelegation;
  readonly revocation: EvidenceRevocation;
  readonly policy: EvidencePolicy;
  readonly recipient: EvidenceRecipient;
  readonly approval: EvidenceApproval;
  readonly route?: EvidenceRoute;
  readonly signing?: EvidenceSigning;
  readonly settlement?: EvidenceSettlement;
  readonly ledger?: EvidenceLedger;
  /** Free-form correlation ids. Never secrets, never PII. */
  readonly trace: {
    readonly requestId: string;
    readonly idempotencyKey?: string;
  };
}

/**
 * The leaf hash: SHA-256 over the canonical bundle, domain-separated.
 *
 * The domain prefix stops a hash computed over some other structure from ever
 * being mistaken for an evidence leaf. Without it, any component that happens to
 * SHA-256 canonical JSON produces values in the same space as this one.
 */
export const EVIDENCE_DOMAIN = "furlpay/evidence-leaf/v1";

export function evidenceLeafHash(bundle: EvidenceBundle): string {
  return sha256Hex(`${EVIDENCE_DOMAIN}\n${canonicalize(bundle)}`);
}

/** Hash of an authority scope, for the intent section. */
export function authorityScopeHash(scope: unknown): string {
  return sha256Hex(`furlpay/authority-scope/v1\n${canonicalize(scope)}`);
}

/** Recompute and compare. The only way to answer "was this record altered?". */
export function verifyLeaf(bundle: EvidenceBundle, storedLeafHash: string): boolean {
  return timingSafeEqualHex(evidenceLeafHash(bundle), storedLeafHash);
}

/** Constant-time hex comparison. Both values are public hashes, so this is
 *  defence in depth rather than a requirement — but a verification helper that
 *  short-circuits teaches the wrong pattern to its next caller. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Merkle ─────────────────────────────────────────────────────────────────

export const MERKLE_LEAF_PREFIX = "furlpay/merkle-leaf/v1\n";
export const MERKLE_NODE_PREFIX = "furlpay/merkle-node/v1\n";

/**
 * Merkle root over a batch of leaf hashes.
 *
 * ODD LEVELS DUPLICATE THE LAST NODE, and that choice has a known weakness worth
 * stating rather than hiding: duplication makes some distinct leaf multisets
 * produce the same root (the CVE-2012-2459 shape). It is acceptable here ONLY
 * because leaf hashes are domain-separated and each commits to a unique
 * `(organizationId, sequence)` pair, so a batch cannot contain a duplicate leaf
 * in the first place. Change the leaf construction and this assumption has to be
 * revisited — which is why it is written down.
 *
 * Leaves and internal nodes use DIFFERENT prefixes so a leaf hash can never be
 * presented as an internal node in a forged proof (the second-preimage attack
 * that unprefixed Merkle trees are vulnerable to).
 */
export function merkleRoot(leafHashes: readonly string[]): string | null {
  if (leafHashes.length === 0) return null;
  let level = leafHashes.map((h) => sha256Hex(`${MERKLE_LEAF_PREFIX}${h}`));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256Hex(`${MERKLE_NODE_PREFIX}${left}${right}`));
    }
    level = next;
  }
  return level[0];
}

export interface MerkleProofStep {
  readonly sibling: string;
  readonly position: "left" | "right";
}

/** Inclusion proof for `index` in `leafHashes`. Null when out of range. */
export function merkleProof(leafHashes: readonly string[], index: number): readonly MerkleProofStep[] | null {
  if (index < 0 || index >= leafHashes.length) return null;
  let level = leafHashes.map((h) => sha256Hex(`${MERKLE_LEAF_PREFIX}${h}`));
  let position = index;
  const steps: MerkleProofStep[] = [];
  while (level.length > 1) {
    const isRight = position % 2 === 1;
    const siblingIndex = isRight ? position - 1 : position + 1;
    const sibling = siblingIndex < level.length ? level[siblingIndex] : level[position];
    steps.push({ sibling, position: isRight ? "left" : "right" });
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256Hex(`${MERKLE_NODE_PREFIX}${left}${right}`));
    }
    level = next;
    position = Math.floor(position / 2);
  }
  return steps;
}

/** Verify an inclusion proof against a root. */
export function verifyMerkleProof(
  leafHash: string,
  proof: readonly MerkleProofStep[],
  root: string
): boolean {
  let node = sha256Hex(`${MERKLE_LEAF_PREFIX}${leafHash}`);
  for (const step of proof) {
    node =
      step.position === "left"
        ? sha256Hex(`${MERKLE_NODE_PREFIX}${step.sibling}${node}`)
        : sha256Hex(`${MERKLE_NODE_PREFIX}${node}${step.sibling}`);
  }
  return timingSafeEqualHex(node, root);
}

// ── Chain verification ─────────────────────────────────────────────────────

export interface ChainLink {
  readonly sequence: number;
  readonly leafHash: string;
  readonly previousLeafHash: string | null;
}

export type ChainVerification =
  | { readonly ok: true; readonly length: number }
  | {
      readonly ok: false;
      readonly reason: "sequence_gap" | "broken_link" | "duplicate_sequence" | "bad_genesis";
      readonly atSequence: number;
      readonly detail: string;
    };

/**
 * Verify an organization's evidence chain is intact and complete.
 *
 * Checks BOTH properties, because either alone is insufficient: contiguous
 * sequence numbers with mismatched back-links means a record was replaced, and
 * correct back-links with a sequence gap means the chain was re-linked around a
 * deletion.
 */
export function verifyEvidenceChain(links: readonly ChainLink[]): ChainVerification {
  if (links.length === 0) return { ok: true, length: 0 };
  const sorted = [...links].sort((a, b) => a.sequence - b.sequence);

  if (sorted[0].previousLeafHash !== null) {
    return {
      ok: false,
      reason: "bad_genesis",
      atSequence: sorted[0].sequence,
      detail: "the first link in the supplied range points at a predecessor that is not present",
    };
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.sequence === prev.sequence) {
      return {
        ok: false,
        reason: "duplicate_sequence",
        atSequence: cur.sequence,
        detail: `two evidence records share sequence ${cur.sequence}`,
      };
    }
    if (cur.sequence !== prev.sequence + 1) {
      return {
        ok: false,
        reason: "sequence_gap",
        atSequence: prev.sequence + 1,
        detail: `sequence jumps from ${prev.sequence} to ${cur.sequence}; a record is missing`,
      };
    }
    if (cur.previousLeafHash !== prev.leafHash) {
      return {
        ok: false,
        reason: "broken_link",
        atSequence: cur.sequence,
        detail: `record ${cur.sequence} commits to a predecessor hash that is not record ${prev.sequence}`,
      };
    }
  }
  return { ok: true, length: sorted.length };
}

/** Whether a settled payment's evidence is complete enough to defend. Used by
 *  reconciliation: a SETTLED payment missing any of these is a control failure,
 *  not a cosmetic gap. */
export function evidenceComplete(bundle: EvidenceBundle): { ok: boolean; missing: readonly string[] } {
  const missing: string[] = [];
  if (!bundle.intent.mandatePayloadHash) missing.push("intent.mandatePayloadHash");
  if (bundle.delegation.chain.length < 4) missing.push("delegation.chain");
  if (!bundle.policy.verdict) missing.push("policy.verdict");
  if (bundle.policy.evaluatedPolicies.length === 0) missing.push("policy.evaluatedPolicies");
  if (!bundle.recipient.canonicalDestination) missing.push("recipient.canonicalDestination");
  if (bundle.approval.required && !bundle.approval.approvedBy) missing.push("approval.approvedBy");
  if (!bundle.route) missing.push("route");
  if (!bundle.signing) missing.push("signing");
  if (!bundle.settlement?.settlementRef) missing.push("settlement.settlementRef");
  if (!bundle.ledger?.ledgerTxId) missing.push("ledger.ledgerTxId");
  if (bundle.ledger && !bundle.ledger.balanced) missing.push("ledger.balanced");
  return { ok: missing.length === 0, missing };
}
