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
// production guard, the local development signer, and ONE real hardware-backed
// backend — Turnkey (`FURLPAY_KMS_PROVIDER="turnkey"`).
//
// WHY TURNKEY AND NOT AWS KMS FIRST. The Turnkey client already exists in this
// repo (lib/services/turnkey.ts), it signs a raw 32-byte digest with
// HASH_FUNCTION_NO_OP — exactly the shape this interface is built around — and
// it needs no new dependency. Key material lives in Turnkey's enclave and never
// enters this process, which is the property that matters. `aws-kms`,
// `gcp-kms` and `vault` remain declared in KmsBackend and remain unimplemented:
// resolveKms() refuses them by name rather than silently falling back, because
// a backend that quietly degrades to an env key defeats the entire boundary.
//
// THE REMAINING GAP, stated plainly: Turnkey is a custodial signer. It returns
// a COMPLETE signature, so whoever holds the organisation credential can move
// the funds behind any key in the organisation. That is acceptable for a
// gas-paying fee-payer and it is NOT the same thing as a threshold scheme —
// see the note on `isHardwareBacked` below.
//
// THE PRODUCTION GUARD, stated plainly: an environment variable holding a
// private key is acceptable for a local devnet and is not acceptable for
// custody of other people's money. `EnvKeySigner` refuses to construct when the
// financial environment is production, for the same reason the brokerage
// simulator does — a guard the caller owns is a guard somebody forgets.
// ---------------------------------------------------------------------------

import { financialEnvironment } from "@/lib/flags";
import { signDigest, turnkeyConfigured, TurnkeyError } from "@/lib/services/turnkey";

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
 * Turnkey: signing inside a remote enclave, key material never in this process.
 *
 * WHICH ADDRESS SIGNS. `keyId` here is a logical name (see KEY_PURPOSES); the
 * concrete wallet address it maps to comes from the environment, so rotating to
 * a new Turnkey wallet is a config change rather than a deploy. A key with no
 * configured address is `unknown_key` — never a silent fallback to some other
 * wallet, which would sign with the wrong account and be discovered on-chain.
 *
 * `isHardwareBacked` is TRUE because no private key exists in this process:
 * that is the property this interface was built to assert, and it is the one
 * that makes production signing acceptable. It is NOT a claim that the key is
 * split — Turnkey returns a complete signature and can therefore act alone.
 * Read it as "the application cannot leak this key", not as "no single party
 * controls these funds".
 */
export class TurnkeyKmsProvider implements KmsProvider {
  readonly backend = "turnkey" as const;
  readonly isHardwareBacked = true;

  /** Logical key id -> the Turnkey wallet address that serves it. */
  private addressFor(keyId: string): string | undefined {
    const map: Record<string, string | undefined> = {
      "furlpay-gas-sponsor": process.env.TURNKEY_GAS_SPONSOR_ADDRESS,
      "furlpay-settlement": process.env.TURNKEY_SETTLEMENT_ADDRESS,
      "furlpay-attestation": process.env.TURNKEY_ATTESTATION_ADDRESS,
    };
    const address = map[keyId]?.trim();
    return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : undefined;
  }

  async sign(request: SigningRequest): Promise<KmsResult> {
    // Purpose separation is enforced here, at the boundary, not by the caller.
    // A key provisioned to pay gas must not be usable to sign a settlement
    // however the request is shaped.
    if (!purposeAllowed(request.keyId, request.purpose)) {
      return {
        ok: false,
        refusal: {
          reason: "purpose_mismatch",
          detail: `Key "${request.keyId}" may not be used for purpose "${request.purpose}".`,
        },
      };
    }

    const signWith = this.addressFor(request.keyId);
    if (!signWith) {
      return {
        ok: false,
        refusal: {
          reason: "unknown_key",
          detail:
            `No Turnkey wallet address is configured for key "${request.keyId}". ` +
            "Set the matching TURNKEY_*_ADDRESS variable.",
        },
      };
    }

    try {
      const sig = await signDigest({ signWith, digestHex: request.digestHex });
      const r = sig.r.startsWith("0x") ? sig.r.slice(2) : sig.r;
      const s = sig.s.startsWith("0x") ? sig.s.slice(2) : sig.s;
      const v = sig.v.startsWith("0x") ? sig.v.slice(2) : sig.v;
      return {
        ok: true,
        result: {
          // Concatenated (r ‖ s ‖ v), the form every EVM consumer expects.
          signatureHex: `0x${r.padStart(64, "0")}${s.padStart(64, "0")}${v.padStart(2, "0")}`,
          // Turnkey addresses a wallet account, not a versioned key, so the
          // address IS the version identifier: it is what a verifier needs to
          // check an old signature after a rotation.
          keyVersion: signWith,
          backend: this.backend,
          signedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      const detail =
        e instanceof TurnkeyError ? `Turnkey ${e.status}: ${e.message}` : (e as Error).message;
      return { ok: false, refusal: { reason: "backend_error", detail } };
    }
  }

  async listKeyVersions(keyId: string): Promise<string[]> {
    const address = this.addressFor(keyId);
    return address ? [address] : [];
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

  if (configured === "turnkey") {
    // Credentials are checked HERE rather than at first sign(): "configured but
    // unauthenticated" is the state that produces a signing failure in the
    // middle of a settlement, which is the worst possible moment to find out.
    if (!turnkeyConfigured()) {
      return {
        ok: false,
        refusal: {
          reason: "not_configured",
          detail:
            'FURLPAY_KMS_PROVIDER="turnkey" requires TURNKEY_ORGANIZATION_ID, ' +
            "TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY.",
        },
      };
    }
    return { ok: true, provider: new TurnkeyKmsProvider() };
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
