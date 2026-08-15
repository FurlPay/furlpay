// ---------------------------------------------------------------------------
// Unified wallet-address validation.
//
// The same question — "is this a payable address, and on which chain?" — was
// being answered differently in each place that asked it. parseQrPayload's JSON
// branch accepted any string of 20+ characters; its EIP-681 branch matched a
// union of base58 and hex characters with no per-chain check, so
// `ethereum:<base58 junk>` parsed as an Ethereum address. The server rejects
// both at TransferSchema, so neither loses funds — but the UI reported a
// successful scan for an address that cannot exist, and the user only found out
// at submit.
//
// WHY BASE58 IS DECODED RATHER THAN REGEX-MATCHED. A Solana address is a 32-BYTE
// ed25519 public key rendered in base58. The usual `^[1-9A-HJ-NP-Za-km-z]{32,44}$`
// check tests the alphabet and a length range, which is necessary but not
// sufficient: plenty of strings in that range decode to 31 or 33 bytes and are
// not valid keys. AGENTS.md rule 9 calls for `new PublicKey()` in a try/catch,
// which is exactly a base58 decode plus a 32-byte length assertion — reproduced
// here in ~20 lines so the check is identical on the client without pulling
// @solana/web3.js (and its dependency tree) into the browser bundle. Server
// routes may still use PublicKey directly; the verdicts agree.
// ---------------------------------------------------------------------------

export type AddressChainKind = "evm" | "solana";

/** EVM: 0x + exactly 40 hex characters. Checksum casing is NOT enforced —
 *  EIP-55 is optional and many wallets emit all-lowercase. */
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SOLANA_KEY_BYTES = 32;

/** Decode base58 to bytes, or null when the input is not valid base58. */
function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;
  const bytes: number[] = [0];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's in base58 are leading zero bytes.
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value.trim());
}

/** True for a base58 string that decodes to exactly 32 bytes. */
export function isSolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  // Cheap reject before the O(n²) decode, and it bounds the work an attacker
  // can cause by pasting a megabyte of base58.
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  const decoded = base58Decode(trimmed);
  return decoded !== null && decoded.length === SOLANA_KEY_BYTES;
}

/** Which chain family an address belongs to, or null when it is neither. */
export function classifyAddress(value: string): AddressChainKind | null {
  const trimmed = value.trim();
  if (isEvmAddress(trimmed)) return "evm";
  if (isSolanaAddress(trimmed)) return "solana";
  return null;
}

/** True when `address` is payable on `kind`. */
export function isValidForChainKind(address: string, kind: AddressChainKind): boolean {
  return kind === "evm" ? isEvmAddress(address) : isSolanaAddress(address);
}

/** Middle-elided form for display: 0x1234…cdef. Never used for comparison. */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  const trimmed = address.trim();
  if (trimmed.length <= lead + tail + 1) return trimmed;
  return `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}`;
}
