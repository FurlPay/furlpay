import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";

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
const ETH_PATH = "m/44'/60'/0'/0/0"; // BIP-44 Ethereum account 0, address 0

// chainId per network — must match EVM_CHAIN_IDS in apps/web/src/lib/x402Signature.ts.
const CHAIN_IDS: Record<string, number> = {
  arbitrum: 42161,
  "arbitrum-sepolia": 421614,
  base: 8453,
  "base-sepolia": 84532,
  polygon: 137,
  ethereum: 1,
};

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
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, SECURE_OPTS);
  await SecureStore.setItemAsync(EXISTS_KEY, "1");
  return { mnemonic, address: addressFromMnemonic(mnemonic) };
}

/** Import an existing 12/24-word mnemonic (wallet recovery). */
export async function importWallet(mnemonic: string): Promise<{ address: string }> {
  const phrase = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(phrase, wordlist)) throw new Error("That recovery phrase is not valid.");
  await SecureStore.setItemAsync(MNEMONIC_KEY, phrase, SECURE_OPTS);
  await SecureStore.setItemAsync(EXISTS_KEY, "1");
  return { address: addressFromMnemonic(phrase) };
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
}

/** The wallet's address, read behind the biometric gate. */
export async function getAddress(): Promise<string> {
  const m = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!m) throw new Error("No wallet on this device.");
  return addressFromMnemonic(m);
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

  const sig = secp256k1.sign(digest, priv);
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${v}`;
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

  const sig = secp256k1.sign(digest, priv);
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${v}`;
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

/** USD (as a decimal string) → atomic USDC units (6dp), no float drift. */
export function usdcToAtomic(usd: string): string {
  const [whole, frac = ""] = usd.trim().split(".");
  const cents = (frac + "000000").slice(0, 6);
  const atomic = BigInt(whole || "0") * 1_000_000n + BigInt(cents || "0");
  return atomic.toString();
}

/**
 * Send USDC from THIS device's wallet to `to`, gaslessly. The user signs an
 * EIP-3009 authorization (biometric-gated); Furlpay's relayer submits it.
 * Real settlement requires the server in live mode with a configured relayer —
 * otherwise this resolves `simulated`/`unavailable`, never a false success.
 */
export async function sendGasless(to: string, amountUsd: string): Promise<GaslessResult> {
  const quote = await api<GaslessQuote>("/transfers/gasless", { anonymous: false });
  const from = await getAddress(); // biometric gate #1 (address read)

  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from,
    to,
    value: usdcToAtomic(amountUsd),
    validAfter: "0",
    validBefore: String(now + 3600), // 1-hour window
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
