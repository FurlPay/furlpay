import { randomBytes } from "crypto";
import { recoverMessageAddress, isAddress, getAddress, type Hex } from "viem";
import { kvGet, kvSet, kvDel, kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Signature-proven wallet linking (Phase 1). The server mints a single-use
// challenge; the device signs a canonical EIP-191 message with its key; the
// server recovers the signer and requires it to equal the claimed address.
//
// The server NEVER trusts a client-supplied address without this proof, and
// never trusts client-side verification. Recovery happens here, server-side,
// with viem. Consumption is atomic (kvSetNx) so one challenge yields at most
// one successful link even under concurrent submits.
// ---------------------------------------------------------------------------

/** Phase gate. 0 = off (Phase 1 features unavailable, behavior unchanged). */
export function selfCustodyStage(): number {
  return Number(process.env.FURLPAY_SELF_CUSTODY_STAGE ?? "0") || 0;
}
export function linkingEnabled(): boolean {
  return selfCustodyStage() >= 1;
}

const CHALLENGE_TTL_S = 300; // 5 minutes
const challengeKey = (userId: string) => `wallet:link:challenge:${userId}`;
const consumedKey = (nonce: string) => `wallet:link:consumed:${nonce}`;

export interface LinkChallenge {
  userId: string;
  address: string; // claimed address, lowercased for binding
  nonce: string; // 0x + 64 hex
  purpose: "wallet-link";
  issuedAt: string; // ISO8601
  expiresAt: string; // ISO8601
  message: string; // the exact canonical string to sign
}

/**
 * The canonical human-readable message the user signs. Client and server MUST
 * produce byte-identical strings — this one builder is the single source of
 * that format. It binds the app identity, purpose, account, address, nonce and
 * validity window, so a signature for one (user, address, purpose) can never be
 * reused for another operation or account.
 */
export function buildLinkMessage(p: {
  userId: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    "FurlPay: link this wallet to your account",
    "",
    "Signing this does NOT move any funds or grant spend access.",
    "It only proves you control this address.",
    "",
    `app: furlpay.com`,
    `purpose: wallet-link`,
    `account: ${p.userId}`,
    `address: ${getAddress(p.address)}`,
    `chain: evm`,
    `nonce: ${p.nonce}`,
    `issued: ${p.issuedAt}`,
    `expires: ${p.expiresAt}`,
  ].join("\n");
}

/** Mint a single-use challenge bound to the authenticated user + claimed
 *  address. Overwrites any prior unconsumed challenge for the user (only the
 *  latest is valid). Returns the message to sign. */
export async function mintChallenge(userId: string, claimedAddress: string): Promise<LinkChallenge | { error: string; status: number }> {
  if (!isAddress(claimedAddress)) return { error: "invalid_address", status: 400 };
  const address = claimedAddress.toLowerCase();
  const nonce = "0x" + randomBytes(32).toString("hex");
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_TTL_S * 1000).toISOString();
  const message = buildLinkMessage({ userId, address, nonce, issuedAt, expiresAt });

  const challenge: LinkChallenge = { userId, address, nonce, purpose: "wallet-link", issuedAt, expiresAt, message };
  await kvSet(challengeKey(userId), challenge, CHALLENGE_TTL_S);
  return challenge;
}

export type VerifyResult =
  | { ok: true; address: string; nonce: string }
  | { ok: false; error: string; status: number };

/**
 * Verify a signature against the user's stored challenge and the claimed
 * address. Server-side recovery only. Atomic single-use: the nonce is claimed
 * with kvSetNx BEFORE the link is written, so a concurrent second request loses
 * the race and cannot produce a second success.
 */
export async function verifyLink(userId: string, claimedAddress: string, signature: string): Promise<VerifyResult> {
  if (!isAddress(claimedAddress)) return { ok: false, error: "invalid_address", status: 400 };
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, error: "invalid_signature_format", status: 400 };
  }

  const challenge = await kvGet<LinkChallenge>(challengeKey(userId));
  if (!challenge) return { ok: false, error: "no_challenge", status: 400 };
  if (challenge.purpose !== "wallet-link") return { ok: false, error: "wrong_purpose", status: 400 };
  if (challenge.userId !== userId) return { ok: false, error: "user_mismatch", status: 403 };
  if (challenge.address !== claimedAddress.toLowerCase()) return { ok: false, error: "address_mismatch", status: 400 };
  if (Date.parse(challenge.expiresAt) < Date.now()) {
    await kvDel(challengeKey(userId)).catch(() => {});
    return { ok: false, error: "challenge_expired", status: 400 };
  }

  // Atomic single-use claim on the nonce — before any state write. If another
  // request already claimed it, this one fails closed.
  const claimed = await kvSetNx(consumedKey(challenge.nonce), userId, CHALLENGE_TTL_S);
  if (!claimed) return { ok: false, error: "challenge_already_used", status: 409 };

  // Recover the signer from the EXACT stored message (not a client-supplied one).
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: challenge.message, signature: signature as Hex });
  } catch {
    return { ok: false, error: "signature_recovery_failed", status: 400 };
  }
  if (recovered.toLowerCase() !== challenge.address) {
    return { ok: false, error: "signer_mismatch", status: 400 };
  }

  // Success — invalidate the challenge record too (the nonce is already burned).
  await kvDel(challengeKey(userId)).catch(() => {});
  return { ok: true, address: getAddress(challenge.address), nonce: challenge.nonce };
}
