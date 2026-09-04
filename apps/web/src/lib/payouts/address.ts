import { getAddress, isAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import {
  canonicalNetwork,
  nativeStablecoin,
  resolveAsset,
  type AssetId,
  type AssetNetwork,
} from "@furlpay/gateway";

// ---------------------------------------------------------------------------
// Payout destination validation.
//
// THE DISTINCTION THIS FILE EXISTS TO ENFORCE:
//
//     an address FORMAT can be detected
//     a NETWORK cannot
//
// Every EVM chain shares one address format. `0x1234…` is simultaneously a
// valid address on Ethereum, Base, Arbitrum, Polygon and a hundred others, and
// nothing in the string says which one the holder actually controls. A UI that
// "detects Base" from an EVM address is guessing, and the cost of guessing
// wrong is a transfer to an address the recipient cannot access on that chain
// — irreversibly.
//
// So `detectFormat` returns a FORMAT and refuses to name a network. The
// network is supplied by the user and confirmed explicitly, and the pair is
// validated together. Solana is different: base58 Ed25519 points are not valid
// EVM addresses, so the format IS decisive there — but it still does not
// distinguish mainnet-beta from devnet, which is why the network stays an
// explicit input in both cases.
// ---------------------------------------------------------------------------

export type AddressFormat = "evm" | "solana";

/** Formats that cannot, by themselves, identify a single network. */
const AMBIGUOUS_FORMATS: readonly AddressFormat[] = ["evm", "solana"];

export type AddressCheck =
  | { ok: true; format: AddressFormat; normalized: string; ambiguous: boolean }
  | { ok: false; reason: AddressRejection; detail: string };

export type AddressRejection =
  | "empty"
  | "unrecognised_format"
  | "bad_checksum"
  | "wrong_format_for_network"
  | "not_on_curve"
  | "looks_like_a_transaction"
  | "burn_address";

/**
 * Addresses that are syntactically valid and would destroy the payout.
 *
 * The zero address is the classic: it passes every format check and every
 * checksum, and funds sent there are gone. It appears in a payout field far
 * more often than one would hope, usually as an uninitialised variable that
 * reached a form field.
 */
const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "11111111111111111111111111111111", // Solana system program
]);

/**
 * Identify the address FORMAT. Never the network — see the header.
 *
 * Order matters: the EVM check is tried first because it is exact (0x + 40
 * hex), and a base58 decode of an EVM string would fail anyway.
 */
export function detectFormat(raw: string): AddressFormat | null {
  const value = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return "evm";
  if (isSolanaAddress(value)) return "solana";
  return null;
}

function isSolanaAddress(value: string): boolean {
  // A Solana address is a 32-byte Ed25519 public key in base58. PublicKey's
  // constructor validates the base58 and the length; `isOnCurve` is a separate
  // question handled in `checkAddress`.
  try {
    const key = new PublicKey(value);
    return key.toBytes().length === 32;
  } catch {
    return false;
  }
}

/**
 * Validate an address on its own terms, before any network is considered.
 *
 * Checksums are enforced for EVM rather than merely normalised. A mixed-case
 * EVM address that fails EIP-55 is a typo the standard was designed to catch;
 * silently lower-casing it and proceeding discards the one protection the
 * format offers.
 */
export function checkAddress(raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty", detail: "Enter a wallet address." };

  // A 64-hex-char string is a transaction hash, not an address. People paste
  // them constantly; saying so is more useful than "invalid address".
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return {
      ok: false,
      reason: "looks_like_a_transaction",
      detail: "That looks like a transaction hash, not a wallet address.",
    };
  }

  const format = detectFormat(value);
  if (!format) {
    return {
      ok: false,
      reason: "unrecognised_format",
      detail: "That is not a recognised EVM (0x…) or Solana address.",
    };
  }

  if (format === "evm") {
    const hasMixedCase = /[a-f]/.test(value.slice(2)) && /[A-F]/.test(value.slice(2));
    if (hasMixedCase && !isAddress(value, { strict: true })) {
      return {
        ok: false,
        reason: "bad_checksum",
        detail: "This address fails its EIP-55 checksum — it may contain a typo.",
      };
    }
    const normalized = getAddress(value.toLowerCase());
    if (BURN_ADDRESSES.has(normalized.toLowerCase())) {
      return {
        ok: false,
        reason: "burn_address",
        detail: "Funds sent to this address cannot be recovered.",
      };
    }
    return { ok: true, format, normalized, ambiguous: true };
  }

  // Solana. An address that is NOT on the Ed25519 curve is a program-derived
  // address: nobody holds its private key, so nobody can move tokens out of
  // it. Some are legitimate token accounts, but as a PAYOUT DESTINATION for a
  // person it is almost always a mistake, and an unrecoverable one.
  const key = new PublicKey(value);
  if (BURN_ADDRESSES.has(value)) {
    return { ok: false, reason: "burn_address", detail: "Funds sent to this address cannot be recovered." };
  }
  if (!PublicKey.isOnCurve(key.toBytes())) {
    return {
      ok: false,
      reason: "not_on_curve",
      detail:
        "This is a program-derived address with no private key. A payout sent here could not be withdrawn.",
    };
  }
  return { ok: true, format, normalized: key.toBase58(), ambiguous: true };
}

// ── network + asset + address, validated as one combination ────────────────

export interface DestinationInput {
  /** Legacy or canonical network name. Supplied by the user, never inferred. */
  network: string;
  /** The payout asset's address on that network. Optional: defaults to the
   *  network's registered stablecoin. */
  assetAddress?: string;
  /** The recipient's wallet address. */
  address: string;
}

export type DestinationCheck =
  | {
      ok: true;
      /** The confirmed network — from the USER's choice, not from the address. */
      network: AssetNetwork;
      asset: AssetId;
      address: string;
      format: AddressFormat;
      /** True when the address format alone could not have identified this
       *  network, so the UI must show an explicit confirmation step. */
      requiresNetworkConfirmation: boolean;
    }
  | { ok: false; reason: DestinationRejection; detail: string };

export type DestinationRejection = AddressRejection | "unknown_network" | "asset_not_on_network";

const FORMAT_FOR_CHAIN: Readonly<Record<string, AddressFormat>> = {
  solana: "solana",
  base: "evm",
  arbitrum: "evm",
  polygon: "evm",
};

/**
 * Validate network, asset and address together.
 *
 * Any one of the three checked alone is insufficient:
 *   - a valid address on the wrong network is an unrecoverable transfer
 *   - a valid network with an asset that does not exist on it cannot settle
 *   - a valid asset with a wrong-format address fails at broadcast, or worse
 *     succeeds into an address nobody controls
 */
export function checkDestination(input: DestinationInput): DestinationCheck {
  const network = canonicalNetwork(input.network);
  if (!network) {
    return {
      ok: false,
      reason: "unknown_network",
      detail: `FurlPay does not pay out on "${input.network}".`,
    };
  }

  // The asset must exist ON THIS NETWORK. `resolveAsset` throws
  // AssetNetworkMismatchError when the address belongs to a different one —
  // the same guard that stops a mainnet mint reaching a devnet rail.
  let asset: AssetId;
  try {
    asset = input.assetAddress
      ? resolveAsset(network, input.assetAddress)
      : nativeStablecoin(network);
  } catch (e) {
    return { ok: false, reason: "asset_not_on_network", detail: (e as Error).message };
  }

  const addr = checkAddress(input.address);
  if (!addr.ok) return addr;

  const expected = FORMAT_FOR_CHAIN[asset.chain];
  if (expected && addr.format !== expected) {
    return {
      ok: false,
      reason: "wrong_format_for_network",
      detail: `${network} expects ${expected === "evm" ? "an EVM (0x…)" : "a Solana"} address, but this is ${
        addr.format === "evm" ? "an EVM" : "a Solana"
      } address.`,
    };
  }

  return {
    ok: true,
    network,
    asset,
    address: addr.normalized,
    format: addr.format,
    // ALWAYS true for the formats we support. Stated as a field rather than a
    // constant so the UI reads the reason rather than hardcoding the step, and
    // so a future format that IS decisive can set it false honestly.
    requiresNetworkConfirmation: AMBIGUOUS_FORMATS.includes(addr.format),
  };
}

/** Display form: enough to recognise, not enough to leak in a public channel. */
export function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}${"•".repeat(6)}${address.slice(-4)}`;
}
