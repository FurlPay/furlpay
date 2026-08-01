import type { AccountSigner, SignerKind } from "./types";
import { deviceKeySigner } from "./deviceKeySigner";

// ---------------------------------------------------------------------------
// Signer registry.
//
// Domain code (the swap engine, send, approvals) resolves a signer from here
// and never imports a vendor SDK. Adding Ledger means writing one class that
// satisfies `AccountSigner` and calling `register()` at startup — no change to
// executeSwap, no change to the UI's transaction flow, no `if (isLedger)`
// anywhere.
//
// WHY REGISTRATION IS EXPLICIT AND NOT A STATIC IMPORT LIST. Every hardware
// SDK pulls in native modules (BLE, NFC, USB). A static import would drag
// react-native-ble-plx into the bundle for a user who signs with the on-device
// key and owns no hardware — and would break the Jest suite, which has no
// native runtime at all. Registration at app start keeps the cost with the
// feature that needs it.
// ---------------------------------------------------------------------------

const signers = new Map<SignerKind, AccountSigner>();

/** The on-device key is always present — it needs no hardware and no plugin. */
signers.set(deviceKeySigner.kind, deviceKeySigner);

export function registerSigner(signer: AccountSigner): void {
  signers.set(signer.kind, signer);
}

export function unregisterSigner(kind: SignerKind): void {
  if (kind === "device-key") {
    // Removing it would leave a user with hardware unpaired and no way to sign
    // anything at all, including the transaction that re-pairs it.
    throw new Error("The on-device signer cannot be unregistered.");
  }
  signers.delete(kind);
}

export function getSigner(kind: SignerKind): AccountSigner | undefined {
  return signers.get(kind);
}

export function listSigners(): AccountSigner[] {
  return Array.from(signers.values());
}

/**
 * The signer to use when the caller did not name one.
 *
 * Deliberately the on-device key rather than "the most secure available".
 * Silently routing a transaction to whichever hardware wallet happens to be
 * paired would sign from an address the user was not looking at — the account
 * is chosen by the user, and the signer follows the account, never the reverse.
 */
export function defaultSigner(): AccountSigner {
  return deviceKeySigner;
}

/** Test helper — drops every plugin, keeping the on-device signer. */
export function resetSigners(): void {
  for (const kind of Array.from(signers.keys())) {
    if (kind !== "device-key") signers.delete(kind);
  }
}
