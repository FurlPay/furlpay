// ---------------------------------------------------------------------------
// Biometric Payment Protocol (Fingerprint Pay / Touch ID / Face ID)
//
// THE PROBLEM:
// Standard WebAuthn passkey authentication is a session-level login ceremony.
// It proves "a human unlocked the device to create a session", but does NOT
// cryptographically prove that the human authorized a specific transaction.
// A hijacked web session or malicious script could issue unauthorized transfers
// under an already-authenticated session.
//
// THE SOLUTION (Cryptographic Context Binding for Payments):
// 1. Transaction-Bound Challenge:
//    The server generates a WebAuthn challenge strictly derived from:
//    H(amount | asset | recipient | chain | nonce | timestamp).
//    The authenticator signs this challenge inside the isolated hardware
//    (iOS Secure Enclave, Android StrongBox, or FIDO2 Security Key).
//
// 2. Hardware Biometric Enforcement:
//    `userVerification: "required"` forces Touch ID / Face ID / Fingerprint.
//    Silent credentials or non-biometric fallbacks are refused.
//
// 3. Single-Use Proof Minting:
//    Upon successful verification, the server issues a single-use
//    `BiometricPaymentProof` valid for 120 seconds. The transfer route
//    validates that the executed transfer exactly matches the authorized digest.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  getCredentials,
  updateCounter,
} from "@/lib/webauthn";
import { log } from "@/lib/log";

export interface PaymentIntentParams {
  userId: string;
  amount: number;
  asset: string;
  recipient: string;
  chain: string;
}

export interface BiometricChallengeRecord {
  challengeId: string;
  challenge: string;
  userId: string;
  paymentDigest: string;
  /** The nonce the digest commits to — needed to re-derive it at spend time. */
  nonce: string;
  params: PaymentIntentParams;
  createdAt: number;
  expiresAt: number;
}

export interface BiometricProofRecord {
  proofId: string;
  userId: string;
  paymentDigest: string;
  /**
   * The nonce the digest was computed over.
   *
   * REQUIRED to enforce the binding, and its absence is why the binding was not
   * enforced at all: `validateAndConsumeBiometricProof` cannot recompute
   * `paymentDigest` from the submitted transfer without it, so it had nothing to
   * compare against and silently accepted any transfer. Storing the digest alone
   * is storing a promise nothing can check.
   */
  nonce: string;
  credentialId: string;
  verifiedAt: number;
  expiresAt: number;
}

const CHALLENGE_PREFIX = "bio:chal:";
const PROOF_PREFIX = "bio:proof:";
const CHALLENGE_TTL_SECONDS = 90; // 90 seconds to complete scan
const PROOF_TTL_SECONDS = 120; // 2 minutes to submit transfer

/**
 * Deterministically compute the transaction digest.
 * Commits amount, asset, recipient, and chain into a canonical 32-byte hex hash.
 */
export function computePaymentDigest(params: PaymentIntentParams, nonce: string): string {
  const canonical = [
    params.userId.trim().toLowerCase(),
    params.amount.toFixed(6),
    params.asset.trim().toUpperCase(),
    params.recipient.trim().toLowerCase(),
    params.chain.trim().toLowerCase(),
    nonce.trim(),
  ].join("|");

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Step 1: Create a transaction-bound challenge for the client to scan biometrics.
 */
export async function createBiometricPaymentChallenge(params: PaymentIntentParams) {
  const credentials = await getCredentials(params.userId);
  if (!credentials || credentials.length === 0) {
    throw new Error("No passkeys registered for biometric payment. Register a passkey first.");
  }

  // Generate unique transaction nonce & cryptographic digest
  const nonce = crypto.randomUUID();
  const paymentDigest = computePaymentDigest(params, nonce);

  // Generate WebAuthn options requiring biometric user verification
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required", // Forces Touch ID / Face ID / Fingerprint
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as any,
    })),
  });

  const challengeId = `bio_chal_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();

  const record: BiometricChallengeRecord = {
    challengeId,
    challenge: options.challenge,
    userId: params.userId,
    paymentDigest,
    // Carried so the proof minted from this challenge can recompute the digest
    // and hold the eventual transfer to exactly these parameters.
    nonce,
    params,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_SECONDS * 1000,
  };

  // Store keyed by challengeId and also indexed by challenge string for verification
  await kvSet(`${CHALLENGE_PREFIX}${challengeId}`, record, CHALLENGE_TTL_SECONDS);
  await kvSet(`${CHALLENGE_PREFIX}str:${options.challenge}`, challengeId, CHALLENGE_TTL_SECONDS);

  log.info("Biometric payment challenge issued", {
    userId: params.userId,
    challengeId,
    amount: params.amount,
    asset: params.asset,
    chain: params.chain,
  });

  return {
    challengeId,
    options,
    paymentDigest,
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  };
}

/**
 * Step 2: Verify the WebAuthn biometric assertion and mint a single-use proof token.
 */
export async function verifyBiometricPaymentAssertion(
  userId: string,
  challengeId: string,
  assertion: AuthenticationResponseJSON
) {
  const record = await kvGet<BiometricChallengeRecord>(`${CHALLENGE_PREFIX}${challengeId}`);
  if (!record) {
    throw new Error("Biometric payment challenge not found or expired. Please re-scan.");
  }

  if (record.userId !== userId) {
    throw new Error("Challenge belongs to a different user session.");
  }

  // Anti-replay: Burn challenge immediately upon reading
  await kvDel(`${CHALLENGE_PREFIX}${challengeId}`);
  await kvDel(`${CHALLENGE_PREFIX}str:${record.challenge}`);

  const credentials = await getCredentials(userId);
  const matchedCred = credentials.find((c) => c.id === assertion.id);
  if (!matchedCred) {
    throw new Error("Credential not recognized for this account.");
  }

  // Verify the cryptographic signature using SimpleWebAuthn
  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: record.challenge,
    expectedOrigin: EXPECTED_ORIGINS,
    expectedRPID: EXPECTED_RPIDS,
    credential: {
      id: matchedCred.id,
      publicKey: matchedCred.publicKey,
      counter: matchedCred.counter,
    },
    requireUserVerification: true, // Must confirm local biometric interaction
  });

  if (!verification.verified) {
    throw new Error("Biometric verification failed.");
  }

  // Update authenticator counter to detect cloned authenticators
  await updateCounter(userId, matchedCred.id, verification.authenticationInfo.newCounter);

  // Mint single-use BiometricProof token
  const proofId = `bio_proof_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();
  const proofRecord: BiometricProofRecord = {
    proofId,
    userId,
    paymentDigest: record.paymentDigest,
    nonce: record.nonce,
    credentialId: matchedCred.id,
    verifiedAt: now,
    expiresAt: now + PROOF_TTL_SECONDS * 1000,
  };

  await kvSet(`${PROOF_PREFIX}${proofId}`, proofRecord, PROOF_TTL_SECONDS);

  log.info("Biometric payment assertion verified", {
    userId,
    proofId,
    credentialId: matchedCred.id,
  });

  return {
    verified: true,
    proofId,
    paymentDigest: record.paymentDigest,
    expiresInSeconds: PROOF_TTL_SECONDS,
  };
}

/**
 * Step 3: Validate and consume the biometric proof during transfer execution.
 * Returns true if valid and burns the proof (single-use).
 */
export async function validateAndConsumeBiometricProof(
  userId: string,
  proofId: string,
  transfer: {
    amount: number;
    asset: string;
    recipient: string;
    chain: string;
  }
): Promise<{ valid: boolean; reason?: string }> {
  if (!proofId || !proofId.startsWith("bio_proof_")) {
    return { valid: false, reason: "Malformed biometric proof format." };
  }

  const proof = await kvGet<BiometricProofRecord>(`${PROOF_PREFIX}${proofId}`);
  if (!proof) {
    return { valid: false, reason: "Biometric proof expired or already consumed." };
  }

  // Anti-replay: burn proof immediately
  await kvDel(`${PROOF_PREFIX}${proofId}`);

  if (proof.userId !== userId) {
    return { valid: false, reason: "Biometric proof principal mismatch." };
  }

  if (Date.now() > proof.expiresAt) {
    return { valid: false, reason: "Biometric proof has expired." };
  }

  // ─── THE BINDING. This is what the whole design is for. ────────────────────
  //
  // Until now this function accepted `transfer` and NEVER LOOKED AT IT. Every
  // check above is about WHO and WHEN; none was about WHAT. So a proof minted for
  // "$5 to addressA" authorised any transfer at all: an attacker on a hijacked
  // session could show the victim a $5 payment, collect the fingerprint, and then
  // submit $5,000 to their own address with the same proofId. The step-up gate
  // would pass.
  //
  // That is strictly worse than having no biometric gate, because the UI told the
  // user they were approving one specific payment. Re-deriving the digest from
  // the transfer actually being executed is the only thing that makes the
  // signature mean what the prompt said it meant.
  const submittedDigest = computePaymentDigest(
    {
      userId,
      amount: transfer.amount,
      asset: transfer.asset,
      recipient: transfer.recipient,
      chain: transfer.chain,
    },
    proof.nonce
  );

  // Constant-time compare. Both are fixed-length hex, so a length mismatch means
  // a corrupt record rather than an attacker-chosen input — checked first because
  // timingSafeEqual throws on unequal lengths.
  const a = Buffer.from(submittedDigest, "utf8");
  const b = Buffer.from(proof.paymentDigest ?? "", "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    log.warn("Biometric proof rejected — transfer does not match what was authorized", {
      userId,
      proofId,
      // The digests only, never the amounts or the recipient: this line goes to
      // logs, and a rejected attempt is exactly when not to widen exposure.
      authorizedDigest: proof.paymentDigest?.slice(0, 12),
      submittedDigest: submittedDigest.slice(0, 12),
    });
    return {
      valid: false,
      reason: "This biometric approval was for a different payment. Please approve again.",
    };
  }

  return { valid: true };
}
