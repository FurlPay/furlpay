// Transaction signature validation for outbound transfers.
// In production this recovers the signer from an EIP-1271 / ERC-4337 userOp
// signature and asserts it is an owner of the Safe. Here we validate the
// signature is a well-formed ECDSA hex blob and (mock) bind it to the payload.

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
 * Verify the signature authorizes this exact payload for the given Safe.
 * Returns { ok, reason }. Mocked recovery, real-shaped contract.
 */
export function verifyTransferSignature(
  signature: string,
  safeAddress: string,
  payload: TransferPayload
): { ok: boolean; reason?: string } {
  if (!isValidSignatureShape(signature)) {
    return { ok: false, reason: "Malformed signature (expected 0x + 130 hex chars)" };
  }
  if (!safeAddress) {
    return { ok: false, reason: "Missing safeAddress for signer verification" };
  }
  if (!payload.destination || !(payload.amount > 0)) {
    return { ok: false, reason: "Signature does not cover a valid payload" };
  }
  // Mock: real impl = ecrecover(hash(payload)) ∈ safe.owners.
  return { ok: true };
}
