import { base58check, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";

// ---------------------------------------------------------------------------
// Bitcoin on-chain address validation.
//
// A SEPARATE ADAPTER ON PURPOSE. Bitcoin is not an EVM chain with different
// constants. It has a UTXO model, five address encodings across two encoding
// schemes, and a network that is identified BY the address rather than chosen
// alongside it. Forcing it through the EVM/Solana destination type would mean
// either weakening that type or lying about Bitcoin.
//
// THE ENCODING RULE THAT MATTERS (BIP-350):
//
//     witness v0  (P2WPKH, P2WSH)  MUST use bech32
//     witness v1+ (P2TR)           MUST use bech32m
//
// The two checksums differ by a single constant. An implementation that
// decodes everything with bech32 accepts a corrupted Taproot address and
// rejects valid ones — and a corrupted address is an unspendable payout. This
// module therefore decodes with the scheme the witness version demands and
// re-checks, rather than trying one and falling back to the other.
//
// Cryptography is not invented here. @scure/base supplies the audited bech32,
// bech32m and base58check implementations; this file supplies the Bitcoin
// rules about which to use and what the decoded bytes must look like.
// ---------------------------------------------------------------------------

export type BitcoinNetwork = "bitcoin:mainnet" | "bitcoin:testnet" | "bitcoin:regtest";

export type BitcoinAddressType =
  | "p2pkh" // 1…    legacy, pay-to-pubkey-hash
  | "p2sh" // 3…     pay-to-script-hash (often a wrapped SegWit)
  | "p2wpkh" // bc1q…  native SegWit, 20-byte program
  | "p2wsh" // bc1q…  native SegWit, 32-byte program
  | "p2tr"; // bc1p…  Taproot, witness v1

export interface BitcoinAddress {
  address: string;
  type: BitcoinAddressType;
  network: BitcoinNetwork;
  /** Witness version for segwit types; null for base58 types. */
  witnessVersion: number | null;
}

export type BitcoinCheck =
  | { ok: true; value: BitcoinAddress }
  | { ok: false; reason: BitcoinRejection; detail: string };

export type BitcoinRejection =
  | "empty"
  | "unrecognised_format"
  | "bad_checksum"
  | "wrong_encoding_for_witness_version"
  | "unsupported_witness_version"
  | "bad_program_length"
  | "network_mismatch"
  | "uppercase_mixed";

const BECH32_HRP: Readonly<Record<string, BitcoinNetwork>> = {
  bc: "bitcoin:mainnet",
  tb: "bitcoin:testnet",
  bcrt: "bitcoin:regtest",
};

/** base58check version bytes. Mainnet and testnet differ, which is the only
 *  thing stopping a testnet payout address from being paid on mainnet. */
const BASE58_VERSIONS: Readonly<Record<number, { type: BitcoinAddressType; network: BitcoinNetwork }>> = {
  0x00: { type: "p2pkh", network: "bitcoin:mainnet" },
  0x05: { type: "p2sh", network: "bitcoin:mainnet" },
  0x6f: { type: "p2pkh", network: "bitcoin:testnet" },
  0xc4: { type: "p2sh", network: "bitcoin:testnet" },
};

const b58 = base58check(sha256);

/**
 * Validate a Bitcoin address and identify its type and network.
 *
 * The network is DERIVED from the address, not supplied alongside it. This is
 * the opposite of the EVM case and is a genuine property of the encoding: the
 * human-readable part ("bc" / "tb") and the base58 version byte both name the
 * network, so a testnet address simply cannot be read as a mainnet one.
 */
export function checkBitcoinAddress(raw: string): BitcoinCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty", detail: "Enter a Bitcoin address." };

  // Bech32 is case-insensitive but MUST NOT mix cases — BIP-173 forbids it so
  // that the checksum cannot be laundered by re-casing.
  const looksBech32 = /^(bc|tb|bcrt)1/i.test(value);
  if (looksBech32 && value !== value.toLowerCase() && value !== value.toUpperCase()) {
    return {
      ok: false,
      reason: "uppercase_mixed",
      detail: "A Bitcoin address must not mix upper and lower case.",
    };
  }

  if (looksBech32) return decodeSegwit(value.toLowerCase());
  return decodeBase58(value);
}

function decodeSegwit(value: string): BitcoinCheck {
  // Decode once with bech32 purely to read the witness version, then re-decode
  // with the scheme that version REQUIRES. Reading the version from a decode
  // whose checksum may be the wrong variant is safe because the version is
  // recovered before the checksum is trusted — and the authoritative decode
  // below is the one whose result is used.
  let version: number;
  try {
    const loose = bech32.decodeUnsafe(value, 128) ?? bech32m.decodeUnsafe(value, 128);
    if (!loose || loose.words.length === 0) {
      return { ok: false, reason: "unrecognised_format", detail: "That is not a valid Bitcoin address." };
    }
    version = loose.words[0];
  } catch {
    return { ok: false, reason: "unrecognised_format", detail: "That is not a valid Bitcoin address." };
  }

  if (version > 16) {
    return {
      ok: false,
      reason: "unsupported_witness_version",
      detail: `Witness version ${version} is not a valid Bitcoin address version.`,
    };
  }

  const scheme = version === 0 ? bech32 : bech32m;
  const decoded = scheme.decodeUnsafe(value, 128);
  if (!decoded) {
    // The address decoded under the OTHER scheme, which means its checksum is
    // for the wrong witness version. BIP-350 exists precisely because these
    // two are otherwise indistinguishable.
    return {
      ok: false,
      reason: "wrong_encoding_for_witness_version",
      detail:
        version === 0
          ? "This looks like a SegWit v0 address but carries a bech32m checksum."
          : "This looks like a Taproot address but carries a bech32 checksum.",
    };
  }

  const network = BECH32_HRP[decoded.prefix];
  if (!network) {
    return {
      ok: false,
      reason: "unrecognised_format",
      detail: `"${decoded.prefix}" is not a Bitcoin address prefix.`,
    };
  }

  let program: Uint8Array;
  try {
    program = Uint8Array.from(scheme.fromWords(decoded.words.slice(1)));
  } catch {
    return { ok: false, reason: "bad_checksum", detail: "This address is malformed." };
  }

  if (version === 0) {
    if (program.length === 20) {
      return { ok: true, value: { address: value, type: "p2wpkh", network, witnessVersion: 0 } };
    }
    if (program.length === 32) {
      return { ok: true, value: { address: value, type: "p2wsh", network, witnessVersion: 0 } };
    }
    return {
      ok: false,
      reason: "bad_program_length",
      detail: "A SegWit v0 address must contain a 20- or 32-byte program.",
    };
  }

  if (version === 1) {
    if (program.length !== 32) {
      return {
        ok: false,
        reason: "bad_program_length",
        detail: "A Taproot address must contain a 32-byte program.",
      };
    }
    return { ok: true, value: { address: value, type: "p2tr", network, witnessVersion: 1 } };
  }

  // v2–v16 are reserved for future soft forks. They are syntactically valid
  // and FurlPay cannot construct spends for them, so they are refused rather
  // than accepted into a payout that could not be built.
  return {
    ok: false,
    reason: "unsupported_witness_version",
    detail: `Witness version ${version} is reserved for a future upgrade and is not payable.`,
  };
}

function decodeBase58(value: string): BitcoinCheck {
  let bytes: Uint8Array;
  try {
    bytes = b58.decode(value);
  } catch {
    return { ok: false, reason: "unrecognised_format", detail: "That is not a valid Bitcoin address." };
  }
  // version byte + 20-byte hash
  if (bytes.length !== 21) {
    return { ok: false, reason: "bad_program_length", detail: "This address is the wrong length." };
  }
  const spec = BASE58_VERSIONS[bytes[0]];
  if (!spec) {
    return {
      ok: false,
      reason: "unrecognised_format",
      detail: "This address is not a Bitcoin address for a network FurlPay supports.",
    };
  }
  return {
    ok: true,
    value: { address: value, type: spec.type, network: spec.network, witnessVersion: null },
  };
}

/**
 * Validate an address AND assert the network the operator expects.
 *
 * Bitcoin derives its network from the address, so the check here is an
 * agreement test rather than a lookup: a testnet address submitted for a
 * mainnet payout is a mistake worth naming loudly, not something to silently
 * re-home.
 */
export function checkBitcoinDestination(raw: string, expected: BitcoinNetwork): BitcoinCheck {
  const result = checkBitcoinAddress(raw);
  if (!result.ok) return result;
  if (result.value.network !== expected) {
    return {
      ok: false,
      reason: "network_mismatch",
      detail: `That is a ${label(result.value.network)} address, but this payout is on ${label(expected)}.`,
    };
  }
  return result;
}

function label(n: BitcoinNetwork): string {
  return { "bitcoin:mainnet": "Bitcoin mainnet", "bitcoin:testnet": "Bitcoin testnet", "bitcoin:regtest": "Bitcoin regtest" }[n];
}

/** Human name for a confirmation screen. The type matters to the payer: a
 *  Taproot output costs less to spend and not every wallet can build one. */
export function addressTypeLabel(t: BitcoinAddressType): string {
  return {
    p2pkh: "Legacy (P2PKH)",
    p2sh: "P2SH",
    p2wpkh: "Native SegWit (P2WPKH)",
    p2wsh: "Native SegWit (P2WSH)",
    p2tr: "Taproot (P2TR)",
  }[t];
}
