// ---------------------------------------------------------------------------
// Integration seam: GoogleMpcSigner replaces the mock in @furlpay/security.
//
// This class provides the same PartialSignature / MpcSignResult interface
// that packages/security/src/mpc.ts exports, but backs it with the real
// Google Cloud MPC v1beta client when configured. When MPC credentials are
// not available (development, CI), it falls back to the existing HMAC mock
// from @furlpay/security — clearly labeled and refusing to run in production.
//
// The seam pattern lets the rest of the codebase call `signer.sign(...)` and
// get correct behavior in both environments, with zero code changes at each
// call site when FurlPay transitions from mock to real MPC.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { GoogleMpcClient } from "./client.js";
import type {
  GoogleMpcConfig,
  PartialSignature,
  PolicyDecisionLike,
  MpcSignResult,
  SignResult,
  TransactionMetadata,
} from "./types.js";

// ── Configuration from environment ──────────────────────────────────────────

/** Read Google MPC configuration from environment variables. */
export function configFromEnv(): GoogleMpcConfig | null {
  const projectId = process.env.GOOGLE_MPC_PROJECT_ID;
  const location = process.env.GOOGLE_MPC_LOCATION;
  if (!projectId || !location) return null;

  const saKeyJson = process.env.GOOGLE_MPC_SERVICE_ACCOUNT_KEY;
  const accessToken = process.env.GOOGLE_MPC_ACCESS_TOKEN;

  return {
    projectId,
    location,
    serviceAccountKey: saKeyJson ? JSON.parse(saKeyJson) : undefined,
    accessToken: accessToken || undefined,
    baseUrl: process.env.GOOGLE_MPC_BASE_URL || undefined,
  };
}

// ── Mock (development only) ─────────────────────────────────────────────────

function refuseInProduction(fn: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `@furlpay/google-mpc ${fn} is a mock signing model and is disabled in production. ` +
      `Set GOOGLE_MPC_PROJECT_ID and GOOGLE_MPC_LOCATION to use real MPC.`
    );
  }
}

function mockPartialSign(payloadHash: string, shareLabel: string): PartialSignature {
  const value = crypto.createHmac("sha256", `mock:${shareLabel}`).update(payloadHash).digest("hex");
  return { share: shareLabel as PartialSignature["share"], value };
}

function mockCombine(partials: PartialSignature[]): string {
  const combined = partials.map((p) => p.value).join("+");
  return "0x" + crypto.createHash("sha256").update(combined).digest("hex").padEnd(130, "0").slice(0, 130);
}

// ── Signer ──────────────────────────────────────────────────────────────────

export interface GoogleMpcSignerConfig {
  /** Key circle resource name for signing operations. */
  keyCircle?: string;
  /** Google MPC client configuration. Null = use mock. */
  mpcConfig?: GoogleMpcConfig | null;
}

/**
 * Drop-in replacement for the mock MPC signer in `@furlpay/security`.
 *
 * When `GOOGLE_MPC_PROJECT_ID` and `GOOGLE_MPC_LOCATION` are set, uses the
 * real Google Cloud MPC v1beta API. Otherwise falls back to a clearly-labeled
 * mock that refuses to run in production.
 *
 * Usage:
 * ```typescript
 * const signer = GoogleMpcSigner.fromEnv();
 *
 * // The interface is the same whether mock or real:
 * const result = await signer.sign(payloadHash, {
 *   chain: "solana",
 *   to: "...",
 *   value: "...",
 * });
 * ```
 */
export class GoogleMpcSigner {
  private readonly client: GoogleMpcClient | null;
  private readonly keyCircle: string;
  private readonly isReal: boolean;

  constructor(config: GoogleMpcSignerConfig = {}) {
    const mpcConfig = config.mpcConfig ?? configFromEnv();
    this.keyCircle = config.keyCircle ?? process.env.GOOGLE_MPC_KEY_CIRCLE ?? "";

    if (mpcConfig) {
      this.client = new GoogleMpcClient(mpcConfig);
      this.isReal = true;
    } else {
      this.client = null;
      this.isReal = false;
    }
  }

  /** Create a signer from environment variables. */
  static fromEnv(): GoogleMpcSigner {
    return new GoogleMpcSigner();
  }

  /** Whether this signer is using the real Google Cloud MPC API. */
  get usingRealMpc(): boolean {
    return this.isReal;
  }

  /**
   * Sign a payload hash using 2-of-3 threshold MPC.
   *
   * Real mode: submits a signing request to Google Cloud MPC, which evaluates
   * Cedar transaction policies and produces a threshold signature if permitted.
   *
   * Mock mode: produces an HMAC-based fake signature that looks structurally
   * correct but is cryptographically meaningless. Refuses in production.
   *
   * @param payloadHash - Hex-encoded hash to sign.
   * @param metadata    - Transaction metadata for the policy engine.
   * @param policy      - Off-chain policy decision (from FurlPay's risk engine).
   * @returns The combined MPC signature result.
   */
  async sign(
    payloadHash: string,
    metadata?: TransactionMetadata,
    policy?: PolicyDecisionLike
  ): Promise<MpcSignResult> {
    // Off-chain policy gate: FurlPay's risk engine must approve before we even
    // ask the MPC service. This is defense-in-depth — the MPC service has its
    // own Cedar policies, but the risk engine catches application-level fraud
    // signals that the MPC layer can't see.
    if (policy && !policy.approved) {
      throw new Error(
        `MPC signing refused by off-chain policy: ${policy.reasons?.[0] ?? "not approved"}`
      );
    }

    if (this.isReal && this.client) {
      return this.signReal(payloadHash, metadata);
    }
    return this.signMock(payloadHash);
  }

  /** Real MPC signing via Google Cloud MPC v1beta API. */
  private async signReal(
    payloadHash: string,
    metadata?: TransactionMetadata
  ): Promise<MpcSignResult> {
    if (!this.keyCircle) {
      throw new Error(
        "GoogleMpcSigner: keyCircle not configured. Set GOOGLE_MPC_KEY_CIRCLE."
      );
    }

    const result: SignResult = await this.client!.sign({
      keyCircleName: this.keyCircle,
      payload: payloadHash,
      payloadType: "TRANSACTION_HASH",
      chain: metadata?.chain,
      transactionMetadata: metadata,
    });

    // If the operation is async, poll until completion
    if (result.state !== "COMPLETED") {
      const final = await this.client!.waitForSignature(result.operationName);
      return {
        signature: final.signature!,
        cosigned: true,
        shares: ["A", "B"], // Google + FurlPay shares (2-of-3)
      };
    }

    return {
      signature: result.signature!,
      cosigned: true,
      shares: ["A", "B"],
    };
  }

  /** Mock MPC signing for development (refuses in production). */
  private signMock(payloadHash: string): MpcSignResult {
    refuseInProduction("sign");

    const partialA = mockPartialSign(payloadHash, "A");
    const partialB = mockPartialSign(payloadHash, "B");
    const signature = mockCombine([partialA, partialB]);

    return {
      signature,
      cosigned: true,
      shares: ["A", "B"],
    };
  }
}
