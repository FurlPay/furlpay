import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { kvGet, kvSet, kvSetNx, kvDel } from "@/lib/kv";
import { getAccountDurable, type UserAccount } from "@/lib/store";
import { audit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/ops/events";
import { noteSensitiveAccess } from "@/lib/ops/dataAccessAnomaly";
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

/**
 * What the compliance console is allowed to see.
 *
 * THE BUG THIS TYPE EXISTS TO KILL. Every workflow route returned the whole
 * `AuthorityRequest`, and `stageDisclosureBundle` writes the fully-populated
 * `disclosurePackage` onto it. So a single officer could self-attest the
 * out-of-band call, stage the bundle, and read the complete dossier out of the
 * HTTP response to their OWN staging request — no second approver, no token.
 * `GET /[id]` and the list endpoint served it too, the latter returning every
 * dossier ever staged in one response.
 *
 * Two-person integrity was enforced on `approveAuthorityDisclosure`, which mints
 * the token. The control was on the token while the data sat in the open beside
 * it: a confused deputy, and exactly the single-operator disclosure this module's
 * header claims is "strictly blocked".
 *
 * So the package is no longer part of the readable record. The console gets
 * workflow state — enough to review, approve or refuse — plus a COUNT of what is
 * staged, because "is a bundle ready, and how big is it" is a question an officer
 * legitimately needs answered and does not require the records themselves.
 */
export type RedactedAuthorityRequest = Omit<
  AuthorityRequest,
  "disclosurePackage" | "disclosureTokenHash"
> & {
  /** Whether a bundle has been generated, without shipping it. */
  packageStaged: boolean;
  /** How many records each requested category resolved to. Never the records. */
  packageRecordCounts?: {
    subscriber: number;
    transactions: number;
    kycSummary: number;
    loginHistory: number;
  };
};

/**
 * Strips the payload from a request record.
 *
 * Destructured rather than deleted from a copy, so a field added to
 * `AuthorityRequest` later is carried through by the spread and only these two
 * are ever dropped — and TypeScript flags the `Omit` if either is renamed.
 */
export function redactAuthorityRequest(req: AuthorityRequest): RedactedAuthorityRequest {
  const { disclosurePackage, disclosureTokenHash: _hash, ...safe } = req;
  return {
    ...safe,
    packageStaged: Boolean(disclosurePackage),
    packageRecordCounts: disclosurePackage
      ? {
          subscriber: disclosurePackage.subscriber ? 1 : 0,
          transactions: disclosurePackage.transactions?.length ?? 0,
          kycSummary: disclosurePackage.kycSummary ? 1 : 0,
          loginHistory: disclosurePackage.loginHistory?.length ?? 0,
        }
      : undefined,
  };
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

/**
 * The console list. REDACTED BY RETURN TYPE, not by the caller remembering.
 *
 * This endpoint was the worst of the three leaks: one authenticated GET returned
 * every dossier that had ever been staged, which is the concentrated dossier the
 * threat model exists to prevent. Returning the redacted shape here means a route
 * cannot leak packages by forgetting to map — there is nothing to forget.
 */
export async function listAuthorityRequests(): Promise<RedactedAuthorityRequest[]> {
  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  const reqs: RedactedAuthorityRequest[] = [];
  for (const id of ids) {
    const r = await getAuthorityRequest(id);
    if (r) reqs.push(redactAuthorityRequest(r));
  }
  return reqs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Index cap. Generous — the constraint that matters is WHICH entry is dropped. */
const INDEX_CAP = 1000;

/** Statuses that are finished. Only these may be evicted to make room. */
const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set(["disclosed", "rejected"]);

/**
 * Persist a request and keep it findable from the console.
 *
 * THE EVICTION BUG. This was `[req.id, ...ids].slice(0, 1000)` — newest first,
 * hard truncation at the tail. The intake endpoint is UNAUTHENTICATED by design
 * (external agencies have no FurlPay session), so anyone could submit a thousand
 * junk requests and silently push the OLDEST real ones out of the index. The
 * records survived in KV, but they vanished from `listAuthorityRequests`, which
 * is the only way a compliance officer discovers there is something to review.
 *
 * That is a denial of oversight, and it is a more attractive attack than it
 * looks: the quietest way to get a fraudulent request approved is to make sure
 * nobody is looking at the queue, and the second quietest is to bury the
 * evidence of one you already submitted. Rate limiting raises the cost from one
 * IP; it does not remove the primitive.
 *
 * So eviction is now selective. A pending request — anything not `disclosed` or
 * `rejected` — is never dropped to make room for a newer one; only finished
 * records are. If the pending set alone reaches the cap, that is itself the
 * alarm, and it is raised rather than absorbed.
 */
async function saveAuthorityRequest(req: AuthorityRequest): Promise<void> {
  await kvSet(reqKey(req.id), req);

  const ids = (await kvGet<string[]>(INDEX_KEY)) ?? [];
  if (ids.includes(req.id)) return;

  const next = [req.id, ...ids];
  if (next.length <= INDEX_CAP) {
    await kvSet(INDEX_KEY, next);
    return;
  }

  // Over cap. Resolve statuses so terminal records can be dropped first.
  // Sequential rather than Promise.all: this path runs only at the cap, and a
  // thousand-way fan-out under a flood is the wrong thing to do while being
  // flooded.
  const pending: string[] = [];
  const terminal: string[] = [];
  for (const id of next) {
    if (id === req.id) {
      pending.push(id);
      continue;
    }
    const record = await kvGet<AuthorityRequest>(reqKey(id));
    // An id whose record has expired out of KV is already unreachable; treat it
    // as terminal so it is the first thing dropped.
    if (!record || TERMINAL_STATUSES.has(record.status)) terminal.push(id);
    else pending.push(id);
  }

  if (pending.length >= INDEX_CAP) {
    // Every slot is a live request. Something is wrong — either a genuine surge
    // or exactly the flood this function exists to survive. Keep the pending
    // set (losing a live statutory request is worse than an oversized index)
    // and make the condition visible.
    await recordSecurityEvent({
      rail: "transfers",
      kind: "authority_index_saturated",
      severity: "high",
      detail:
        `Authority request index holds ${pending.length} non-terminal requests ` +
        `(cap ${INDEX_CAP}). Possible intake flood — review the queue.`,
      actor: "intake_portal",
    }).catch(() => {});
    await kvSet(INDEX_KEY, pending);
    return;
  }

  // Keep every pending request, then fill the remainder with the most recent
  // terminal ones, preserving newest-first order overall.
  const keep = new Set([...pending, ...terminal.slice(0, INDEX_CAP - pending.length)]);
  await kvSet(INDEX_KEY, next.filter((id) => keep.has(id)));
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

  // One staging is casework; a run of them is someone working through a list.
  // The per-request authorization above cannot see that, because each one is
  // individually legitimate — which is precisely the Revolut shape.
  await noteSensitiveAccess({
    kind: "authority_request_staged",
    actorId: stager.id,
    resourceRef: req.id,
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

  // ── SINGLE USE MUST BE ATOMIC ────────────────────────────────────────────
  //
  // Everything below is read-check-write. Two clients presenting the same token
  // at the same moment both read `approved`, both pass the hash comparison, and
  // both receive the dossier — "single-use" enforced by a later write that the
  // other request has already raced past. A disclosure token travels by email
  // and gets clicked twice; this is not a theoretical interleaving.
  //
  // The same set-if-absent pattern the swap-quote redeemer uses, and for the
  // same reason: only one caller can win the claim, and the loser is told the
  // token is spent rather than being handed a second copy of a customer's file.
  // Claimed BEFORE the token is verified so a valid token cannot be raced by a
  // flood of invalid ones.
  // The claim is RELEASED on every failure path below. Holding it after a bad
  // token would be its own denial of service: the request id circulates far more
  // widely than the token, so anyone holding one could lock the real authority
  // out for the claim's lifetime by submitting garbage in a loop.
  const claim = await kvSetNx(`${reqKey(requestId)}:redeeming`, Date.now(), 60);
  if (!claim) {
    throw new Error("Disclosure token is already being redeemed.");
  }

  try {
    const tokenHash = sha256(rawToken);
    // Constant-time. Both sides are fixed-length hex digests, so a length
    // difference means a corrupt record rather than attacker-chosen input and is
    // checked first — `timingSafeEqual` throws on unequal lengths.
    const presented = Buffer.from(tokenHash, "utf8");
    const stored = Buffer.from(req.disclosureTokenHash ?? "", "utf8");
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      throw new Error("Invalid disclosure authorization token.");
    }

    if (!req.disclosureTokenExpiresAt || new Date(req.disclosureTokenExpiresAt).getTime() < Date.now()) {
      throw new Error("Disclosure token has expired.");
    }

    // Re-read INSIDE the claim. The copy above was fetched before the lock, so a
    // redemption that completed in between would leave us working from a stale
    // record that still carries the package.
    const current = await getAuthorityRequest(requestId);
    if (!current || current.status !== "approved" || !current.disclosurePackage) {
      throw new Error("No target record matched the disclosure criteria.");
    }

    const released = current.disclosurePackage;

    // SINGLE USE, AND THE PAYLOAD GOES WITH IT.
    //
    // Burning only the token left the dossier on the record, where GET still
    // served it — so the data outlived the authorization that released it, for
    // every request ever disclosed. The audit chain is what must survive a
    // disclosure; the payload is not.
    current.disclosureTokenHash = undefined;
    current.disclosurePackage = undefined;
    current.status = "disclosed";
    current.updatedAt = new Date().toISOString();

    appendAuditBlock(
      current.auditChain,
      current.id,
      "DISCLOSURE_ACCESSED",
      "token_holder",
      "authority_client",
      { packageId: released.packageId }
    );

    await saveAuthorityRequest(current);
    await noteSensitiveAccess({
      kind: "authority_disclosure_redeemed",
      actorId: "token_holder",
      resourceRef: current.id,
    });
    // Deliberately NOT released on success: the record is now `disclosed`, so a
    // late arrival fails the status check anyway, and letting the claim expire
    // on its own costs nothing.
    return released;
  } catch (e) {
    await kvDel(`${reqKey(requestId)}:redeeming`);
    throw e;
  }
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

  // A refused request must not keep a readable dossier. Otherwise the rejection
  // is advisory: the bundle Alice staged survives Bob's refusal, and the next
  // person to open the record sees exactly what Bob declined to release. Any
  // pending token dies with it.
  const hadPackage = Boolean(req.disclosurePackage);
  req.disclosurePackage = undefined;
  req.disclosureTokenHash = undefined;
  req.disclosureTokenExpiresAt = undefined;

  appendAuditBlock(req.auditChain, req.id, "REQUEST_REJECTED", reviewer.id, reviewer.role, {
    reason,
    stagedPackageDestroyed: hadPackage,
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
