import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Source-of-funds (SoF) evidence model. When a payment exceeds the SoF
// threshold, the compliance operator collects evidence off-chain, then records
// an attestation on-chain (AttestationRegistry.recordSoF) keyed by a hash of
// that evidence — so the chain proves an attestation exists without publishing
// the underlying documents. This module defines the evidence shape and the
// canonical hashing used both to store and to later verify it.
// ---------------------------------------------------------------------------

export type SoFEvidenceType =
  | "bank-statement"
  | "salary-slip"
  | "sale-of-asset"
  | "investment-redemption"
  | "business-revenue"
  | "inheritance"
  | "other";

export interface SoFEvidence {
  subject: string; // payer wallet address the evidence pertains to
  evidenceType: SoFEvidenceType;
  /** Reference to the stored document (e.g. object-store key / URL); not the doc itself. */
  documentRef: string;
  /** Declared source-of-funds amount, in USDC minor units (6 decimals), as a string. */
  declaredAmount: string;
  /** ISO-8601 timestamp of when the evidence was collected. */
  collectedAt: string;
  /** Optional reviewer note / case id. */
  note?: string;
}

/**
 * Canonical keccak-independent evidence hash (SHA-256 over stable JSON). Stored
 * on-chain as `evidenceHash` in the SoF attestation. Deterministic: the same
 * evidence always hashes identically, so an auditor can re-derive and match it.
 *
 * Returns a 0x-prefixed 32-byte hex string (bytes32-compatible).
 */
export function hashSoFEvidence(evidence: SoFEvidence): string {
  const canonical = JSON.stringify({
    subject: evidence.subject.toLowerCase(),
    evidenceType: evidence.evidenceType,
    documentRef: evidence.documentRef,
    declaredAmount: evidence.declaredAmount,
    collectedAt: evidence.collectedAt,
    note: evidence.note ?? "",
  });
  return "0x" + createHash("sha256").update(canonical).digest("hex");
}

/**
 * Validate an evidence object before it is attested. Throws with a clear reason
 * so the API can 400 with a useful message.
 */
export function validateSoFEvidence(evidence: SoFEvidence): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evidence.subject)) {
    throw new Error("subject must be a 0x EVM address");
  }
  if (!evidence.documentRef?.trim()) throw new Error("documentRef is required");
  if (!/^\d+$/.test(evidence.declaredAmount)) {
    throw new Error("declaredAmount must be an integer string (USDC minor units)");
  }
  if (Number.isNaN(Date.parse(evidence.collectedAt))) {
    throw new Error("collectedAt must be an ISO-8601 timestamp");
  }
}

/**
 * Default attestation validity window (seconds) — a recorded SoF attestation
 * expires after this and must be renewed. 1 year, matching typical periodic
 * KYC/AML refresh cycles.
 */
export const SOF_ATTESTATION_TTL_SECONDS = 365 * 24 * 60 * 60;
