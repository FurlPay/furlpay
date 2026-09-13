import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import {
  serializeSigned,
  signingHash,
  transactionHash,
  type Eip1559Transaction,
} from "./evm/transaction";
import {
  hashTypedData,
  validateTypedData,
  type TypedDataDomain,
  type TypedDataTypes,
} from "./evm/eip712";
import { deriveSolanaAddress } from "./solana/wallet";

// ---------------------------------------------------------------------------
// On-device self-custodial wallet (secp256k1 / EIP-3009).
//
// This is the user's OWN key, not an app secret: generated on the device from
// device entropy, held encrypted at rest in the Android Keystore (via
// expo-secure-store with requireAuthentication — decryption needs a biometric),
// and NEVER transmitted. The private key does not leave the phone; only signed
// EIP-712 authorizations do. Recovery is a standard BIP-39 mnemonic the user
// backs up themselves — lose the device AND the phrase and the funds at this
// address are unrecoverable, which is the meaning of self-custody.
//
// The signature this produces is a real EIP-3009 `transferWithAuthorization`,
// byte-identical to what the server's verifier recovers against
// (apps/web/src/lib/x402Signature.ts). It authorizes the gasless relay at
// POST /api/transfers/gasless — no mock, no server-held key.
// ---------------------------------------------------------------------------

const MNEMONIC_KEY = "furlpay.wallet.mnemonic"; // biometric-gated
const EXISTS_KEY = "furlpay.wallet.exists"; // plain marker so presence checks don't prompt
// Public address cached un-gated: an address is public information (it appears
// on-chain the moment it's used), so screens like Receive can show it without
// a biometric prompt. The KEY stays behind the gate.
const ADDRESS_KEY = "furlpay.wallet.address";
// Solana address cache, same un-gated rationale as ADDRESS_KEY: an address is
// public the moment it is used on-chain, so Receive can show it without a
// prompt. Derived from the SAME mnemonic (SLIP-0010, m/44'/501'/0'/0') — there
// is no second secret and nothing extra for the user to back up.
const SOL_ADDRESS_KEY = "furlpay.wallet.solanaAddress";
const ETH_PATH = "m/44'/60'/0'/0/0"; // BIP-44 Ethereum account 0, address 0

/** How long a signed EIP-3009 authorization stays valid. Long enough to cover
 *  the biometric prompt, the relay round trip and clock skew between the device
 *  and the chain — deliberately not longer. */
const AUTH_VALIDITY_SECONDS = 600; // 10 minutes

// chainId per network — must match EVM_CHAIN_IDS in apps/web/src/lib/x402Signature.ts.
const CHAIN_IDS: Record<string, number> = {
  arbitrum: 42161,
  "arbitrum-sepolia": 421614,
  base: 8453,
  "base-sepolia": 84532,
  polygon: 137,
  ethereum: 1,
};

/**
 * The ONLY token contracts this device will sign a transfer authorization for,
 * pinned per network. Mirrors the canonical registry in
 * apps/web/src/lib/services/chainRegistry.ts.
 *
 * Why this exists: the EIP-712 domain (`verifyingContract` + `chainId`) is what
 * binds a signature to a specific token on a specific chain, and both values
 * previously came straight from the server's /transfers/gasless quote. A
 * compromised or spoofed backend could therefore name any contract it liked and
 * the device would sign a valid EIP-3009 authorization against it — the user's
 * biometric said "send USDC", the bytes said something else. The backend is not
 * a trust anchor for what we sign; only this table is.
 *
 * Fail closed: a network with no pinned address cannot be signed for at all.
 * Adding a network here is a deliberate act, which is the point.
 */
const USDC_BY_NETWORK: Record<string, string> = {
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "arbitrum-sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

/** USDC is 6dp everywhere. lib/money.ts parses to atomic units on that
 *  assumption, so a quote claiming anything else is a unit-confusion bug or an
 *  attack, never something to scale around silently. */
const USDC_DECIMALS = 6;

/** Thrown when a server-supplied quote does not match what this device is
 *  willing to sign. Separate type so the UI can say "we didn't sign" plainly. */
export class UntrustedQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntrustedQuoteError";
  }
}

// SecureStore options: Keystore-backed, and the mnemonic can only be read after
// a device biometric/credential check.
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface Authorization {
  from: string;
  to: string;
  value: string; // atomic USDC (6dp) as a decimal string
  validAfter: string;
  validBefore: string;
  nonce: string; // 0x + 64 hex
}

// --- key lifecycle ----------------------------------------------------------

/** Does this device already hold a wallet? Reads a plain marker so it never
 *  triggers the biometric prompt (the mnemonic read for signing still does). */
export async function hasWallet(): Promise<boolean> {
  const marker = await SecureStore.getItemAsync(EXISTS_KEY).catch(() => null);
  return marker === "1";
}

/**
 * Create a new wallet from device entropy and store it encrypted + biometric-
 * gated. Returns the mnemonic ONCE so the caller can show a backup screen; it
 * is never returned again without a biometric read.
 */
export async function createWallet(): Promise<{ mnemonic: string; address: string }> {
  const entropy = Crypto.getRandomBytes(16); // 128-bit → 12-word mnemonic
  const mnemonic = entropyToMnemonic(entropy, wordlist);
  const address = addressFromMnemonic(mnemonic);
  await persistWallet(mnemonic, address);
  return { mnemonic, address };
}

/** Import an existing 12/24-word mnemonic (wallet recovery). */
export async function importWallet(mnemonic: string): Promise<{ address: string }> {
  const phrase = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(phrase, wordlist)) throw new Error("That recovery phrase is not valid.");
  const address = addressFromMnemonic(phrase);
  await persistWallet(phrase, address);
  return { address };
}

/**
 * Write a wallet to secure storage in an order that cannot leave a NEW key
 * paired with an OLD cached address.
 *
 * The writes are three separate, non-atomic SecureStore calls. The previous
 * order was mnemonic → EXISTS → address, so an address write that failed on an
 * import left `EXISTS=1` and a stale ADDRESS: `getKnownAddress()` would then
 * report an address whose key this device no longer holds, and the Receive
 * screen (app/receive.tsx) renders exactly that value as the deposit target.
 * Funds sent there would be unspendable.
 *
 * Order here: clear the stale cache first, then the key, then the address, and
 * only then the EXISTS marker that makes the wallet "real" to the rest of the
 * app. Every partial failure now leaves the wallet looking absent or
 * address-less, and both of those degrade to the biometric-gated `getAddress()`
 * which re-derives from the mnemonic — the source of truth.
 */
async function persistWallet(mnemonic: string, address: string): Promise<void> {
  // Both address caches are cleared FIRST, for the reason in the doc comment
  // above: a stale Solana address surviving a re-import would be rendered as a
  // deposit target for a key this device no longer holds, and SOL/FURL sent
  // there would be unspendable. Same failure, same fix, second chain.
  await SecureStore.deleteItemAsync(ADDRESS_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(SOL_ADDRESS_KEY).catch(() => {});
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, SECURE_OPTS);
  await SecureStore.setItemAsync(ADDRESS_KEY, address);
  await SecureStore.setItemAsync(SOL_ADDRESS_KEY, deriveSolanaAddress(mnemonic));
  await SecureStore.setItemAsync(EXISTS_KEY, "1"); // last: the readiness marker
}

/** Reveal the mnemonic for backup — triggers the biometric gate. */
export async function revealMnemonic(): Promise<string> {
  const m = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!m) throw new Error("No wallet on this device.");
  return m;
}

/** Remove the wallet from this device (does NOT touch on-chain funds). */
export async function deleteWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(MNEMONIC_KEY, SECURE_OPTS).catch(() => {});
  await SecureStore.deleteItemAsync(EXISTS_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(ADDRESS_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(SOL_ADDRESS_KEY).catch(() => {});
}

/** The wallet's address, read behind the biometric gate. */
export async function getAddress(): Promise<string> {
  const m = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!m) throw new Error("No wallet on this device.");
  const address = addressFromMnemonic(m);
  // Backfill the un-gated cache for installs that created their wallet before
  // the cache existed.
  await SecureStore.setItemAsync(ADDRESS_KEY, address).catch(() => {});
  return address;
}

/**
 * The wallet's address WITHOUT a biometric prompt, from the un-gated cache.
 * Null when no wallet exists, or on a pre-cache install that hasn't done a
 * gated read yet (callers then offer an explicit "unlock" action that calls
 * getAddress()). Never returns anything other than the device key's address.
 */
export async function getKnownAddress(): Promise<string | null> {
  if (!(await hasWallet())) return null;
  return SecureStore.getItemAsync(ADDRESS_KEY).catch(() => null);
}

/**
 * The wallet's SOLANA address, read behind the biometric gate.
 *
 * Same mnemonic, different curve: SLIP-0010 ed25519 at m/44'/501'/0'/0' — the
 * path Phantom, Solflare and Backpack use, so the user's existing phrase
 * restores to the SAME address in any of them. This is what lets the app hold
 * FURL, which is a Token-2022 mint on Solana.
 */
export async function getSolanaAddress(): Promise<string> {
  const m = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!m) throw new Error("No wallet on this device.");
  const address = deriveSolanaAddress(m);
  // Backfill for wallets created before Solana support existed.
  await SecureStore.setItemAsync(SOL_ADDRESS_KEY, address).catch(() => {});
  return address;
}

/**
 * The Solana address WITHOUT a biometric prompt, from the un-gated cache.
 *
 * Null on a wallet created before Solana support shipped, until one gated
 * `getSolanaAddress()` backfills it — the same upgrade path the EVM cache has.
 * Callers must treat null as "unlock to view", never as "no Solana account".
 */
export async function getKnownSolanaAddress(): Promise<string | null> {
  if (!(await hasWallet())) return null;
  return SecureStore.getItemAsync(SOL_ADDRESS_KEY).catch(() => null);
}

// --- signing ----------------------------------------------------------------

/**
 * Sign an EIP-3009 transferWithAuthorization for USDC. Reading the key triggers
 * the biometric gate, so this call IS the user's approval. Returns a 65-byte
 * 0x signature (r‖s‖v, v ∈ {27,28}).
 */
export async function signTransferAuthorization(
  auth: Authorization,
  opts: { network: string; verifyingContract: string; domainName?: string; domainVersion?: string }
): Promise<string> {
  const chainId = CHAIN_IDS[opts.network];
  if (chainId === undefined) throw new Error(`Unsupported network: ${opts.network}`);

  // Bind the EIP-712 domain to a contract WE pin, not one the caller supplied.
  // This is the last point before the key touches the digest, so it is the only
  // place the check is worth anything: every path into signing passes here.
  const pinned = USDC_BY_NETWORK[opts.network];
  if (!pinned) {
    throw new UntrustedQuoteError(`No pinned USDC contract for network: ${opts.network}`);
  }
  if (opts.verifyingContract.toLowerCase() !== pinned.toLowerCase()) {
    throw new UntrustedQuoteError(
      "Refusing to sign: the token contract does not match the known USDC contract for this network."
    );
  }

  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new Error("No wallet on this device.");
  const { priv, address } = deriveKey(mnemonic);

  if (address.toLowerCase() !== auth.from.toLowerCase()) {
    // The authorization must be FROM this device's address, or the relay's
    // signature check will (correctly) reject it.
    throw new Error("Authorization sender does not match this wallet.");
  }

  const digest = hexToBytes(
    strip0x(
      computeAuthorizationDigest(auth, {
        chainId,
        verifyingContract: opts.verifyingContract,
        name: opts.domainName ?? "USD Coin",
        version: opts.domainVersion ?? "2",
      })
    )
  );

  try {
    const sig = secp256k1.sign(digest, priv);
    const r = sig.r.toString(16).padStart(64, "0");
    const s = sig.s.toString(16).padStart(64, "0");
    const v = (sig.recovery + 27).toString(16).padStart(2, "0");
    return `0x${r}${s}${v}`;
  } finally {
    // Shorten the window in which the key sits in heap memory. The GC would
    // get here eventually; on a compromised device "eventually" is the whole
    // risk, and the derived copy is ours to erase.
    priv.fill(0);
  }
}

// --- EIP-191 personal_sign (proof-of-control, NOT money movement) ------------

/**
 * Sign an arbitrary UTF-8 message with the device key using EIP-191
 * (personal_sign): keccak256("\x19Ethereum Signed Message:\n" + len + msg),
 * then secp256k1. Recovers to this wallet's address under viem's
 * recoverMessageAddress / eth_personalSign — proven in wallet.test.ts.
 *
 * Used to prove control of the address to the server (wallet linking). It is
 * deliberately separate from signTransferAuthorization: this must never sign a
 * transfer, and a transfer signature must never double as proof-of-control.
 * Reading the key triggers the biometric gate.
 */
export async function signMessage(message: string): Promise<string> {
  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new Error("No wallet on this device.");
  const { priv } = deriveKey(mnemonic);

  const msgBytes = utf8(message);
  const prefix = utf8(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const digest = keccak_256(concatBytes(prefix, msgBytes));

  try {
    const sig = secp256k1.sign(digest, priv);
    const r = sig.r.toString(16).padStart(64, "0");
    const s = sig.s.toString(16).padStart(64, "0");
    const v = (sig.recovery + 27).toString(16).padStart(2, "0");
    return `0x${r}${s}${v}`;
  } finally {
    priv.fill(0); // see signTransferAuthorization
  }
}

// --- EIP-1559 transaction signing (non-custodial swap execution) -------------

/**
 * Sign an EIP-1559 transaction with the device key.
 *
 * Takes a TRANSACTION, not a digest. A `signDigest(bytes)` helper would be
 * shorter and would also be a blind-signing oracle: any 32 bytes the caller
 * produced, signed by the user's key on a biometric they were told was for
 * something else. Because this takes structured fields, the thing being signed
 * is inspectable — `describeTransaction` below renders it for confirmation, and
 * the caller cannot substitute a different payload without going through the
 * same shape.
 *
 * Reading the mnemonic triggers the biometric gate, so this call IS the user's
 * approval of exactly this transaction.
 *
 * Returns the raw broadcastable hex for `eth_sendRawTransaction`, plus the hash
 * it will have on-chain — the caller needs that to poll for a receipt even if
 * the broadcast response is lost.
 */
export async function signTransaction(
  tx: Eip1559Transaction
): Promise<{ raw: string; hash: string; from: string }> {
  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new Error("No wallet on this device.");
  const { priv, address } = deriveKey(mnemonic);

  try {
    const digest = signingHash(tx);
    const sig = secp256k1.sign(digest, priv);
    // EIP-1559 uses yParity (0/1), NOT the legacy v of 27/28. Adding 27 here
    // would serialize a signature that recovers to no address at all.
    const signature = { yParity: sig.recovery, r: sig.r, s: sig.s };
    return {
      raw: serializeSigned(tx, signature),
      hash: transactionHash(tx, signature),
      from: address,
    };
  } finally {
    priv.fill(0); // see signTransferAuthorization
  }
}

/**
 * Sign arbitrary EIP-712 typed data (eth_signTypedData_v4).
 *
 * ONLY for payloads that arrived from a connected dApp over WalletConnect. The
 * app's OWN typed-data signing goes through signTransferAuthorization, which
 * knows its struct at build time and cannot be steered.
 *
 * TAKES THE STRUCTURED PAYLOAD, NOT A DIGEST — the same rule signTransaction
 * follows, and for the same reason. A `signDigest(bytes)` helper would be a
 * blind-signing oracle: any 32 bytes the caller produced, signed by the user's
 * key on a biometric prompt they were told meant something else. Because this
 * takes domain + types + message, the thing being signed is inspectable, and
 * lib/walletconnect/requests.ts renders it for confirmation from the same
 * fields that are hashed here.
 *
 * The payload is validated before hashing so a malformed or self-referential
 * type graph from a remote party becomes an error, not a stack overflow.
 */
export async function signTypedData(payload: {
  domain: TypedDataDomain;
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}): Promise<string> {
  const check = validateTypedData(payload);
  if (!check.ok) throw new Error(check.reason);

  // Hashed BEFORE the key is read. If the payload is malformed the user is
  // never prompted for a biometric — a prompt that can only end in an error is
  // a prompt that teaches people to approve without reading.
  const digestHex = hashTypedData(payload);

  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new Error("No wallet on this device.");
  const { priv } = deriveKey(mnemonic);

  try {
    const sig = secp256k1.sign(hexToBytes(strip0x(digestHex)), priv);
    const r = sig.r.toString(16).padStart(64, "0");
    const s = sig.s.toString(16).padStart(64, "0");
    // 27/28, not yParity: eth_signTypedData returns a 65-byte signature in the
    // legacy v encoding, which is what every verifying contract's ecrecover
    // expects. EIP-1559 transaction signatures are the ones that use yParity.
    const v = (sig.recovery + 27).toString(16).padStart(2, "0");
    return `0x${r}${s}${v}`;
  } finally {
    priv.fill(0); // see signTransferAuthorization
  }
}

/** This device's address without prompting, or null if there is no wallet. */
export async function addressForSigning(): Promise<string | null> {
  return getKnownAddress();
}

// --- EIP-712 (matches viem's TransferWithAuthorization encoding) -------------

const TWA_TYPEHASH = keccak_256(
  utf8("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
);
const DOMAIN_TYPEHASH = keccak_256(
  utf8("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);

/**
 * The EIP-712 digest a TransferWithAuthorization signs over — byte-identical to
 * viem's hashTypedData for the same input (proven in lib/__tests__/wallet.test.ts).
 * Exported so the signing path and the correctness test share one implementation.
 */
export function computeAuthorizationDigest(
  a: Authorization,
  domain: { chainId: number; verifyingContract: string; name: string; version: string }
): string {
  const domainSeparator = keccak_256(
    concatBytes(
      DOMAIN_TYPEHASH,
      keccak_256(utf8(domain.name)),
      keccak_256(utf8(domain.version)),
      uint256(BigInt(domain.chainId)),
      addr32(domain.verifyingContract)
    )
  );
  const structHash = keccak_256(
    concatBytes(
      TWA_TYPEHASH,
      addr32(a.from),
      addr32(a.to),
      uint256(BigInt(a.value)),
      uint256(BigInt(a.validAfter)),
      uint256(BigInt(a.validBefore)),
      hexToBytes(strip0x(a.nonce)) // bytes32, already 32 bytes
    )
  );
  const digest = keccak_256(concatBytes(new Uint8Array([0x19, 0x01]), domainSeparator, structHash));
  return "0x" + bytesToHex(digest);
}

// --- key derivation & address -----------------------------------------------

function deriveKey(mnemonic: string): { priv: Uint8Array; address: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(ETH_PATH);
  if (!node.privateKey) throw new Error("Key derivation failed.");
  return { priv: node.privateKey, address: addressFromPriv(node.privateKey) };
}

/** The Ethereum address for a mnemonic (BIP-44 m/44'/60'/0'/0/0, EIP-55). */
export function deriveAddress(mnemonic: string): string {
  return deriveKey(mnemonic).address;
}
const addressFromMnemonic = deriveAddress;

function addressFromPriv(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false); // 65 bytes: 0x04 ‖ X ‖ Y
  const hash = keccak_256(pub.slice(1)); // keccak of X‖Y
  return toChecksumAddress("0x" + bytesToHex(hash.slice(-20)));
}

/** EIP-55 checksummed address. */
function toChecksumAddress(addr: string): string {
  const lower = strip0x(addr).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

// --- byte helpers ------------------------------------------------------------

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function strip0x(s: string): string {
  return s.startsWith("0x") ? s.slice(2) : s;
}
function uint256(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("uint256 overflow");
  return hexToBytes(hex);
}
function addr32(a: string): Uint8Array {
  return hexToBytes(strip0x(a).toLowerCase().padStart(64, "0"));
}

export function randomNonce(): string {
  return "0x" + bytesToHex(Crypto.getRandomBytes(32));
}

// --- account linking (prove control to the server) --------------------------

import { api, ApiError } from "./api";
import { parseUsdcAmount } from "./money";

export interface LinkStatus {
  linked: { address: string; verifiedAt: string; status: string } | null;
}

/** Current server-side link status for this account. */
export function linkStatus(): Promise<LinkStatus> {
  return api<LinkStatus>("/wallet/link");
}

/**
 * Prove control of this device's wallet to the server and link it to the
 * account: request a server challenge, sign the EXACT returned message
 * (biometric-gated), submit the signature for server-side recovery. The server
 * never trusts the address without this proof.
 */
export async function linkDevice(): Promise<{ address: string; verifiedAt: string }> {
  const address = await getAddress(); // biometric gate #1
  const { message } = await api<{ message: string; expiresAt: string }>("/wallet/link/challenge", {
    method: "POST",
    body: { address },
  });
  const signature = await signMessage(message); // biometric gate #2 (the actual proof)
  try {
    const res = await api<{ linked: { address: string; verifiedAt: string } }>("/wallet/link/verify", {
      method: "POST",
      body: { address, signature },
    });
    return res.linked;
  } catch (e) {
    // 403 stepup_required: the server demands a recent OTP/passkey re-auth. Surface
    // a typed signal so the UI can route the user to re-verify, not a raw error.
    if (e instanceof ApiError && e.status === 403 && (e.data as { error?: string })?.error === "stepup_required") {
      throw new StepUpRequiredError();
    }
    throw e;
  }
}

/** Thrown by linkDevice when the server requires a fresh OTP/passkey step-up. */
export class StepUpRequiredError extends Error {
  constructor() {
    super("Please re-verify with a login code or passkey, then link again.");
    this.name = "StepUpRequiredError";
  }
}

// --- gasless send (real EIP-3009 relay) -------------------------------------

export interface GaslessQuote {
  network: string;
  asset: { symbol: string; address: string; decimals: number };
  fee: { usd: number; sponsored: boolean; detail: string };
  maxPerTransferUsd: number;
  live: boolean;
}

export type GaslessResult =
  | { kind: "settled"; transaction: string; network: string }
  | { kind: "pending"; transaction: string; statusPath: string }
  | { kind: "simulated"; transaction: string } // server not in live mode
  | { kind: "unavailable"; detail: string }; // rail not configured (503)

/**
 * Send USDC from THIS device's wallet to `to`, gaslessly. The user signs an
 * EIP-3009 authorization (biometric-gated); Furlpay's relayer submits it.
 * Real settlement requires the server in live mode with a configured relayer —
 * otherwise this resolves `simulated`/`unavailable`, never a false success.
 *
 * The amount is parsed straight to atomic units (lib/money.ts) and MUST be
 * > 0n — "0.0000001" style inputs that float-pass `> 0` but truncate to zero
 * atomic units are rejected before anything is signed. Throws AmountError with
 * a user-displayable message on any invalid amount.
 */
export async function sendGasless(to: string, amountUsd: string): Promise<GaslessResult> {
  const atomic = parseUsdcAmount(amountUsd); // throws AmountError; guarantees > 0n
  const quote = await api<GaslessQuote>("/transfers/gasless", { anonymous: false });

  // The quote is untrusted input. `atomic` was scaled by 10^6 on the assumption
  // the asset is USDC; a quote naming a different precision would mean the
  // number we sign is not the number the user typed (a 2dp asset would sign
  // 10,000x the intended amount). Reject rather than rescale — silently
  // honouring a server-chosen precision is how decimal-confusion drains a
  // wallet. The contract itself is re-checked inside signTransferAuthorization.
  if (quote.asset.decimals !== USDC_DECIMALS) {
    throw new UntrustedQuoteError(
      `Refusing to sign: expected a ${USDC_DECIMALS}-decimal asset, quote says ${quote.asset.decimals}.`
    );
  }
  if (quote.asset.symbol?.toUpperCase() !== "USDC") {
    throw new UntrustedQuoteError(`Refusing to sign: expected USDC, quote says ${quote.asset.symbol}.`);
  }

  const from = await getAddress(); // biometric gate #1 (address read)

  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from,
    to,
    value: atomic.toString(),
    validAfter: "0",
    // The relay submits within seconds, so the authorization only needs to
    // outlive one round trip plus clock skew. Every extra minute is time an
    // intercepted authorization stays replayable on-chain, so keep it tight.
    validBefore: String(now + AUTH_VALIDITY_SECONDS),
    nonce: randomNonce(),
  };

  const signature = await signTransferAuthorization(authorization, {
    network: quote.network,
    verifyingContract: quote.asset.address,
  });

  try {
    const res = await api<{
      ok?: boolean;
      transaction?: string;
      simulated?: boolean;
      pending?: { transaction: string; statusPath: string };
    }>("/transfers/gasless", { method: "POST", body: { signature, authorization } });

    if (res.pending) return { kind: "pending", transaction: res.pending.transaction, statusPath: res.pending.statusPath };
    if (res.simulated) return { kind: "simulated", transaction: res.transaction ?? "" };
    if (res.ok && res.transaction) return { kind: "settled", transaction: res.transaction, network: quote.network };
    return { kind: "unavailable", detail: "Gasless transfers are not available yet." };
  } catch (e) {
    // 503 (no relayer configured) / 502 (relay failed) surface as an honest
    // "not available", never a fabricated success. The nonce is already burned
    // server-side, so an honest retry signs a fresh one.
    if (e instanceof ApiError && (e.status === 503 || e.status === 502)) {
      return { kind: "unavailable", detail: e.message };
    }
    throw e;
  }
}
