import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { derivePath } from "./slip10";

// ---------------------------------------------------------------------------
// Solana account, derived from the SAME BIP-39 mnemonic as the EVM account.
//
// WHY THIS EXISTS. The native app was EVM-only, which meant it could not hold
// FURL — FurlPay's own token, which is a Token-2022 mint on Solana. A wallet
// that cannot hold the ecosystem's token is a gap the web app does not have.
//
// ONE PHRASE, TWO CHAINS. The user's existing 12-word mnemonic derives both
// accounts. No second backup, no second thing to lose. The seed goes through
// SLIP-0010 (ed25519) at `m/44'/501'/{account}'/0'` — the path Phantom,
// Solflare and Backpack use, so the SAME phrase restored in any of those shows
// the SAME address. That compatibility is the whole point: a wallet that
// derives a non-standard address strands the user's funds behind our app.
//
// THE KEY IS NEVER STORED SEPARATELY. There is no new secret here and no second
// SecureStore entry to protect. The Solana key is derived on demand from the
// mnemonic that is already behind the biometric gate, used, and zeroed.
// ---------------------------------------------------------------------------

/** BIP-44 coin type for Solana. */
const SOLANA_COIN_TYPE = 501;

/**
 * The account path. `m/44'/501'/{account}'/0'` is the Phantom/Solflare/Backpack
 * convention; deviating from it means the user's phrase resolves elsewhere in
 * every other wallet.
 */
export function solanaPath(account = 0): string {
  if (!Number.isInteger(account) || account < 0 || account > 0x7fffffff) {
    throw new Error(`Invalid Solana account index: ${account}`);
  }
  return `m/44'/${SOLANA_COIN_TYPE}'/${account}'/0'`;
}

export interface SolanaKey {
  /** 32-byte ed25519 seed (the "private key" in Solana terms). */
  secret: Uint8Array;
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** base58 public key — the address a user sees and shares. */
  address: string;
}

/**
 * Derive the Solana key for `account` from a mnemonic.
 *
 * CALLER MUST ZERO `secret` when finished (`secret.fill(0)` in a `finally`),
 * matching how the EVM path handles `priv`. A key left in a JS heap outlives the
 * operation and can be read from a memory dump.
 */
export function deriveSolanaKey(mnemonic: string, account = 0): SolanaKey {
  const seed = mnemonicToSeedSync(mnemonic);
  try {
    const node = derivePath(solanaPath(account), seed);
    const secret = node.key;
    const publicKey = ed25519.getPublicKey(secret);
    return { secret, publicKey, address: base58.encode(publicKey) };
  } finally {
    // The BIP-39 seed is as sensitive as the key it produces.
    seed.fill(0);
  }
}

/** The Solana address for a mnemonic. Derives, reads the address, zeroes the key. */
export function deriveSolanaAddress(mnemonic: string, account = 0): string {
  const key = deriveSolanaKey(mnemonic, account);
  try {
    return key.address;
  } finally {
    key.secret.fill(0);
  }
}

/**
 * Sign 32+ arbitrary bytes with the Solana key (ed25519, 64-byte signature).
 *
 * Solana signs the serialized MESSAGE of a transaction, not a hash of it — the
 * caller passes the exact bytes to be signed.
 */
export function signWithSolanaKey(
  mnemonic: string,
  message: Uint8Array,
  account = 0,
): Uint8Array {
  const key = deriveSolanaKey(mnemonic, account);
  try {
    return ed25519.sign(message, key.secret);
  } finally {
    key.secret.fill(0);
  }
}

/** Verify a signature against an address. Used to prove a derivation round-trips. */
export function verifySolanaSignature(
  address: string,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    const publicKey = base58.decode(address);
    if (publicKey.length !== 32) return false;
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Is this a well-formed Solana address?
 *
 * base58 of the right LENGTH is not the same as 32 decodable bytes, which is
 * why this decodes rather than pattern-matching. A near-miss address that a
 * regex accepts is an unrecoverable transfer.
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/** Shorten for display. Never used where a user must verify the full string. */
export function shortenSolanaAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
