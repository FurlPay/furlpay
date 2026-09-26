import { createHash, createHmac, randomBytes, randomUUID } from "crypto";
import { kvGet, kvSet } from "@/lib/kv";
import { getAccountDurable, type UserAccount } from "@/lib/store";
import { audit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/ops/events";
import type { Role } from "@/lib/session";

// ---------------------------------------------------------------------------
// Sovereign Authority Gate & Law Enforcement Request System (LERS).
//
// THREAT MODEL — REVOLUT SEPTEMBER 2026 LESSON:
// Attackers compromised legitimate government email infrastructure (Italian
// agency domain) and submitted fraudulent Emergency Data Requests (EDRs).
// Because requests came from a "trusted domain" and cited urgent danger,
// compliance staff bypassed standard verification and released customer dossiers.
//
// ARCHITECTURAL INVARIANTS:
//   1. trusted domain != trusted sender != authorized disclosure.
//   2. Email ALONE can NEVER authorize disclosure (even with valid SPF/DKIM/DMARC).
//   3. Mandatory out-of-band agency verification (independent directory/switchboard).
//   4. Two-Person Integrity (Dual Control): Reviewer A stages; Reviewer B approves.
//      Reviewer A cannot be Reviewer B. Single-admin disclosure is strictly blocked.
//   5. Data minimization: DTO scoping only. NEVER raw passport images, selfies,
//      passkeys, private keys, or TOTP secrets.
//   6. Tamper-evident cryptographic hash chain (Merkle-style SHA-256 blocks).
//   7. Ephemeral, single-use, cryptographically signed disclosure tokens (TTL <= 1h).
// ---------------------------------------------------------------------------

export const STATUTORY_BASES = [
  "court_order",
  "mutual_legal_assistance_treaty",
  "search_warrant",
  "subpoena",
  "emergency_data_request",
] as const;
export type StatutoryBasis = (typeof STATUTORY_BASES)[number];

export const TARGET_TYPES = [
  "email",
  "wallet_address",
  "user_id",
  "phone",
  "tx_hash",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const DISCLOSURE_CATEGORIES = [
  "basic_subscriber",
  "transaction_records",
  "ip_login_history",
  "kyc_summary",
] as const;
export type DisclosureCategory = (typeof DISCLOSURE_CATEGORIES)[number];

export const REQUEST_STATUSES = [
  "submitted",
  "agency_verified",
  "staged",
  "approved",
  "disclosed",
  "rejected",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface AuditBlock {
  index: number;
  timestamp: string;
  requestId: string;
  action: string;
  actorId: string;
  actorRole: string;
  payloadHash: string;
  prevHash: string;
  blockHash: string;
}

export interface OutOfBandVerification {
  verifiedAt: string;
  verifiedBy: string; // Actor ID
  method: "agency_switchboard_callback" | "diplomatic_channel" | "official_pki_signature" | "in_person_service";
  contactNumberUsed: string; // Phone number or official registry URI
  officialReference: string; // Incident / dispatch reference
  notes: string;
}

export interface DisclosureScope {
  categories: DisclosureCategory[];
  startDate?: string; // ISO8601
  endDate?: string; // ISO8601
  justification: string;
}

export interface SanitizedDisclosurePackage {
  packageId: string;
  requestId: string;
  generatedAt: string;
  expiresAt: string;
  subscriber?: {
    id: string;
    name: string;
    emailMasked: string;
    region: string;
    registrationDate: string;
    kycTier: number;
    accountStatus: string;
  };
  transactions?: Array<{
    id: string;
    timestamp: string;
    amountUsd: number;
    direction: string;
    category: string;
    status: string;
    token?: string;
    txHash?: string;
  }>;
  kycSummary?: {
    status: string;
    tier: number;
    verified: boolean;
    country: string;
    // Strictly zero raw documents or biometric data
  };
  loginHistory?: Array<{
    timestamp: string;
    location: string;
    deviceType: string;
  }>;
}

export interface AuthorityRequest {
  id: string; // req_uuid
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;

  // Requester identity
  agencyName: string;
  agencyCountry: string; // ISO 3166-1 alpha-2
  jurisdiction: string;
  officialEmail: string;
  officerName: string;
  badgeId: string;
  docketNumber: string;
  statutoryBasis: StatutoryBasis;
  emergencyDeclaration?: string; // Required if statutoryBasis === 'emergency_data_request'

  // Target query
  targetType: TargetType;
  targetIdentifier: string;

  // Multi-party workflow state
  outOfBandVerification?: OutOfBandVerification;
  stagedScope?: DisclosureScope;
  stagedBy?: string;
  stagedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;

  // Disclosure payload
  disclosureTokenHash?: string;
  disclosureTokenExpiresAt?: string;
  disclosurePackage?: SanitizedDisclosurePackage;

  // Cryptographic audit chain
  auditChain: AuditBlock[];
}

const GENESIS_HASH = "0".repeat(64);

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function computeBlockHash(block: Omit<AuditBlock, "blockHash">): string {
  const content = `${block.index}:${block.timestamp}:${block.requestId}:${block.action}:${block.actorId}:${block.actorRole}:${block.payloadHash}:${block.prevHash}`;
  return sha256(content);
}

function appendAuditBlock(
  chain: AuditBlock[],
  requestId: string,
  action: string,
  actorId: string,
  actorRole: string,
  payload: unknown
): AuditBlock {
  const index = chain.length;
  const prevHash = index === 0 ? GENESIS_HASH : chain[index - 1].blockHash;
  const payloadHash = sha256(JSON.stringify(payload ?? {}));
  const timestamp = new Date().toISOString();

  const blockCandidate: Omit<AuditBlock, "blockHash"> = {
    index,
    timestamp,
    requestId,
    action,
    actorId,
    actorRole,
    payloadHash,
    prevHash,
  };

  const block: AuditBlock = {
    ...blockCandidate,
    blockHash: computeBlockHash(blockCandidate),
  };

  chain.push(block);
  return block;
}

export function verifyAuditChain(chain: AuditBlock[]): boolean {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    if (block.index !== i) return false;
    const expectedPrev = i === 0 ? GENESIS_HASH : chain[i - 1].blockHash;
    if (block.prevHash !== expectedPrev) return false;
    const { blockHash, ...rest } = block;
    if (computeBlockHash(rest) !== blockHash) return false;
  }
  return true;
}

const reqKey = (id: string) => `compliance:auth_req:${id}`;
const INDEX_KEY = "compliance:auth_req:index";

export async function getAuthorityRequest(id: string): Promise<AuthorityRequest | null> {
  return kvGet<AuthorityRequest>(reqKey(id));
}

export async function listAuthorityRequests(): Promise<AuthorityRequest[]> {
  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  const reqs: AuthorityRequest[] = [];
  for (const id of ids) {
    const r = await getAuthorityRequest(id);
    if (r) reqs.push(r);
  }
  return reqs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveAuthorityRequest(req: AuthorityRequest): Promise<void> {
  await kvSet(reqKey(req.id), req);
  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  if (!ids.includes(req.id)) {
    await kvSet(INDEX_KEY, [req.id, ...ids].slice(0, 1000));
  }
}

/**
 * Stage 1: Ingest external authority request via hardened intake portal.
 */
export async function createAuthorityRequest(input: {
  agencyName: string;
  agencyCountry: string;
  jurisdiction: string;
  officialEmail: string;
  officerName: string;
  badgeId: string;
  docketNumber: string;
  statutoryBasis: StatutoryBasis;
  emergencyDeclaration?: string;
  targetType: TargetType;
  targetIdentifier: string;
  submittedByIp?: string;
}): Promise<AuthorityRequest> {
  // Input validation & emergency hardening
  if (input.statutoryBasis === "emergency_data_request") {
    if (!input.emergencyDeclaration || input.emergencyDeclaration.trim().length < 20) {
      throw new Error(
        "Emergency Data Requests (EDRs) require a detailed statutory affirmation of imminent danger to life or physical injury."
      );
    }
  }

  const id = `req_${randomUUID()}`;
  const now = new Date().toISOString();
  const auditChain: AuditBlock[] = [];

  appendAuditBlock(auditChain, id, "REQUEST_SUBMITTED", "intake_portal", "external_authority", {
    agency: input.agencyName,
    country: input.agencyCountry,
    statutoryBasis: input.statutoryBasis,
    docketNumber: input.docketNumber,
    targetType: input.targetType,
  });

  const request: AuthorityRequest = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "submitted",
    agencyName: input.agencyName.trim(),
    agencyCountry: input.agencyCountry.trim().toUpperCase(),
    jurisdiction: input.jurisdiction.trim(),
    officialEmail: input.officialEmail.trim().toLowerCase(),
    officerName: input.officerName.trim(),
    badgeId: input.badgeId.trim(),
    docketNumber: input.docketNumber.trim(),
    statutoryBasis: input.statutoryBasis,
    emergencyDeclaration: input.emergencyDeclaration?.trim(),
    targetType: input.targetType,
    targetIdentifier: input.targetIdentifier.trim(),
    auditChain,
  };

  await saveAuthorityRequest(request);

  await recordSecurityEvent({
    rail: "transfers",
    kind: "authority_request_submitted",
    severity: input.statutoryBasis === "emergency_data_request" ? "high" : "medium",
    detail: `Authority request ${id} received from ${request.agencyName} (${request.statutoryBasis})`,
    actor: "intake_portal",
  }).catch(() => {});

  return request;
}

/**
 * Stage 2: Mandatory out-of-band agency verification.
 * Email confirmation alone is explicitly REFUSED.
 */
export async function recordAgencyVerification(
  requestId: string,
  verifier: { id: string; role: Role },
  verification: {
    method: OutOfBandVerification["method"];
    contactNumberUsed: string;
    officialReference: string;
    notes: string;
  }
): Promise<AuthorityRequest> {
  const req = await getAuthorityRequest(requestId);
  if (!req) throw new Error("Authority request not found.");
  if (req.status !== "submitted") {
    throw new Error(`Cannot verify agency for request in status '${req.status}'.`);
  }

  // Explicit check against the Revolut attack path:
  if (!verification.contactNumberUsed || verification.contactNumberUsed.length < 5) {
    throw new Error("Independent out-of-band contact directory verification is mandatory.");
  }

  const oob: OutOfBandVerification = {
    verifiedAt: new Date().toISOString(),
    verifiedBy: verifier.id,
    method: verification.method,
    contactNumberUsed: verification.contactNumberUsed,
    officialReference: verification.officialReference,
    notes: verification.notes,
  };

  req.outOfBandVerification = oob;
  req.status = "agency_verified";
  req.updatedAt = new Date().toISOString();

  appendAuditBlock(req.auditChain, req.id, "AGENCY_OUT_OF_BAND_VERIFIED", verifier.id, verifier.role, {
    method: oob.method,
    ref: oob.officialReference,
  });

  await saveAuthorityRequest(req);
  return req;
}

/**
 * Stage 3: Compliance Officer stages the data-minimized disclosure bundle.
 */
export async function stageDisclosureBundle(
  requestId: string,
  stager: { id: string; role: Role },
  scope: DisclosureScope,
  targetAccount: UserAccount | null
): Promise<AuthorityRequest> {
  const req = await getAuthorityRequest(requestId);
  if (!req) throw new Error("Authority request not found.");
  if (req.status !== "agency_verified") {
    throw new Error("Request must complete out-of-band agency verification before staging disclosure.");
  }

  if (!scope.categories || scope.categories.length === 0) {
    throw new Error("At least one disclosure category must be explicitly requested.");
  }

  req.stagedScope = scope;
  req.stagedBy = stager.id;
  req.stagedAt = new Date().toISOString();
  req.status = "staged";
  req.updatedAt = req.stagedAt;

  // Prepare the sanitized DTO bundle
  req.disclosurePackage = targetAccount
    ? generateSanitizedDisclosurePackage(req.id, targetAccount, scope)
    : undefined;

  appendAuditBlock(req.auditChain, req.id, "DISCLOSURE_STAGED", stager.id, stager.role, {
    categories: scope.categories,
    hasTargetAccount: Boolean(targetAccount),
  });

  await saveAuthorityRequest(req);
  return req;
}

/**
 * Stage 4: Second-Person Reviewer approves disclosure (Two-Person Integrity / Dual Control).
 * Invariant: Approver MUST NOT be the staging officer!
 */
export async function approveAuthorityDisclosure(
  requestId: string,
  approver: { id: string; role: Role }
): Promise<{ request: AuthorityRequest; rawDisclosureToken: string }> {
  const req = await getAuthorityRequest(requestId);
  if (!req) throw new Error("Authority request not found.");
  if (req.status !== "staged") {
    throw new Error(`Cannot approve disclosure in status '${req.status}'. Must be 'staged'.`);
  }

  // TWO-PERSON INTEGRITY ENFORCEMENT:
  // A single admin/compliance officer CANNOT unilaterally approve a disclosure.
  if (req.stagedBy === approver.id) {
    throw new Error(
      "Dual-control invariant violation: The approving officer must be a distinct human compliance/legal authority from the staging officer."
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1-hour TTL

  // Mint single-use high-entropy disclosure token
  const rawDisclosureToken = `dkl_${randomBytes(32).toString("hex")}`;
  const tokenHash = sha256(rawDisclosureToken);

  req.status = "approved";
  req.approvedBy = approver.id;
  req.approvedAt = now.toISOString();
  req.disclosureTokenHash = tokenHash;
  req.disclosureTokenExpiresAt = expiresAt.toISOString();
  req.updatedAt = now.toISOString();

  appendAuditBlock(req.auditChain, req.id, "DISCLOSURE_APPROVED", approver.id, approver.role, {
    stagedBy: req.stagedBy,
    approvedBy: approver.id,
    expiresAt: req.disclosureTokenExpiresAt,
  });

  await saveAuthorityRequest(req);

  await recordSecurityEvent({
    rail: "transfers",
    kind: "authority_disclosure_approved",
    severity: "high",
    detail: `Disclosure approved for ${req.id} by dual authorization (${req.stagedBy} + ${approver.id})`,
    actor: approver.id,
  }).catch(() => {});

  return { request: req, rawDisclosureToken };
}

/**
 * Stage 5: Redeem single-use disclosure token to retrieve sanitized package.
 */
export async function retrieveDisclosurePackage(
  requestId: string,
  rawToken: string
): Promise<SanitizedDisclosurePackage> {
  const req = await getAuthorityRequest(requestId);
  if (!req) throw new Error("Authority request not found.");
  if (req.status !== "approved") {
    throw new Error(`Package not in approved state (status: ${req.status}).`);
  }

  const tokenHash = sha256(rawToken);
  if (req.disclosureTokenHash !== tokenHash) {
    throw new Error("Invalid disclosure authorization token.");
  }

  if (!req.disclosureTokenExpiresAt || new Date(req.disclosureTokenExpiresAt).getTime() < Date.now()) {
    throw new Error("Disclosure token has expired.");
  }

  if (!req.disclosurePackage) {
    throw new Error("No target record matched the disclosure criteria.");
  }

  // Token is strictly SINGLE-USE: invalidate immediately on read
  req.disclosureTokenHash = undefined;
  req.status = "disclosed";
  req.updatedAt = new Date().toISOString();

  appendAuditBlock(req.auditChain, req.id, "DISCLOSURE_ACCESSED", "token_holder", "authority_client", {
    packageId: req.disclosurePackage.packageId,
  });

  await saveAuthorityRequest(req);
  return req.disclosurePackage;
}

/**
 * Reject request with immutable audit reason.
 */
export async function rejectAuthorityRequest(
  requestId: string,
  reviewer: { id: string; role: Role },
  reason: string
): Promise<AuthorityRequest> {
  const req = await getAuthorityRequest(requestId);
  if (!req) throw new Error("Authority request not found.");

  req.status = "rejected";
  req.rejectedBy = reviewer.id;
  req.rejectedAt = new Date().toISOString();
  req.rejectionReason = reason;
  req.updatedAt = req.rejectedAt;

  appendAuditBlock(req.auditChain, req.id, "REQUEST_REJECTED", reviewer.id, reviewer.role, {
    reason,
  });

  await saveAuthorityRequest(req);
  return req;
}

/**
 * Data Minimization Engine:
 * Generates an explicitly scoped, sanitized DTO package.
 * Strips secrets, raw IDs, private keys, TOTP secrets, selfies, and unrequested data.
 */
export function generateSanitizedDisclosurePackage(
  requestId: string,
  account: UserAccount,
  scope: DisclosureScope
): SanitizedDisclosurePackage {
  const u = account.user;
  const categories = new Set(scope.categories);

  const pkg: SanitizedDisclosurePackage = {
    packageId: `pkg_${randomUUID().slice(0, 16)}`,
    requestId,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  if (categories.has("basic_subscriber")) {
    const emailParts = u.email.split("@");
    const maskedEmail = `${emailParts[0].slice(0, 2)}***@${emailParts[1] ?? "masked"}`;
    pkg.subscriber = {
      id: u.id,
      name: u.name,
      emailMasked: maskedEmail,
      region: u.region,
      registrationDate: u.security.lastLogin,
      kycTier: u.kycTier,
      accountStatus: u.security.accountLocked ? "locked" : "active",
    };
  }

  if (categories.has("transaction_records")) {
    const startMs = scope.startDate ? new Date(scope.startDate).getTime() : 0;
    const endMs = scope.endDate ? new Date(scope.endDate).getTime() : Infinity;

    pkg.transactions = account.transactions
      .filter((t) => {
        const ts = new Date(t.timestamp).getTime();
        return ts >= startMs && ts <= endMs;
      })
      .map((t) => ({
        id: t.id,
        timestamp: t.timestamp,
        amountUsd: t.amountUsd,
        direction: t.direction,
        category: t.category,
        status: t.status,
        token: t.token,
      }));

  }

  if (categories.has("kyc_summary")) {
    pkg.kycSummary = {
      status: u.kycStatus,
      tier: u.kycTier,
      verified: u.kycStatus === "verified",
      country: u.taxResidency ?? u.region,
      // ZERO raw passport scans, selfies, or biometrics are ever packaged
    };
  }

  if (categories.has("ip_login_history")) {
    pkg.loginHistory = u.security.devices.map((d) => ({
      timestamp: d.lastActive,
      location: d.location,
      deviceType: d.name,
    }));
  }

  return pkg;
}
