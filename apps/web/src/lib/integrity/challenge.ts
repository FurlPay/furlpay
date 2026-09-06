import { randomBytes, timingSafeEqual } from "crypto";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Server-issued signing challenge.
//
// WHY, GIVEN THE AUTHORIZATION ALREADY EXISTS. The authorization proves the
// server agreed to a transaction. It does not prove the party now asking for a
// signature is the party that was standing in front of the phone when it was
// agreed. The challenge closes that: it is unpredictable, server-generated,
// single-use, and it is what the device's platform-integrity evidence and
// biometric operation are bound to.
//
// So the two objects answer different questions and neither replaces the other:
//
//     authorization  — "is this transaction allowed?"
//     challenge      — "is this the live, present, correct device asking now?"
//
// UNPREDICTABILITY IS THE WHOLE PROPERTY. A challenge a client can guess is a
// challenge an attacker can pre-compute evidence for. `randomBytes` (CSPRNG),
// never `Math.random`, and never a counter or a timestamp.
//
// BOUND TO EVERY PRINCIPAL. A challenge issued for one transaction, device, app
// instance, wallet or user must be useless anywhere else — otherwise it becomes
// a bearer token, and a bearer token that unlocks signing is a worse problem
// than the one this solves.
// ---------------------------------------------------------------------------

/** Short by design: a challenge bridges confirmation and signing. */
export const CHALLENGE_TTL_MS = 90_000;

/** Consumed markers outlive the challenge, so a late replay still reads as a
 *  replay rather than as an unknown id. */
const CONSUMED_TTL_SECONDS = 24 * 3600;

const CHALLENGE_KEY = (id: string) => `sign:challenge:${id}`;
const CONSUMED_KEY = (id: string) => `sign:challenge:consumed:${id}`;

export interface SigningChallenge {
  readonly challengeId: string;
  /** 32 random bytes, base64url. What the device signs / attests over. */
  readonly nonce: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly appInstanceId: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly canonicalDigest: string;
  /** Which policy produced it, so a decision is reproducible after a change. */
  readonly policyVersion: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IssueChallengeInput {
  readonly userId: string;
  readonly deviceId: string;
  readonly appInstanceId: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly canonicalDigest: string;
  readonly policyVersion?: string;
}

export async function issueChallenge(
  input: IssueChallengeInput,
  now: number = Date.now()
): Promise<SigningChallenge> {
  const challenge: SigningChallenge = {
    challengeId: "chal_" + randomBytes(16).toString("hex"),
    // 32 bytes from the CSPRNG. Predictability here would let an attacker
    // pre-compute attestation evidence for a challenge not yet issued.
    nonce: randomBytes(32).toString("base64url"),
    userId: input.userId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    walletId: input.walletId,
    transactionId: input.transactionId,
    transactionVersion: input.transactionVersion,
    canonicalDigest: input.canonicalDigest,
    policyVersion: input.policyVersion ?? "v1",
    issuedAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };

  await kvSet(
    CHALLENGE_KEY(challenge.challengeId),
    challenge,
    Math.ceil(CHALLENGE_TTL_MS / 1000)
  );
  audit("challenge.created", input.userId, {
    challengeId: challenge.challengeId,
    deviceId: input.deviceId,
    transactionId: input.transactionId,
    transactionVersion: input.transactionVersion,
  });
  return challenge;
}

export type ChallengeRefusal =
  | "challenge_not_found"
  | "challenge_expired"
  | "challenge_replayed"
  | "challenge_nonce_mismatch"
  | "challenge_user_mismatch"
  | "challenge_device_mismatch"
  | "challenge_app_instance_mismatch"
  | "challenge_wallet_mismatch"
  | "challenge_transaction_mismatch"
  | "challenge_version_mismatch"
  | "challenge_digest_mismatch";

export interface ConsumeChallengeResult {
  readonly ok: boolean;
  readonly refusals: readonly ChallengeRefusal[];
  readonly challenge?: SigningChallenge;
}

/** Constant-time nonce comparison. The nonce is the one secret-ish value here,
 *  and a length-leaking or short-circuiting compare is a free oracle. */
function nonceMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Claim a challenge for exactly one signing operation.
 *
 * Claim-before-validate, for the same reason as the authorization: the atomic
 * SET NX is what makes two concurrent replays impossible. Validating first and
 * marking after leaves a window in which both pass — and on serverless the two
 * requests are on different instances, where nothing process-local would see
 * the other.
 *
 * A failed validation still burns the challenge. That is the correct trade: a
 * challenge is cheap to re-issue and a signature is not recoverable.
 */
export async function consumeChallenge(
  input: {
    challengeId: string;
    nonce: string;
    userId: string;
    deviceId: string;
    appInstanceId: string;
    walletId: string;
    transactionId: string;
    transactionVersion: number;
    canonicalDigest: string;
  },
  now: number = Date.now()
): Promise<ConsumeChallengeResult> {
  const claimed = await kvSetNx(CONSUMED_KEY(input.challengeId), now, CONSUMED_TTL_SECONDS);
  if (!claimed) {
    audit("challenge.replay_detected", input.userId, {
      challengeId: input.challengeId,
      deviceId: input.deviceId,
    });
    return { ok: false, refusals: ["challenge_replayed"] };
  }

  const stored = await kvGet<SigningChallenge>(CHALLENGE_KEY(input.challengeId));
  if (!stored) return { ok: false, refusals: ["challenge_not_found"] };

  const refusals: ChallengeRefusal[] = [];

  if (!nonceMatches(stored.nonce, input.nonce)) refusals.push("challenge_nonce_mismatch");
  if (now > stored.expiresAt) refusals.push("challenge_expired");

  // Every principal is checked. A challenge that is valid for a different
  // device, wallet or transaction is a bearer token, and a bearer token that
  // unlocks signing is worse than the problem this solves.
  if (stored.userId !== input.userId) refusals.push("challenge_user_mismatch");
  if (stored.deviceId !== input.deviceId) refusals.push("challenge_device_mismatch");
  if (stored.appInstanceId !== input.appInstanceId) {
    refusals.push("challenge_app_instance_mismatch");
  }
  if (stored.walletId !== input.walletId) refusals.push("challenge_wallet_mismatch");
  if (stored.transactionId !== input.transactionId) {
    refusals.push("challenge_transaction_mismatch");
  }
  if (stored.transactionVersion !== input.transactionVersion) {
    refusals.push("challenge_version_mismatch");
  }
  if (stored.canonicalDigest !== input.canonicalDigest) {
    refusals.push("challenge_digest_mismatch");
  }

  if (refusals.length > 0) {
    audit("challenge.consumed", input.userId, {
      challengeId: input.challengeId,
      refused: refusals.join(","),
    });
    return { ok: false, refusals, challenge: stored };
  }

  audit("challenge.consumed", input.userId, {
    challengeId: stored.challengeId,
    deviceId: stored.deviceId,
    transactionId: stored.transactionId,
  });
  return { ok: true, refusals: [], challenge: stored };
}
