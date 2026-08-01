import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@/lib/evm/rlp";
import {
  serializeSigned,
  signingHash,
  transactionHash,
  type Eip1559Transaction,
} from "@/lib/evm/transaction";
import type { AccountSigner, SignedTransaction, SignerCapabilities } from "./types";
import { SignerUnavailable } from "./types";

// ---------------------------------------------------------------------------
// MPC signer — a key split so no single party holds it.
//
// WHY THIS EXISTS. The on-device key lives behind a biometric, which means it
// cannot sign unless the phone is present and unlocked. That is correct for a
// user's own funds and useless for an agent: an assistant booking a table at
// 3am has a valid identity, passes every spend policy, and then has nothing
// that can produce a signature.
//
// An MPC key solves exactly that. One share sits with a remote signer that can
// participate while the phone is asleep; the user's approval releases it; and
// neither party alone can move funds.
//
// WHAT THIS FILE IS NOT. It is not a Turnkey/Privy/Lit integration. Those are
// `MpcBackend` implementations — a few dozen lines each, written against
// whichever provider is chosen, by someone holding that provider's credentials.
// Everything security-relevant is here and is provider-independent:
//
//   1. WE ASSEMBLE THE TRANSACTION. The backend receives a digest and returns
//      (r, s, yParity). It never returns a serialized transaction, so it cannot
//      substitute one — we sign what we built or nothing.
//   2. WE VERIFY RECOVERY. The returned signature must recover to the address
//      we expect. A backend signing with a different share, a different key, or
//      over different bytes fails here rather than on-chain.
//   3. WE GATE LOCALLY. Policy is enforced before a co-sign is even requested,
//      in addition to whatever the backend enforces. Two independent checks,
//      because a client that asks for an out-of-policy signature and relies on
//      the server to refuse has already leaked intent.
// ---------------------------------------------------------------------------

/** The (r, s, yParity) an MPC backend returns. No serialized transaction. */
export interface MpcSignature {
  r: bigint;
  s: bigint;
  /** 0 or 1 — EIP-1559 parity, never a legacy v of 27/28. */
  yParity: number;
}

export interface MpcSignRequest {
  /** 32-byte digest to sign. */
  digest: Uint8Array;
  /** The transaction it came from, so a backend can apply its own policy. */
  transaction: Eip1559Transaction;
}

/**
 * A remote signing share.
 *
 * Deliberately minimal — this is the whole surface a vendor adapter must
 * implement, and the whole surface an attacker inherits by compromising one.
 */
export interface MpcBackend {
  /** "Turnkey", "Privy", shown in the UI. */
  readonly label: string;
  /** The address this key controls, or null if the session is not usable. */
  getAddress(): Promise<string | null>;
  /**
   * Asks the remote share to co-sign a digest.
   *
   * Expected to reject when its own policy refuses, when the user declines an
   * approval, or when the session has expired.
   */
  requestSignature(request: MpcSignRequest): Promise<MpcSignature>;
}

/**
 * Client-side spend policy, enforced before a signature is requested.
 *
 * Intentionally duplicates what the backend enforces. Defence in depth: a
 * client that never asks for an out-of-policy signature cannot be tricked into
 * asking by a compromised UI, and the request never reaches the network.
 */
export interface MpcPolicy {
  /** Chains this key may sign for at all. */
  allowedChainIds?: number[];
  /** Hard ceiling on `value` for a single transaction, in wei. */
  perTxMaxWei?: bigint;
  /**
   * Contracts and addresses this key may transact with.
   *
   * Compared case-insensitively. Omit for no restriction — but for an agent
   * key, an allowlist is the single most effective control available: a
   * compromised agent that can only reach three known contracts is a much
   * smaller problem than one that can reach any address.
   */
  allowedTargets?: string[];
}

export class MpcPolicyDenied extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "MpcPolicyDenied";
    this.reason = reason;
  }
}

export class MpcSigner implements AccountSigner {
  readonly kind = "mpc" as const;
  readonly label: string;

  // No `connection`. An MPC key has no device to connect to — the share is
  // reached over HTTPS as part of signing. Declaring an empty connection would
  // make the UI render a "Connect" button for something already available.

  constructor(
    private readonly backend: MpcBackend,
    private readonly policy: MpcPolicy = {}
  ) {
    this.label = backend.label;
  }

  capabilities(): SignerCapabilities {
    return {
      // No screen of its own. The phone renders the confirmation, so the app
      // must present the full transaction — same posture as the device key.
      trustedDisplay: false,
      clearSigning: false,
      eip712: true,
      eip1559: true,
      // Signs a digest, but from a transaction WE serialized and can render —
      // unlike a card that is handed a bare hash with no context.
      prehashedOnly: false,
      presence: "remote-app",
      supportedChainIds: this.policy.allowedChainIds ?? "all",
    };
  }

  async getAddress(): Promise<string | null> {
    return this.backend.getAddress();
  }

  async signTransaction(tx: Eip1559Transaction): Promise<SignedTransaction> {
    const expected = await this.backend.getAddress();
    if (!expected) {
      throw new SignerUnavailable(this.kind, `${this.label} has no active signing session.`);
    }

    this.assertWithinPolicy(tx);

    // We build the digest. The backend never chooses what is signed.
    const digest = signingHash(tx);
    const signature = await this.backend.requestSignature({ digest, transaction: tx });

    if (signature.yParity !== 0 && signature.yParity !== 1) {
      throw new SignerUnavailable(
        this.kind,
        `${this.label} returned a malformed signature.`
      );
    }

    // The check that makes a compromised backend detectable: recover the
    // signer from OUR digest and OUR signature, and require it to be the
    // address we were told this key controls. A backend that signed with a
    // different key, or over different bytes, cannot pass this.
    const recovered = recoverAddress(digest, signature);
    if (!recovered || recovered.toLowerCase() !== expected.toLowerCase()) {
      throw new SignerUnavailable(
        this.kind,
        `${this.label} returned a signature from an unexpected key. Nothing was broadcast.`
      );
    }

    // We assemble. The backend cannot substitute a different transaction
    // because it never had the chance to return one.
    return {
      raw: serializeSigned(tx, signature),
      hash: transactionHash(tx, signature),
      from: expected,
    };
  }

  /** @throws MpcPolicyDenied — before any network call. */
  private assertWithinPolicy(tx: Eip1559Transaction): void {
    const { allowedChainIds, perTxMaxWei, allowedTargets } = this.policy;

    if (allowedChainIds && !allowedChainIds.includes(tx.chainId)) {
      throw new MpcPolicyDenied(
        "chain_not_allowed",
        `${this.label} isn't authorised to sign for chain ${tx.chainId}.`
      );
    }
    if (perTxMaxWei !== undefined && tx.value > perTxMaxWei) {
      throw new MpcPolicyDenied(
        "amount_over_limit",
        "That amount is above this key's per-transaction limit."
      );
    }
    if (allowedTargets && allowedTargets.length > 0) {
      const target = tx.to.toLowerCase();
      const permitted = allowedTargets.some((t) => t.toLowerCase() === target);
      if (!permitted) {
        throw new MpcPolicyDenied(
          "target_not_allowed",
          "This key isn't authorised to transact with that address."
        );
      }
    }
  }
}

/**
 * The address that produced `signature` over `digest`, or null.
 *
 * Exported because verifying a remote signer's output is useful beyond this
 * class — any co-signing arrangement wants it.
 */
export function recoverAddress(digest: Uint8Array, signature: MpcSignature): string | null {
  try {
    const sig = new secp256k1.Signature(signature.r, signature.s).addRecoveryBit(
      signature.yParity
    );
    const point = sig.recoverPublicKey(digest);
    // Uncompressed key is 0x04 ‖ X ‖ Y; the address is the last 20 bytes of
    // keccak(X‖Y).
    const uncompressed = point.toRawBytes(false);
    return bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
  } catch {
    // A signature that cannot recover is a signature we will not use.
    return null;
  }
}

/**
 * Parses a 65-byte 0x signature (r‖s‖v) into the parity form EIP-1559 wants.
 *
 * NEVER THROWS. The input is a remote signer's response, so malformed is a
 * routine case rather than an exceptional one — `hexToBytes` throws on
 * non-hex, and an exception escaping here would crash a signing flow instead
 * of failing it cleanly.
 */
export function parseCompactSignature(hex: string): MpcSignature | null {
  if (typeof hex !== "string" || !/^(0x)?[0-9a-fA-F]{130}$/.test(hex)) return null;

  const bytes = hexToBytes(hex);
  if (bytes.length !== 65) return null;

  const r = BigInt("0x" + bytesToHex(bytes.slice(0, 32)).slice(2));
  const s = BigInt("0x" + bytesToHex(bytes.slice(32, 64)).slice(2));
  const v = bytes[64];
  // Backends variously return 0/1 or 27/28. Both are common; neither is wrong.
  const yParity = v === 0 || v === 1 ? v : v === 27 || v === 28 ? v - 27 : -1;
  return yParity === -1 ? null : { r, s, yParity };
}
