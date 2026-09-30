import type { Eip1559Transaction } from "@/lib/evm/transaction";
import type { TypedDataDomain, TypedDataTypes } from "@/lib/evm/eip712";
import type { DeviceConnection } from "./connection";

// ---------------------------------------------------------------------------
// Vendor-neutral signing.
//
// Everything that moves money goes through `AccountSigner`. The on-device key
// is one implementation; a Ledger over BLE, a Tangem card over NFC, a Keystone
// over animated QR and a WalletConnect relay are others. The swap engine does
// not know or care which — that is the whole point, and it is why this file has
// no import from any vendor SDK.
//
// CAPABILITIES ARE BEHAVIOUR, NOT DOCUMENTATION. `trustedDisplay` is the one
// that matters most: a Ledger renders the transaction on its own screen driven
// by the Secure Element, so the phone being compromised does not change what
// the user approves. A Tangem card has no screen at all, so the ONLY thing the
// user ever sees is the phone — the exact surface a hardware wallet is supposed
// to remove from the trust path. Those two cannot share a confirmation flow,
// and `requireOwnConfirmation` below is how the difference stays enforced
// rather than remembered.
// ---------------------------------------------------------------------------

export type SignerKind =
  | "device-key"
  | "ledger"
  | "trezor"
  | "tangem"
  | "keystone"
  | "onekey"
  | "walletconnect"
  | "mpc";

/** How the user physically proves presence for one signature. */
export type PresenceProof = "biometric" | "button" | "tap" | "scan" | "remote-app";

export interface SignerCapabilities {
  /**
   * The device renders the transaction on its own screen, driven by hardware
   * the phone cannot reach.
   *
   * False for the on-device key (the phone IS the display) and for Tangem
   * (no screen). When false, the app must present the full transaction for
   * confirmation itself — see `requireOwnConfirmation`.
   */
  trustedDisplay: boolean;
  /** Decodes calldata into human-readable fields (ERC-7730) on that display. */
  clearSigning: boolean;
  eip712: boolean;
  eip1559: boolean;
  /**
   * Signs a 32-byte digest rather than a serialized transaction.
   *
   * Tangem works this way: the app hashes and the card signs the hash. It is a
   * meaningfully weaker position — the card cannot inspect what it is signing —
   * and it is recorded here so a caller can refuse it for large amounts.
   */
  prehashedOnly: boolean;
  presence: PresenceProof;
  /** `"all"` for a software key; hardware is limited by its firmware. */
  supportedChainIds: number[] | "all";
}

export interface SignedTransaction {
  /** 0x-hex, ready for eth_sendRawTransaction. */
  raw: string;
  /** The hash this transaction will have on-chain. */
  hash: string;
  /** The address that signed, for the caller to check against its expectation. */
  from: string;
}

export interface AccountSigner {
  readonly kind: SignerKind;
  /** Shown in the UI: "This phone", "Ledger Nano X", "Tangem card". */
  readonly label: string;

  /**
   * The managed link to a physical device, when there is one.
   *
   * OPTIONAL, and deliberately so. The on-device key is always available; a
   * Tangem card has no persistent link (each tap is its own session); a
   * WalletConnect signer has a relayed session rather than a device. Requiring
   * a connection object would make three of those fake a lifecycle they do not
   * have, and a faked "connecting" state is worse than an absent one — the UI
   * would show a spinner for something that never connects.
   *
   * Absent means "nothing to manage", never "unavailable".
   */
  readonly connection?: DeviceConnection;

  capabilities(): SignerCapabilities;

  /**
   * The address this signer controls, or null if unavailable.
   *
   * `displayOnDevice` asks hardware to render the address on its own screen so
   * the user can compare it. Signers without a display ignore it — check
   * `capabilities().trustedDisplay` before promising the user anything.
   */
  getAddress(options?: { displayOnDevice?: boolean }): Promise<string | null>;

  /** Signs, proving presence as `capabilities().presence` describes. */
  signTransaction(tx: Eip1559Transaction): Promise<SignedTransaction>;

  /**
   * EIP-191 `personal_sign`. Returns the 65-byte signature as 0x-hex.
   *
   * OPTIONAL because not every signer can: a digest-only card signs a hash it
   * cannot show, and some hardware firmware has no message path at all. A
   * caller that needs it must check for the method and refuse — never fall
   * back to a different signer, which would sign from an address the user was
   * not looking at. See `signMessageWith`.
   */
  signMessage?(message: string): Promise<string>;

  /**
   * EIP-712 typed data. Returns the 65-byte signature as 0x-hex. Optional for
   * the same reason as signMessage; `capabilities().eip712` says whether the
   * signer can render it.
   */
  signTypedData?(payload: TypedDataPayload): Promise<string>;
}

export interface TypedDataPayload {
  domain: TypedDataDomain;
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Personal-sign through a specific signer, or refuse.
 *
 * WalletConnect used to import signMessage/signTypedData from lib/wallet
 * directly, so the on-device key was the only thing that could ever answer a
 * dApp's message request — adding a hardware signer would have meant rewriting
 * the flow. It now goes through the signer, and a signer without the method is
 * a refusal, not a silent fallback.
 */
export async function signMessageWith(signer: AccountSigner, message: string): Promise<string> {
  if (!signer.signMessage) {
    throw new SignerUnavailable(signer.kind, `${signer.label} cannot sign messages.`);
  }
  return signer.signMessage(message);
}

export async function signTypedDataWith(signer: AccountSigner, payload: TypedDataPayload): Promise<string> {
  if (!signer.signTypedData || !signer.capabilities().eip712) {
    throw new SignerUnavailable(signer.kind, `${signer.label} cannot sign typed data.`);
  }
  return signer.signTypedData(payload);
}

/**
 * Must the APP show a full confirmation before handing this transaction over?
 *
 * True whenever the signer has no trusted display of its own. With a Ledger the
 * device screen is authoritative and an app-side confirmation is a convenience;
 * with a Tangem card or the on-device key there is no second screen, so the
 * app's confirmation is the ONLY thing standing between a user and a payload
 * they never read.
 */
export function requireOwnConfirmation(signer: AccountSigner): boolean {
  return !signer.capabilities().trustedDisplay;
}

/** Can this signer sign for this chain at all? */
export function supportsChain(signer: AccountSigner, chainId: number): boolean {
  const supported = signer.capabilities().supportedChainIds;
  return supported === "all" || supported.includes(chainId);
}

export class SignerUnavailable extends Error {
  readonly kind: SignerKind;
  constructor(kind: SignerKind, message: string) {
    super(message);
    this.name = "SignerUnavailable";
    this.kind = kind;
  }
}
