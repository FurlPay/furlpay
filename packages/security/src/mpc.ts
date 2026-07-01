import crypto from "crypto";

// ---------------------------------------------------------------------------
// 2-of-2 MPC signing model (Turnkey / Fireblocks WaaS seam).
//   Key Share A: client-side, bound to the user's passkey / device enclave.
//   Key Share B: server-side, in Furlpay's HSM.
// The full private key is never assembled. Critically, the SERVER share refuses
// to co-sign unless the off-chain policy gate passed — so a client-side exploit
// cannot move funds on its own (the anti-Gnosis-Pay lesson).
// MOCK: models the collaborative signature; real impl calls the MPC provider.
// ---------------------------------------------------------------------------

export interface PartialSignature {
  share: "A" | "B";
  value: string;
}

export interface PolicyDecisionLike {
  approved: boolean;
  reasons?: string[];
}

export interface MpcSignResult {
  signature: string;
  cosigned: true;
  shares: ["A", "B"];
}

/** Client produces its partial signature from the passkey-bound share. */
export function clientPartialSign(payloadHash: string, passkeyProof: string): PartialSignature {
  const value = crypto.createHmac("sha256", "shareA:" + passkeyProof).update(payloadHash).digest("hex");
  return { share: "A", value };
}

/**
 * Server co-signs with Key Share B ONLY if the off-chain policy passed.
 * Throws otherwise — the server share is the last line of defense.
 */
export function serverCoSign(
  payloadHash: string,
  clientPartial: PartialSignature,
  policy: PolicyDecisionLike
): MpcSignResult {
  if (!policy.approved) {
    throw new Error(`MPC co-sign refused by policy engine: ${policy.reasons?.[0] ?? "not approved"}`);
  }
  if (clientPartial.share !== "A" || !clientPartial.value) {
    throw new Error("Invalid client partial signature (Key Share A)");
  }
  const partialB = crypto.createHmac("sha256", "shareB:hsm").update(payloadHash).digest("hex");
  // Combine partials into a full signature (mock aggregation).
  const signature =
    "0x" +
    crypto.createHash("sha256").update(clientPartial.value + partialB).digest("hex").padEnd(130, "0").slice(0, 130);
  return { signature, cosigned: true, shares: ["A", "B"] };
}
