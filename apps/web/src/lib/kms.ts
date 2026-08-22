// ---------------------------------------------------------------------------
// Key management — the signing boundary.
//
// THE POINT OF THIS FILE is that application code asks for a SIGNATURE and
// never for a KEY. Once a private key is a value in a variable, it is in a heap
// dump, a log line, an error report and any `JSON.stringify` that happens to
// reach it. Behind this interface the key material need never enter the process
// at all — a KMS or HSM performs the signing operation and returns only the
// result.
//
// WHAT IS IMPLEMENTED HERE: the interface, the provider selection, the
// production guard, and the local development signer.
//
// WHAT IS NOT: an actual KMS backend. There is no AWS KMS or Vault integration
// in this repo, and writing one that "works" against an unconfigured service
// would be worse than none — it would look complete. `resolveKms()` therefore
// returns a REFUSAL in production rather than a signer, and
// ONCHAIN_SETTLEMENT_LIVE stays gated on `FURLPAY_KMS_PROVIDER` naming a
// backend that exists. Adding one means implementing `KmsProvider` and
// registering it below; nothing else changes.
//
// THE PRODUCTION GUARD, stated plainly: an environment variable holding a
// private key is acceptable for a local devnet and is not acceptable for
// custody of other people's money. `EnvKeySigner` refuses to construct when the
// financial environment is production, for the same reason the brokerage
// simulator does — a guard the caller owns is a guard somebody forgets.
// ---------------------------------------------------------------------------

import { financialEnvironment } from "@/lib/flags";

export type KmsBackend = "env" | "aws-kms" | "gcp-kms" | "vault" | "turnkey";

/** What a key is allowed to be used for. A key that can do anything is a key
 *  whose blast radius is everything. */
export type KeyPurpose = "gas-sponsor" | "settlement" | "attestation";

export interface SigningRequest {
  /** Logical key name, never the material. */
  keyId: string;
  purpose: KeyPurpose;
  /** 32-byte digest to sign, hex. Signing a DIGEST rather than a message keeps
   *  this interface free of any opinion about the payload's encoding. */
  digestHex: string;
  /** Correlates the signature with the operation that requested it in the
   *  audit log. A signature with no recorded reason cannot be investigated. */
  reason: string;
}

export interface SigningResult {
  signatureHex: string;
  /** Which key version signed. Rotation makes this necessary: verifying an old
   *  signature needs the key that produced it. */
  keyVersion: string;
  backend: KmsBackend;
  signedAt: string;
}

export type KmsRefusal =
  | { reason: "not_configured"; detail: string }
  | { reason: "unavailable_in_production"; detail: string }
  | { reason: "unknown_key"; detail: string }
  | { reason: "purpose_mismatch"; detail: string }
  | { reason: "backend_error"; detail: string };

export type KmsResult = { ok: true; result: SigningResult } | { ok: false; refusal: KmsRefusal };

export interface KmsProvider {
  readonly backend: KmsBackend;
  /** False for any backend where key material exists in this process. */
  readonly isHardwareBacked: boolean;
  sign(request: SigningRequest): Promise<KmsResult>;
  /** Which key versions exist, newest first. Never returns material. */
  listKeyVersions(keyId: string): Promise<string[]>;
}

/**
 * Development signer: keys from environment variables.
 *
 * Refuses to exist in production. The refusal is in the constructor so it
 * cannot be reached by any path, including one written later by someone who has
 * not read this comment.
 */
export class EnvKeySigner implements KmsProvider {
  readonly backend = "env" as const;
  readonly isHardwareBacked = false;

  constructor() {
    if (financialEnvironment() === "production") {
      throw new Error(
        "EnvKeySigner cannot be used in production. A private key in an environment variable is " +
          "readable from a heap dump, a crash report and any accidental serialisation. Configure " +
          "FURLPAY_KMS_PROVIDER with a real key-management backend, or leave on-chain settlement disabled."
      );
    }
  }

  async sign(request: SigningRequest): Promise<KmsResult> {
    // Deliberately NOT implemented, even in development.
    //
    // A working env-key signer here would be the path of least resistance for
    // every future caller, and the production guard above is only one edit away
    // from being removed by someone who needs it to work. There is no signing
    // backend in this repo yet; the honest state is a refusal that names what
    // is missing.
    return {
      ok: false,
      refusal: {
        reason: "not_configured",
        detail:
          `No signing backend is implemented for key "${request.keyId}". ` +
          "The KMS interface exists; a provider does not. On-chain settlement stays disabled.",
      },
    };
  }

  async listKeyVersions(): Promise<string[]> {
    return [];
  }
}

/**
 * The configured provider, or a refusal explaining why there is none.
 *
 * Returns a REFUSAL rather than throwing, so a caller can report the reason to
 * an operator instead of turning a configuration gap into a stack trace.
 */
export function resolveKms(): { ok: true; provider: KmsProvider } | { ok: false; refusal: KmsRefusal } {
  const configured = (process.env.FURLPAY_KMS_PROVIDER ?? "").trim().toLowerCase();
  const environment = financialEnvironment();

  if (!configured) {
    return {
      ok: false,
      refusal: {
        reason: "not_configured",
        detail: "FURLPAY_KMS_PROVIDER is not set. No signing backend is available.",
      },
    };
  }

  if (configured === "env") {
    if (environment === "production") {
      return {
        ok: false,
        refusal: {
          reason: "unavailable_in_production",
          detail:
            'FURLPAY_KMS_PROVIDER="env" is a development setting. Production signing requires a ' +
            "key-management backend that keeps key material out of the application process.",
        },
      };
    }
    return { ok: true, provider: new EnvKeySigner() };
  }

  // A named backend with no implementation. Saying so is the correct answer;
  // silently falling back to the env signer would defeat the entire boundary.
  return {
    ok: false,
    refusal: {
      reason: "not_configured",
      detail:
        `FURLPAY_KMS_PROVIDER="${configured}" names a backend that is not implemented in this codebase. ` +
        "Implement KmsProvider for it and register it in lib/kms.ts.",
    },
  };
}

/** Is a signing backend available that is fit for production custody? */
export function productionSigningAvailable(): boolean {
  const resolved = resolveKms();
  return resolved.ok && resolved.provider.isHardwareBacked;
}

/**
 * Which purposes a key id may serve.
 *
 * Enforced at the boundary so a key provisioned to pay gas cannot be used to
 * sign a settlement, whatever a caller passes. The separation is the point: one
 * compromised key should not be able to do everything.
 */
export const KEY_PURPOSES: Record<string, KeyPurpose[]> = {
  "furlpay-gas-sponsor": ["gas-sponsor"],
  "furlpay-settlement": ["settlement"],
  "furlpay-attestation": ["attestation"],
};

export function purposeAllowed(keyId: string, purpose: KeyPurpose): boolean {
  return (KEY_PURPOSES[keyId] ?? []).includes(purpose);
}
