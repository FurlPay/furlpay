import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  type Hex,
  type LocalAccount,
} from "viem";
import { toAccount } from "viem/accounts";
import { resolveKms, type KeyPurpose, type KmsRefusal } from "@/lib/kms";

// ---------------------------------------------------------------------------
// A viem account whose private key is not in this process.
//
// WHY THIS FILE EXISTS. lib/kms.ts established that application code asks for a
// SIGNATURE and never for a KEY, and then nothing used it: the one path that
// actually signs in production (x402Settler) called
// `privateKeyToAccount(process.env.FACILITATOR_EVM_PRIVATE_KEY)` and went
// straight past the boundary. The flag that was supposed to prevent that,
// ONCHAIN_SETTLEMENT_LIVE, requires FURLPAY_KMS_PROVIDER — and the settler
// never consulted the flag. Two correct controls, neither one wired to the
// thing it guarded.
//
// This adapter closes that: it presents the shape viem wants (an account with
// signMessage / signTransaction / signTypedData) while every signature is
// produced by the KMS provider. There is no branch in here that can reach key
// material, because there is none to reach.
//
// WHAT WE SIGN, AND WHY IT IS SAFE TO SIGN A BARE DIGEST. Each method builds
// its OWN digest from the payload it was handed — keccak256 of the serialized
// transaction, hashMessage for EIP-191, hashTypedData for EIP-712 — and sends
// that. The backend is never asked to interpret a payload, and never returns a
// serialized transaction, so it cannot substitute one: we serialize what we
// built, or nothing is broadcast.
// ---------------------------------------------------------------------------

export class KmsSigningError extends Error {
  readonly refusal: KmsRefusal;
  constructor(refusal: KmsRefusal) {
    super(`KMS refused to sign (${refusal.reason}): ${refusal.detail}`);
    this.name = "KmsSigningError";
    this.refusal = refusal;
  }
}

/** Split a 65-byte (r ‖ s ‖ v) hex signature into viem's component form. */
function splitSignature(signatureHex: string): { r: Hex; s: Hex; v: bigint; yParity: number } {
  const raw = signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex;
  if (raw.length !== 130) {
    throw new Error(`KMS returned a ${raw.length / 2}-byte signature; expected 65.`);
  }
  const r = `0x${raw.slice(0, 64)}` as Hex;
  const s = `0x${raw.slice(64, 128)}` as Hex;
  // Backends differ: some return 0/1 (parity), some 27/28 (legacy v). Normalise
  // to both forms rather than guessing which one a consumer wants — an off-by-27
  // here recovers a different address and is only discovered on-chain.
  const last = Number.parseInt(raw.slice(128, 130), 16);
  const yParity = last >= 27 ? last - 27 : last;
  if (yParity !== 0 && yParity !== 1) {
    throw new Error(`KMS returned an unusable recovery byte: 0x${raw.slice(128, 130)}`);
  }
  return { r, s, v: BigInt(yParity + 27), yParity };
}

export interface KmsAccountOptions {
  /** Logical key name, e.g. "furlpay-gas-sponsor". Never key material. */
  keyId: string;
  /** What this account is permitted to do. Enforced inside the provider. */
  purpose: KeyPurpose;
  /** The address this key controls. Public, so it is configuration, not a secret. */
  address: Hex;
}

/**
 * Build a viem `LocalAccount` backed by the configured KMS.
 *
 * Returns null when no KMS is configured, so a caller can fail closed rather
 * than fall back to a local key. The refusal reason is deliberately NOT thrown
 * here: "there is no signer" is a normal state for a deployment that has not
 * enabled settlement, and callers report it themselves.
 */
export function createKmsAccount(options: KmsAccountOptions): LocalAccount | null {
  const resolved = resolveKms();
  if (!resolved.ok) return null;
  const provider = resolved.provider;

  async function signDigestHex(digestHex: Hex, reason: string): Promise<Hex> {
    const result = await provider.sign({
      keyId: options.keyId,
      purpose: options.purpose,
      digestHex,
      reason,
    });
    if (!result.ok) throw new KmsSigningError(result.refusal);
    return result.result.signatureHex as Hex;
  }

  return toAccount({
    address: options.address,

    async signMessage({ message }) {
      return signDigestHex(hashMessage(message), "eip191-message");
    },

    async signTypedData(typedData) {
      // viem's account-level signTypedData parameter is deliberately looser
      // than hashTypedData's, so the cast is a widening one across viem's own
      // two shapes rather than a claim about the payload. The digest is still
      // computed HERE, from what the caller passed — the backend never sees or
      // interprets the structured data.
      return signDigestHex(
        hashTypedData(typedData as Parameters<typeof hashTypedData>[0]),
        "eip712-typed-data"
      );
    },

    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      // Serialize UNSIGNED, hash, sign the hash, then serialize again WITH the
      // signature. Both serializations use the same serializer instance, so the
      // bytes that were hashed are the bytes that get broadcast.
      // `await`ed: viem types a serializer's return as MaybePromise, and a
      // pending Promise hashed as if it were bytes would sign the wrong thing.
      const unsigned = await serializer(transaction);
      const signature = splitSignature(
        await signDigestHex(keccak256(unsigned), `evm-tx:${transaction.chainId ?? "unknown"}`)
      );
      return serializer(transaction, {
        r: signature.r,
        s: signature.s,
        v: signature.v,
        yParity: signature.yParity,
      });
    },
  });
}

/** Whether a KMS-backed account can be built at all, without building one. */
export function kmsAccountAvailable(): boolean {
  return resolveKms().ok;
}
