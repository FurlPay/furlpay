import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";
import { kvGet, kvSet } from "@/lib/kv";
import { recordRampAudit } from "./rampAudit";

// ---------------------------------------------------------------------------
// Beneficiary verification — the off-ramp security control that prevents
// beneficiary substitution, the #1 off-ramp fraud vector.
//
// An attacker who takes over an account adds their own bank account and
// initiates a withdrawal. The defence is a verification pipeline:
//
//   1. Accept bank details (account number, IFSC/IBAN/routing, holder name)
//   2. Penny-drop verification (send $0.01/₹1 to verify the account exists)
//   3. Name match (compare penny-drop response name to KYC name)
//   4. Cooling period (24h delay before first payout to a new beneficiary)
//   5. Push notification to original device (alerting the real user)
//
// The beneficiary record is immutable after creation — updating bank details
// requires creating a new beneficiary and going through the full pipeline
// again. This is deliberate: an edit-in-place model lets an attacker quietly
// swap the account number on an existing "verified" record.
//
// PENNY-DROP IS ASYNC. The response to the user's add-beneficiary request
// is "verification in progress", not "verified". The status is polled or
// pushed via webhook from the banking partner. Until status === "verified",
// the beneficiary cannot receive payouts.
// ---------------------------------------------------------------------------

export type BeneficiaryStatus =
  | "pending_verification" // Penny-drop initiated
  | "verified"             // Name matched, ready for payouts
  | "name_mismatch"        // Penny-drop name ≠ KYC name → manual review
  | "failed"               // Penny-drop failed (account does not exist)
  | "cooling"              // Verified but in 24h cooling period
  | "active"               // Cooling period expired, ready for payouts
  | "suspended";           // Manually suspended by ops

export interface Beneficiary {
  readonly id: string;
  readonly userId: string;
  readonly accountHolderName: string;
  /** Stored with field-level encryption — see decrypt() */
  readonly accountNumberEncrypted: string;
  /** Last 4 characters of account number — safe to display */
  readonly accountNumberLast4: string;
  readonly bankCode: string | null;   // IFSC / SWIFT / ABA
  readonly bankName: string | null;
  readonly country: string;           // ISO 3166-1 alpha-2
  readonly currency: string;
  readonly status: BeneficiaryStatus;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  readonly coolingExpiresAt: string | null;
  readonly lastPayoutAt: string | null;
}

const COOLING_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
const REVERIFY_AFTER_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const SEVEN_YEARS = 7 * 365 * 24 * 3600;

// ---------------------------------------------------------------------------
// Field encryption. AES-256-GCM with a 32-byte key from
// FURLPAY_BENEFICIARY_ENCRYPTION_KEY (base64). An earlier draft "encrypted"
// with base64 — an encoding, readable by anyone holding the KV dump — and kept
// it for seven years. With no key there is no storage: encryptField throws, so
// a missing key fails the request instead of writing plaintext.
//
// Format: "v1:" + base64(iv[12] || tag[16] || ciphertext). The beneficiary id
// is bound as AAD, so a ciphertext copied onto another record fails to decrypt.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The verification partner. NONE EXISTS. A penny-drop needs a bank or an
// account-validation API under contract; until one is wired here, this returns
// null and /api/offramp/beneficiary refuses to collect account numbers at all —
// a record that can never leave pending_verification is just stored PII.
// ---------------------------------------------------------------------------

export interface BeneficiaryVerifier {
  readonly id: string;
  /** Start a penny-drop / name lookup. The result arrives via verifyBeneficiary(). */
  initiate(input: { beneficiaryId: string; accountNumber: string; bankCode: string | null; country: string }): Promise<void>;
}

export function beneficiaryVerifier(): BeneficiaryVerifier | null {
  return null;
}

/**
 * Name match: the bank-returned holder name against the KYC name.
 *
 * Token-based, not substring. The earlier `includes()` check passed when the
 * KYC name was empty (every string includes "") and let "Al" match "Alice
 * Smith". Every token of the shorter name must appear in the longer one and
 * the shorter name needs at least two tokens, so "Priya Sharma" matches
 * "Priya K Sharma" but a bare "Sharma" goes to manual review.
 */
export function namesMatch(bankName: string, kycName: string): boolean {
  const tokens = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents so "José" stays one token
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

/**
 * Create a new beneficiary. Triggers penny-drop verification.
 *
 * Returns a pending beneficiary that cannot receive payouts until
 * the verification pipeline completes.
 */
export async function createBeneficiary(input: {
  userId: string;
  accountHolderName: string;
  accountNumber: string;
  bankCode?: string;
  bankName?: string;
  country: string;
  currency: string;
  ip?: string;
}): Promise<Beneficiary> {
  const verifier = beneficiaryVerifier();
  if (!verifier) throw new Error("No beneficiary verification partner is configured.");

  const id = `ben_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const last4 = input.accountNumber.slice(-4);

  const beneficiary: Beneficiary = {
    id,
    userId: input.userId,
    accountHolderName: input.accountHolderName,
    accountNumberEncrypted: encryptField(input.accountNumber, id),
    accountNumberLast4: last4,
    bankCode: input.bankCode ?? null,
    bankName: input.bankName ?? null,
    country: input.country,
    currency: input.currency,
    status: "pending_verification",
    createdAt: new Date().toISOString(),
    verifiedAt: null,
    coolingExpiresAt: null,
    lastPayoutAt: null,
  };

  // Store beneficiary record.
  await kvSet(`beneficiary:${id}`, beneficiary, SEVEN_YEARS);
  // Index by user for lookup.
  const userBens = (await kvGet<string[]>(`beneficiary:user:${input.userId}`)) ?? [];
  userBens.push(id);
  await kvSet(`beneficiary:user:${input.userId}`, userBens, SEVEN_YEARS);

  // Audit trail.
  await recordRampAudit({
    userId: input.userId,
    action: "beneficiary.added",
    direction: "offramp",
    ip: input.ip,
    metadata: {
      beneficiaryId: id,
      accountLast4: last4,
      bankCode: input.bankCode,
      country: input.country,
      currency: input.currency,
    },
  });

  // The partner's callback calls verifyBeneficiary() to move the status on.
  await verifier.initiate({
    beneficiaryId: id,
    accountNumber: input.accountNumber,
    bankCode: beneficiary.bankCode,
    country: beneficiary.country,
  });

  return beneficiary;
}

/**
 * Called when penny-drop verification completes (via banking partner webhook).
 * Compares the name returned by the bank with the KYC name.
 */
export async function verifyBeneficiary(input: {
  beneficiaryId: string;
  pennyDropSuccess: boolean;
  bankReturnedName?: string;
  kycName: string;
}): Promise<Beneficiary | null> {
  const ben = await kvGet<Beneficiary>(`beneficiary:${input.beneficiaryId}`);
  if (!ben) return null;

  let newStatus: BeneficiaryStatus;

  if (!input.pennyDropSuccess) {
    newStatus = "failed";
  } else if (input.bankReturnedName && namesMatch(input.bankReturnedName, input.kycName)) {
    newStatus = "cooling";
  } else {
    // A mismatch, or a rail that returned no name. Neither is evidence the
    // account belongs to this user, so both go to manual review — an earlier
    // draft treated "no name returned" as verified.
    newStatus = "name_mismatch";
  }

  const updated: Beneficiary = {
    ...ben,
    status: newStatus,
    verifiedAt: newStatus === "cooling" ? new Date().toISOString() : null,
    coolingExpiresAt: newStatus === "cooling"
      ? new Date(Date.now() + COOLING_PERIOD_MS).toISOString()
      : null,
  };

  await kvSet(`beneficiary:${input.beneficiaryId}`, updated, SEVEN_YEARS);

  await recordRampAudit({
    userId: ben.userId,
    action: "beneficiary.verified",
    direction: "offramp",
    metadata: {
      beneficiaryId: input.beneficiaryId,
      status: newStatus,
      nameMatch: newStatus !== "name_mismatch",
    },
  });

  return updated;
}

/**
 * Check if a beneficiary is eligible to receive a payout RIGHT NOW.
 *
 * Returns { eligible: true } or { eligible: false, reason }.
 */
export async function checkBeneficiaryEligibility(
  beneficiaryId: string,
  userId: string
): Promise<{ eligible: true } | { eligible: false; reason: string }> {
  const ben = await kvGet<Beneficiary>(`beneficiary:${beneficiaryId}`);
  // Ownership is part of eligibility: an id is not a capability, and paying
  // out to another user's verified account is the substitution this file
  // exists to prevent. Same answer as "not found" so ids cannot be probed.
  if (!ben || ben.userId !== userId) {
    return { eligible: false, reason: "Beneficiary not found." };
  }

  switch (ben.status) {
    case "pending_verification":
      return { eligible: false, reason: "Bank account verification is still in progress." };
    case "failed":
      return { eligible: false, reason: "Bank account verification failed. Please add a different account." };
    case "name_mismatch":
      return { eligible: false, reason: "Account holder name does not match your verified identity. Contact support." };
    case "suspended":
      return { eligible: false, reason: "This bank account has been suspended. Contact support." };
    case "cooling": {
      if (ben.coolingExpiresAt && new Date(ben.coolingExpiresAt) > new Date()) {
        const hours = Math.ceil(
          (new Date(ben.coolingExpiresAt).getTime() - Date.now()) / (3600 * 1000)
        );
        return {
          eligible: false,
          reason: `New bank account has a 24-hour security hold. Available in ~${hours} hour(s).`,
        };
      }
      // Cooling period expired — promote to active.
      const active: Beneficiary = { ...ben, status: "active" };
      await kvSet(`beneficiary:${beneficiaryId}`, active, SEVEN_YEARS);
      return { eligible: true };
    }
    case "verified":
    case "active": {
      // Re-verification after 90 days of inactivity.
      if (ben.lastPayoutAt) {
        const lastPayout = new Date(ben.lastPayoutAt).getTime();
        if (Date.now() - lastPayout > REVERIFY_AFTER_MS) {
          return {
            eligible: false,
            reason: "This bank account has not been used in 90 days and requires re-verification.",
          };
        }
      }
      return { eligible: true };
    }
    default:
      return { eligible: false, reason: "Unknown beneficiary status." };
  }
}

/**
 * Get all beneficiaries for a user. Returns display-safe data only
 * (last 4 of account number, never the full number — AGENTS.md Rule 5).
 */
export async function getUserBeneficiaries(
  userId: string
): Promise<Omit<Beneficiary, "accountNumberEncrypted">[]> {
  const ids = (await kvGet<string[]>(`beneficiary:user:${userId}`)) ?? [];
  const results: Omit<Beneficiary, "accountNumberEncrypted">[] = [];

  for (const id of ids) {
    const ben = await kvGet<Beneficiary>(`beneficiary:${id}`);
    if (ben && ben.userId === userId) {
      // Strip encrypted account number — never return it.
      const { accountNumberEncrypted: _, ...safe } = ben;
      results.push(safe);
    }
  }
  return results;
}
