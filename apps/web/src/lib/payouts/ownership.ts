import { randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { kvGet, kvSet, kvDel } from "../kv";
import { audit } from "../audit";
import type { PayoutRail } from "./rails";

// ---------------------------------------------------------------------------
// Wallet ownership verification.
//
// WHY THIS EXISTS. Address validation proves an address is well-formed. It
// proves nothing about who controls it. Without an ownership proof, anyone who
// compromises a Discord account can point the next payout at their own wallet,
// and every downstream check — balance, limits, risk — passes, because nothing
// about the payment is anomalous except the destination.
//
// THE PROOF IS A SIGNATURE OVER A CHALLENGE WE ISSUED. Not a test transaction:
// asking someone to send funds to prove they can send funds costs them money,
// proves less (it proves they control SOME wallet, on that occasion), and
// trains people to send money to prompts.
//
// The message follows the CAIP-122 / SIWE shape — the chain-agnostic standard
// that covers both EVM and Solana, and the one x402's Sign-In-With-X extension
// builds on. It is written out here rather than pulled from a library because
// the exact bytes are the security boundary and belong in the same file as the
// verification.
//
// NEVER ASK FOR: a seed phrase, a private key, a recovery phrase, an xprv, or a
// wallet password. A signature request is the only thing this module produces.
// ---------------------------------------------------------------------------

export const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const NONCE_BYTES = 16;

export type OwnershipSupport = "supported" | "not_implemented";

/**
 * Which rails can currently prove ownership.
 *
 * Bitcoin is `not_implemented` and says so. Proving control of a Bitcoin
 * address means BIP-322, which is a substantially larger piece of work than
 * EIP-191 or an Ed25519 verify — it has to handle five script types and build
 * a virtual transaction. Declaring it unsupported keeps the gap visible; the
 * alternative is a system that silently skips verification for BTC and looks
 * identical to one that verified it.
 */
export function ownershipSupport(rail: PayoutRail): OwnershipSupport {
  return rail === "EVM" || rail === "SOLANA" ? "supported" : "not_implemented";
}

export interface Challenge {
  id: string;
  nonce: string;
  userId: string;
  rail: PayoutRail;
  network: string;
  /** The address this challenge is FOR. A challenge issued for one address
   *  must never verify another — see `verifyOwnership`. */
  address: string;
  statement: string;
  issuedAt: string;
  expiresAt: string;
  /** The exact string the wallet must sign. Stored so verification compares
   *  against what was issued, not against a re-derivation that could drift. */
  message: string;
}

const challengeKey = (id: string) => `payout:challenge:${id}`;

/** The verifying domain. Bound into the message so a signature obtained by a
 *  different site cannot be replayed here. */
function domain(): string {
  return (process.env.FURLPAY_VERIFY_DOMAIN ?? "furlpay.com").trim();
}

/**
 * Build the message the wallet signs.
 *
 * Every line is load-bearing:
 *   domain      stops a signature farmed by another site being replayed here
 *   address     stops a challenge for wallet A verifying wallet B
 *   purpose     stops a login signature being reused as a payout authorisation
 *   network     stops a proof for one chain authorising another
 *   nonce       stops the same signature being submitted twice
 *   expiry      bounds how long a captured signature stays useful
 */
export function buildMessage(input: {
  address: string;
  rail: PayoutRail;
  network: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${domain()} wants you to prove you control this wallet:`,
    input.address,
    "",
    "Purpose: Verify a FurlPay payout destination.",
    "This signature authorises nothing and moves no funds.",
    "",
    `Rail: ${input.rail}`,
    `Network: ${input.network}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

export type IssueResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; reason: "rail_not_supported"; detail: string };

export async function issueChallenge(input: {
  userId: string;
  rail: PayoutRail;
  network: string;
  address: string;
}): Promise<IssueResult> {
  if (ownershipSupport(input.rail) !== "supported") {
    return {
      ok: false,
      reason: "rail_not_supported",
      detail: `FurlPay cannot yet verify ownership of a ${input.rail} address.`,
    };
  }

  const now = Date.now();
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const id = randomBytes(16).toString("hex");

  const challenge: Challenge = {
    id,
    nonce,
    userId: input.userId,
    rail: input.rail,
    network: input.network,
    address: input.address,
    statement: "Verify a FurlPay payout destination.",
    issuedAt,
    expiresAt,
    message: buildMessage({ ...input, nonce, issuedAt, expiresAt }),
  };

  // TTL on the record itself, so an unused challenge disappears rather than
  // accumulating as a forever-valid nonce.
  await kvSet(challengeKey(id), challenge, CHALLENGE_TTL_SECONDS);
  audit("payout.challenge_issued", input.userId, {
    challengeId: id,
    rail: input.rail,
    network: input.network,
  });
  return { ok: true, challenge };
}

export type VerifyResult =
  | { ok: true; address: string; proof: string }
  | { ok: false; reason: VerifyRejection; detail: string };

export type VerifyRejection =
  | "unknown_challenge"
  | "expired"
  | "wrong_user"
  | "address_mismatch"
  | "bad_signature"
  | "malformed_signature"
  | "rail_not_supported";

/**
 * Verify a signature against a previously issued challenge.
 *
 * The challenge is CONSUMED on success. A nonce that survives its use is not a
 * nonce, and a captured signature would otherwise be replayable for the rest
 * of the TTL.
 *
 * It is deliberately NOT consumed on failure: a user whose wallet returns a
 * malformed signature on the first attempt should be able to retry within the
 * window rather than restart the flow — and since the attacker case requires a
 * valid signature they do not have, leaving it open costs nothing.
 */
export async function verifyOwnership(input: {
  challengeId: string;
  userId: string;
  address: string;
  signature: string;
}): Promise<VerifyResult> {
  const challenge = await kvGet<Challenge>(challengeKey(input.challengeId));
  if (!challenge) {
    return { ok: false, reason: "unknown_challenge", detail: "That verification has expired. Start again." };
  }
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    await kvDel(challengeKey(input.challengeId));
    return { ok: false, reason: "expired", detail: "That verification has expired. Start again." };
  }
  // A challenge belongs to the account that requested it. Without this, an
  // attacker could have a victim sign a challenge and then submit it under
  // their own account.
  if (challenge.userId !== input.userId) {
    return { ok: false, reason: "wrong_user", detail: "That verification was not issued to you." };
  }
  if (!sameAddress(challenge.rail, challenge.address, input.address)) {
    return {
      ok: false,
      reason: "address_mismatch",
      detail: "This signature was requested for a different address.",
    };
  }

  let valid: boolean;
  try {
    valid =
      challenge.rail === "EVM"
        ? await verifyEvm(challenge.message, input.signature, challenge.address)
        : verifySolana(challenge.message, input.signature, challenge.address);
  } catch {
    return {
      ok: false,
      reason: "malformed_signature",
      detail: "That signature could not be read. Sign the message with the wallet you are adding.",
    };
  }

  if (!valid) {
    audit("payout.ownership_failed", input.userId, {
      challengeId: challenge.id,
      rail: challenge.rail,
    });
    return {
      ok: false,
      reason: "bad_signature",
      detail: "That signature does not match this wallet.",
    };
  }

  // Single use. Consumed only now, after the signature has actually verified.
  await kvDel(challengeKey(input.challengeId));
  audit("payout.ownership_verified", input.userId, {
    challengeId: challenge.id,
    rail: challenge.rail,
    network: challenge.network,
  });
  return { ok: true, address: challenge.address, proof: input.signature };
}

/** EVM addresses are case-insensitive; Solana base58 is not. Comparing the
 *  wrong way either rejects a valid EVM proof or accepts a different Solana
 *  key. Constant-time because this compares an attacker-supplied value. */
function sameAddress(rail: PayoutRail, a: string, b: string): boolean {
  const x = rail === "EVM" ? a.toLowerCase() : a;
  const y = rail === "EVM" ? b.toLowerCase() : b;
  const bx = Buffer.from(x, "utf8");
  const by = Buffer.from(y, "utf8");
  if (bx.length !== by.length) return false;
  return timingSafeEqual(bx, by);
}

/**
 * EIP-191 `personal_sign`. viem applies the "\x19Ethereum Signed Message:\n"
 * prefix, which is what makes a signed message structurally unable to be a
 * signed transaction — a plain `eth_sign` over arbitrary bytes could be.
 */
async function verifyEvm(message: string, signature: string, address: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error("not hex");
  return verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
}

/** Solana signs raw bytes with Ed25519; there is no wrapper to defer to, so
 *  the primitive is used directly — which is what tweetnacl is for. */
function verifySolana(message: string, signature: string, address: string): boolean {
  const sig = bs58.decode(signature);
  if (sig.length !== 64) throw new Error("bad signature length");
  const key = new PublicKey(address);
  return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key.toBytes());
}
