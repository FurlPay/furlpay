import { api, ApiError } from "@/lib/api";
import { bytesToHex } from "@/lib/evm/rlp";
import { SignerUnavailable } from "./types";
import {
  parseCompactSignature,
  type MpcBackend,
  type MpcSignRequest,
  type MpcSignature,
} from "./mpcSigner";

// ---------------------------------------------------------------------------
// The MpcBackend that talks to our own server, which talks to Turnkey.
//
// WHY THE INDIRECTION. A Turnkey API key can request a signature from any
// wallet in the organisation. Shipping it in an APK publishes it — the same
// reasoning that put RPC URLs behind /api/chain/rpc rather than in a chain
// table on the phone. The app therefore holds no MPC credential at all; it
// holds a session, and the server decides whether to co-sign.
//
// WHAT THE APP STILL OWNS, and must: the transaction, the digest, and the
// verification that the returned signature recovers to the expected address.
// Those stay on the device precisely because the server is the other party to
// the split — a check performed by the thing being checked proves nothing.
// ---------------------------------------------------------------------------

export interface RemoteMpcOptions {
  /** Wallet account the server should sign with. */
  signWith: string;
  /** Human label — "Turnkey", or whatever the deployment is using. */
  label?: string;
  /**
   * Agent key driving these signatures, when one is.
   *
   * Present means the server applies that agent's spend policy — per-tx limit,
   * daily budget, category allowlist. Absent means the account owner is acting
   * directly and only their own session gates it.
   */
  agentKeyId?: string;
  /** Spend category, for policy and the audit trail. */
  category?: "escrow" | "travel" | "transfer" | "x402" | "commerce";
}

/** Raised when the server refused on policy grounds. Not retryable. */
export class MpcSignRefused extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "MpcSignRefused";
    this.reason = reason;
  }
}

export class RemoteMpcBackend implements MpcBackend {
  readonly label: string;

  constructor(private readonly options: RemoteMpcOptions) {
    this.label = options.label ?? "Cloud key";
  }

  async getAddress(): Promise<string | null> {
    // The address is configuration, not a secret, and is known without a round
    // trip — a null here would make the signer look unavailable when it is not.
    return this.options.signWith;
  }

  async requestSignature(request: MpcSignRequest): Promise<MpcSignature> {
    const { transaction } = request;

    let response: { r: string; s: string; v: string };
    try {
      response = await api<{ r: string; s: string; v: string }>("/mpc/sign", {
        method: "POST",
        body: {
          signWith: this.options.signWith,
          digest: bytesToHex(request.digest),
          context: {
            chainId: transaction.chainId,
            to: transaction.to,
            // Advisory only — priced for policy and audit. The digest is what
            // actually gets signed, and the server cannot verify these describe
            // it. Sending a smaller number here buys nothing: the client-side
            // gate in MpcSigner already checked the real value, and the
            // signature is still verified against our own transaction.
            amountUsd: 0,
            category: this.options.category ?? "transfer",
          },
          ...(this.options.agentKeyId ? { agentKeyId: this.options.agentKeyId } : {}),
        },
      });
    } catch (e) {
      throw this.describe(e);
    }

    // Turnkey returns v as "00"/"01" or "1b"/"1c" depending on key type;
    // parseCompactSignature normalises both to EIP-1559 parity.
    const signature = parseCompactSignature(
      "0x" + pad64(response.r) + pad64(response.s) + pad2(response.v)
    );
    if (!signature) {
      throw new SignerUnavailable("mpc", `${this.label} returned a malformed signature.`);
    }
    return signature;
  }

  private describe(e: unknown): Error {
    if (e instanceof ApiError) {
      const data = e.data as { error?: string; detail?: string } | null;

      if (e.status === 403) {
        // A policy refusal is final: the same request will be refused again.
        return new MpcSignRefused(
          data?.detail ?? "policy_denied",
          policyMessage(data?.detail ?? "policy_denied")
        );
      }
      if (e.status === 202) {
        return new MpcSignRefused(
          "awaiting_approval",
          "This needs another approval before it can be signed."
        );
      }
      if (e.status === 503) {
        return new SignerUnavailable("mpc", "Cloud signing isn't available right now.");
      }
      return new SignerUnavailable("mpc", data?.detail ?? e.message);
    }
    return new SignerUnavailable("mpc", "Couldn't reach the signing service.");
  }
}

/** Policy reasons, in language a person can act on. */
function policyMessage(reason: string): string {
  switch (reason) {
    case "per_tx_limit_exceeded":
      return "That's above this key's per-transaction limit.";
    case "daily_budget_exceeded":
      return "This key has reached its daily budget.";
    case "category_not_allowed":
      return "This key isn't allowed to spend on that.";
    case "key_revoked":
      return "This key has been revoked.";
    case "key_expired":
      return "This key has expired.";
    case "key_not_owned":
      return "That key belongs to a different account.";
    case "budget_counter_unavailable":
      // Fails closed by design — say so rather than implying a limit was hit.
      return "Spending checks are unavailable, so nothing was signed. Try again shortly.";
    default:
      return "That signature was refused by policy.";
  }
}

const pad64 = (v: string) => v.replace(/^0x/, "").padStart(64, "0");
const pad2 = (v: string) => v.replace(/^0x/, "").padStart(2, "0");
