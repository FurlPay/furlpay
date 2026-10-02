import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";
import { kvGet, kvSet } from "@/lib/kv";
import { recordRampAudit } from "./rampAudit";
import { activeVerifier, type BeneficiaryStatus, type BeneficiaryVerifier } from "./beneficiaryVerification";

export type { BeneficiaryStatus } from "./beneficiaryVerification";

// ---------------------------------------------------------------------------
// Beneficiaries — the bank accounts a server-initiated off-ramp may pay.
//
// The fraud this exists to stop is beneficiary substitution: whoever takes
// over an account adds their own bank account and cashes out. So:
//
//   - a record is IMMUTABLE once created; new bank details are a new record
//     and a fresh verification, never an edit to a verified one;
//   - it is verified by micro-deposits AND a holder-name match against KYC
//     (lib/ramp/beneficiaryVerification.ts); a name mismatch suspends it;
//   - a newly verified account has a 24 h hold before its first payout;
//   - it is checked for OWNERSHIP at payout, not just for status.
//
//   pending ─▶ micro_deposit_sent ─▶ awaiting_confirmation ─▶ verified
//                    │                        │                   │
//                    ▼                        ▼                   ▼
//          micro_deposit_failed           suspended           suspended / removed
//
// No verification partner exists, so createBeneficiary refuses (the route
// returns 503 before reading any account number). The transition table and
// the payout gate are real now, so wiring a partner is the only missing step.
// ---------------------------------------------------------------------------

export interface Beneficiary {
  readonly id: string;
  readonly userId: string;
  readonly accountHolderName: string;
  /** AES-256-GCM, see encryptField. Never returned over the wire. */
  readonly accountNumberEncrypted: string;
  readonly accountNumberLast4: string;
  readonly bankCode: string | null;
  readonly bankName: string | null;
  readonly country: string;
  readonly currency: string;
  readonly status: BeneficiaryStatus;
  readonly verifierId: string | null;
  readonly verificationRef: string | null;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  /** Payouts are refused until this passes, even when verified. */
  readonly coolingExpiresAt: string | null;
  readonly lastPayoutAt: string | null;
  readonly statusReason: string | null;
}

const COOLING_PERIOD_MS = 24 * 60 * 60 * 1000;
const REVERIFY_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_YEARS = 7 * 365 * 24 * 3600;

const recordKey = (id: string) => `beneficiary:${id}`;
const userKey = (userId: string) => `beneficiary:user:${userId}`;

/** Legal moves. Anything else is refused. */
const TRANSITIONS: Record<BeneficiaryStatus, readonly BeneficiaryStatus[]> = {
  pending: ["micro_deposit_sent", "micro_deposit_failed", "removed"],
  micro_deposit_sent: ["awaiting_confirmation", "micro_deposit_failed", "removed"],
  awaiting_confirmation: ["verified", "suspended", "micro_deposit_failed", "removed"],
  verified: ["suspended", "removed"],
  micro_deposit_failed: ["removed"],
  suspended: ["verified", "removed"],
  removed: [],
};

export function canMoveBeneficiary(from: BeneficiaryStatus, to: BeneficiaryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ── Field encryption ───────────────────────────────────────────────────────
// AES-256-GCM, key FURLPAY_BENEFICIARY_ENCRYPTION_KEY (base64, 32 bytes). An
// earlier draft "encrypted" with base64. With no key nothing is stored.
// Format "v1:" + base64(iv[12] || tag[16] || ciphertext); the beneficiary id is
// the AAD, so a ciphertext copied onto another record does not decrypt.

export class BeneficiaryEncryptionUnavailable extends Error {
  constructor() {
    super("FURLPAY_BENEFICIARY_ENCRYPTION_KEY is not set to a base64 32-byte key.");
    this.name = "BeneficiaryEncryptionUnavailable";
  }
}

function encryptionKey(): Buffer {
  const raw = (process.env.FURLPAY_BENEFICIARY_ENCRYPTION_KEY ?? "").trim();
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new BeneficiaryEncryptionUnavailable();
  return key;
}

export function encryptField(value: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptField(stored: string, aad: string): string {
  if (!stored.startsWith("v1:")) throw new Error("unknown beneficiary ciphertext version");
  const buf = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** True when a verification partner is configured. False today. */
export function beneficiaryVerificationAvailable(): boolean {
  return activeVerifier() !== null;
}

/**
 * Holder-name match for a verifier that returns the bank's name rather than a
 * verdict. Token-based: every token of the shorter name must appear in the
 * longer, which needs at least two tokens, so "Priya Sharma" matches
 * "Priya K Sharma" but a bare "Sharma" goes to review. (An earlier substring
 * check matched an empty KYC name against anything.)
 */
export function namesMatch(bankName: string, kycName: string): boolean {
  const tokens = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents so "José" stays one token
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const a = tokens(bankName);
  const b = tokens(kycName);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2) return false;
  return shorter.every((t) => longer.includes(t));
}

async function save(b: Beneficiary): Promise<void> {
  await kvSet(recordKey(b.id), b, SEVEN_YEARS);
}

async function move(
  b: Beneficiary,
  to: BeneficiaryStatus,
  patch: Partial<Beneficiary> = {},
  reason: string | null = null
): Promise<Beneficiary> {
  if (!canMoveBeneficiary(b.status, to)) {
    throw new Error(`Beneficiary ${b.id}: ${b.status} -> ${to} is not permitted.`);
  }
  const next: Beneficiary = { ...b, ...patch, status: to, statusReason: reason };
  await save(next);
  await recordRampAudit({
    userId: b.userId,
    action: to === "verified" ? "beneficiary.verified" : "beneficiary.changed",
    direction: "offramp",
    metadata: { beneficiaryId: b.id, from: b.status, to, reason },
  }).catch(() => {});
  return next;
}

/**
 * Add a bank account and start micro-deposit verification. Refuses with no
 * verifier (VerifierNotConfigured upstream) and with no encryption key.
 */
export async function createBeneficiary(
  input: {
    userId: string;
    accountHolderName: string;
    accountNumber: string;
    bankCode?: string;
    bankName?: string;
    country: string;
    currency: string;
    ip?: string;
  },
  verifier: BeneficiaryVerifier | null = activeVerifier()
): Promise<Beneficiary> {
  if (!verifier) throw new Error("No bank-account verification partner is configured.");

  const id = `ben_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const created: Beneficiary = {
    id,
    userId: input.userId,
    accountHolderName: input.accountHolderName,
    accountNumberEncrypted: encryptField(input.accountNumber, id),
    accountNumberLast4: input.accountNumber.slice(-4),
    bankCode: input.bankCode ?? null,
    bankName: input.bankName ?? null,
    country: input.country,
    currency: input.currency,
    status: "pending",
    verifierId: verifier.id,
    verificationRef: null,
    createdAt: new Date().toISOString(),
    verifiedAt: null,
    coolingExpiresAt: null,
    lastPayoutAt: null,
    statusReason: null,
  };
  await save(created);
  const ids = (await kvGet<string[]>(userKey(input.userId))) ?? [];
  await kvSet(userKey(input.userId), [...ids, id], SEVEN_YEARS);
  await recordRampAudit({
    userId: input.userId,
    action: "beneficiary.added",
    direction: "offramp",
    ip: input.ip,
    metadata: { beneficiaryId: id, accountLast4: created.accountNumberLast4, country: input.country, currency: input.currency },
  }).catch(() => {});

  try {
    const { refId } = await verifier.initiateMicroDeposit({
      beneficiaryId: id,
      accountHolderName: input.accountHolderName,
      accountNumber: input.accountNumber,
      bankCode: created.bankCode,
      country: input.country,
      currency: input.currency,
    });
    return move(created, "micro_deposit_sent", { verificationRef: refId });
  } catch (e) {
    return move(created, "micro_deposit_failed", {}, (e as Error).message.slice(0, 200));
  }
}

/** The partner reports the deposits landed; the user can now confirm amounts. */
export async function markDepositsLanded(beneficiaryId: string): Promise<Beneficiary> {
  const b = await kvGet<Beneficiary>(recordKey(beneficiaryId));
  if (!b) throw new Error(`No beneficiary ${beneficiaryId}.`);
  return move(b, "awaiting_confirmation");
}

/**
 * The user confirms the two amounts they saw. Verified only when the amounts
 * match AND the partner reports a holder-name match; a name mismatch suspends
 * the account for a person to review rather than failing silently.
 */
export async function confirmMicroDeposits(
  beneficiaryId: string,
  userId: string,
  amounts: [number, number],
  verifier: BeneficiaryVerifier | null = activeVerifier()
): Promise<Beneficiary> {
  if (!verifier) throw new Error("No bank-account verification partner is configured.");
  const b = await kvGet<Beneficiary>(recordKey(beneficiaryId));
  if (!b || b.userId !== userId) throw new Error("Beneficiary not found.");
  if (!b.verificationRef) throw new Error("Verification was never started.");

  const r = await verifier.confirmMicroDeposit(b.verificationRef, amounts);
  if (!r.verified) return move(b, "micro_deposit_failed", {}, r.reason ?? "Amounts did not match.");
  if (r.nameMatch !== true) {
    return move(b, "suspended", {}, "Account holder name does not match your verified identity.");
  }
  const now = Date.now();
  return move(b, "verified", {
    verifiedAt: new Date(now).toISOString(),
    coolingExpiresAt: new Date(now + COOLING_PERIOD_MS).toISOString(),
  });
}

/** Soft delete. A removed account is never payable and never reinstated. */
export async function removeBeneficiary(beneficiaryId: string, userId: string): Promise<Beneficiary> {
  const b = await kvGet<Beneficiary>(recordKey(beneficiaryId));
  if (!b || b.userId !== userId) throw new Error("Beneficiary not found.");
  return move(b, "removed");
}

export type BeneficiaryEligibility =
  | { eligible: true }
  | { eligible: false; reason: string; action?: { type: "verify_beneficiary"; beneficiaryId: string } };

/**
 * May FurlPay pay this account for this user RIGHT NOW?
 * Ownership is part of the answer: another user's id is "not found", the same
 * as a missing one, so ids cannot be probed.
 */
export async function checkBeneficiaryEligibility(beneficiaryId: string, userId: string): Promise<BeneficiaryEligibility> {
  const b = await kvGet<Beneficiary>(recordKey(beneficiaryId));
  if (!b || b.userId !== userId || b.status === "removed") {
    return { eligible: false, reason: "Beneficiary not found." };
  }
  if (b.status !== "verified") {
    const reason =
      b.status === "suspended"
        ? "This bank account is under review. Contact support."
        : b.status === "micro_deposit_failed"
          ? "Bank account verification failed. Add a different account."
          : "Bank account must be verified before receiving payouts.";
    return { eligible: false, reason, action: { type: "verify_beneficiary", beneficiaryId } };
  }
  if (b.coolingExpiresAt && Date.parse(b.coolingExpiresAt) > Date.now()) {
    const hours = Math.ceil((Date.parse(b.coolingExpiresAt) - Date.now()) / 3_600_000);
    return { eligible: false, reason: `New bank account has a 24-hour security hold. Available in about ${hours} hour(s).` };
  }
  if (b.lastPayoutAt && Date.now() - Date.parse(b.lastPayoutAt) > REVERIFY_AFTER_MS) {
    return {
      eligible: false,
      reason: "This bank account has not been used in 90 days and must be verified again.",
      action: { type: "verify_beneficiary", beneficiaryId },
    };
  }
  return { eligible: true };
}

/** The user's accounts, display-safe (never the account number, sealed or not). */
export async function getUserBeneficiaries(userId: string): Promise<Omit<Beneficiary, "accountNumberEncrypted" | "verificationRef">[]> {
  const ids = (await kvGet<string[]>(userKey(userId))) ?? [];
  const out: Omit<Beneficiary, "accountNumberEncrypted" | "verificationRef">[] = [];
  for (const id of ids) {
    const b = await kvGet<Beneficiary>(recordKey(id));
    if (b && b.userId === userId && b.status !== "removed") {
      const { accountNumberEncrypted: _a, verificationRef: _r, ...safe } = b;
      out.push(safe);
    }
  }
  return out;
}
