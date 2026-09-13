import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha2";

// ---------------------------------------------------------------------------
// SLIP-0010 key derivation for ed25519.
//
// WHY THIS IS HAND-WRITTEN. `@scure/bip32`'s HDKey is secp256k1 — it cannot
// derive ed25519 keys, and Solana is ed25519. The alternative was a new
// dependency for roughly forty lines of HMAC, on a path that derives the key
// holding someone's money. The trade was made toward fewer supply-chain
// surfaces, and paid for with test vectors: `__tests__/slip10.test.ts` checks
// this against the official SLIP-0010 vectors, which were fetched from the spec
// rather than recalled.
//
// ED25519 IS HARDENED-ONLY. SLIP-0010 defines no public-parent → public-child
// derivation for ed25519 (you cannot add a tweak to an ed25519 public key the
// way you can on secp256k1). Every index in the path MUST be hardened, and
// `derivePath` rejects a path that is not — silently hardening a non-hardened
// index would derive a DIFFERENT key than the user's other wallet does, and
// they would see an empty account and conclude their funds were gone.
//
// Spec: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
// ---------------------------------------------------------------------------

/** Marks an index as hardened (2^31). */
const HARDENED_OFFSET = 0x80000000;

const MASTER_SECRET = new TextEncoder().encode("ed25519 seed");

export interface Slip10Node {
  /** 32-byte ed25519 seed for this node — NOT the 64-byte expanded secret. */
  key: Uint8Array;
  chainCode: Uint8Array;
}

/** ser32(i) — big-endian uint32. */
function ser32(index: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, index, false);
  return out;
}

/** I = HMAC-SHA512(Key = "ed25519 seed", Data = seed). */
export function masterKeyFromSeed(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, MASTER_SECRET, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/**
 * One hardened child step: I = HMAC-SHA512(Key = c_par, Data = 0x00 ‖ k_par ‖ ser32(i)).
 *
 * The leading 0x00 is not padding — it is what distinguishes this from the
 * secp256k1 public-key-prefixed form, and omitting it derives a different tree.
 */
export function deriveChild(node: Slip10Node, index: number): Slip10Node {
  if (index < HARDENED_OFFSET) {
    throw new Error(
      `SLIP-0010 ed25519 supports hardened derivation only; got index ${index}. ` +
        `Harden it (index + 0x80000000) or fix the path.`,
    );
  }
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);
  data.set(ser32(index), 33);
  const I = hmac(sha512, node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/**
 * Derive a full path such as `m/44'/501'/0'/0'`.
 *
 * Accepts `'` or `h` as the hardened marker. A path with any non-hardened
 * segment throws rather than being coerced — see the header.
 */
export function derivePath(path: string, seed: Uint8Array): Slip10Node {
  const trimmed = path.trim();
  if (!/^m(\/\d+['h]?)*$/.test(trimmed)) {
    throw new Error(`Invalid derivation path: "${path}"`);
  }

  let node = masterKeyFromSeed(seed);
  const segments = trimmed.split("/").slice(1);

  for (const segment of segments) {
    const hardened = segment.endsWith("'") || segment.endsWith("h");
    const raw = Number.parseInt(hardened ? segment.slice(0, -1) : segment, 10);
    if (!Number.isInteger(raw) || raw < 0 || raw >= HARDENED_OFFSET) {
      throw new Error(`Invalid path segment "${segment}" in "${path}"`);
    }
    if (!hardened) {
      throw new Error(
        `Path "${path}" contains the non-hardened segment "${segment}". ed25519 ` +
          `derivation is hardened-only, and hardening it silently would derive a ` +
          `different key than your other wallet — showing an empty account.`,
      );
    }
    node = deriveChild(node, raw + HARDENED_OFFSET);
  }

  return node;
}
