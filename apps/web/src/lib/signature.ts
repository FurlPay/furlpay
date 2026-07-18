// Transaction signature validation for outbound transfers.
//
// Real cryptographic path (viem): the signer is recovered from an EIP-191
// personal_sign signature over the canonical transfer message and asserted to
// be one of the Safe's registered owner keys. In live/production mode this is
// the ONLY way a transfer authorizes — no owners registered means fail closed,
// never fall through to shape checks (a `return { ok: true }` here would let
// any well-formed hex blob move money; cf. x402Signature.ts which enforces the
// same invariant for the x402 rail's EIP-3009 authorizations).
//
// Demo path: the passkey-based signing client is not built yet — the web UI
// posts a random 65-byte blob (see ScanToPay's mockSignature) and the transfer
// route itself is 503'd in production. In mock mode with no registered owners,
// shape validation alone passes so the demo flow keeps working.

import { recoverMessageAddress, type Hex } from "viem";
import { isLive } from "@/lib/integrations";

const SIG_RE = /^0x[0-9a-fA-F]{130}$/; // 65-byte ECDSA signature (r,s,v)

export interface TransferPayload {
  destination: string;
  amount: number;
  token: string;
  chain: string;
}

export function isValidSignatureShape(signature: unknown): signature is string {
  return typeof signature === "string" && SIG_RE.test(signature);
}

/**
 * Canonical EIP-191 message a Safe owner signs to authorize one transfer.
 * Versioned and newline-delimited so it can never collide with another
 * FurlPay signing context; the client-side signer MUST build the identical
 * string or recovery will (correctly) reject.
 */
export function transferAuthorizationMessage(safeAddress: string, p: TransferPayload): string {
  return [
    "FurlPay transfer authorization v1",
    `safe:${safeAddress.toLowerCase()}`,
    `destination:${p.destination}`,
    `amount:${p.amount}`,
    `token:${p.token}`,
    `chain:${p.chain}`,
  ].join("\n");
}

/**
 * Verify the signature authorizes this exact payload for the given Safe.
 * `owners` are the Safe's registered signer EOAs; when present, the signature
 * must recover to one of them. Returns { ok, reason }.
 */
export async function verifyTransferSignature(
  signature: string,
  safeAddress: string,
  payload: TransferPayload,
  owners: string[] = []
): Promise<{ ok: boolean; reason?: string }> {
  if (!isValidSignatureShape(signature)) {
    return { ok: false, reason: "Malformed signature (expected 0x + 130 hex chars)" };
  }
  if (!safeAddress) {
    return { ok: false, reason: "Missing safeAddress for signer verification" };
  }
  if (!payload.destination || !(payload.amount > 0)) {
    return { ok: false, reason: "Signature does not cover a valid payload" };
  }

  if (owners.length > 0) {
    // Real path: recover the EIP-191 signer and require Safe-owner membership.
    try {
      const recovered = await recoverMessageAddress({
        message: transferAuthorizationMessage(safeAddress, payload),
        signature: signature as Hex,
      });
      const match = owners.some((o) => o.toLowerCase() === recovered.toLowerCase());
      return match
        ? { ok: true }
        : { ok: false, reason: "Signature does not recover to a registered Safe owner" };
    } catch {
      return { ok: false, reason: "Signature recovery failed" };
    }
  }

  // No registered owner keys. Live mode fails closed — an unverifiable
  // authorization must never move money. Mock/demo mode accepts the
  // shape-validated blob so the demo transfer flow stays usable.
  if (isLive() || process.env.NODE_ENV === "production") {
    return { ok: false, reason: "No registered owner key for this Safe — cannot verify authorization" };
  }
  return { ok: true };
}
