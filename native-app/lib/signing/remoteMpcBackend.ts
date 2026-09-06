import { api, ApiError } from "@/lib/api";
import { SignerUnavailable } from "./types";
import { requireIdentity } from "@/lib/device/registration";
import { describeTransaction, UndescribableTransaction } from "./intentDescription";
import { authenticateDeviceOwner } from "@/lib/biometrics";
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
//
// THE CONTRACT INVERTED (FURL-003). This file used to POST
// `{ signWith, digest, context }` where `context` was documented as advisory:
// the server could not verify that `amountUsd` described the digest, and this
// client sent a hardcoded `amountUsd: 0`. Every agent signature therefore
// passed the spend cap and consumed no budget. The comment justifying it said
// the client-side gate had already checked the real value — which is true and
// beside the point, because the client-side gate is what an attacker replaces.
//
// The server no longer accepts a digest at all. The flow is now three calls:
//
//   PREPARE    the app proposes the transaction it BUILT. The server decodes
//              the calldata itself, proves it means what the proposal claims,
//              simulates it, freezes it, and returns a digest plus a
//              single-use confirmation challenge.
//   AUTHORIZE  the app echoes the digest it DISPLAYED and returns the
//              challenge. The server runs the boundary and mints a
//              short-lived, single-use, device-bound authorization.
//   SIGN       the app presents the authorization. The server re-reads its own
//              stored payload, derives the EIP-1559 signing hash from THAT, and
//              signs it.
//
// The app never says which bytes to sign. And it still verifies the result:
// `MpcSigner` recovers the address from OUR digest, so if the server signed a
// different transaction the recovery fails here rather than on-chain. That
// check is what makes the round trip safe to depend on — the server derives the
// hash independently, and the two derivations must agree.
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
  /**
   * Show the user what they are approving, and return whether they approved.
   *
   * Injected rather than hardcoded so a screen can render the server's own
   * summary — the amount, recipient and warnings the SERVER derived from the
   * calldata, not the ones this file believes. The default below prompts for
   * device-owner authentication with that summary in the prompt text.
   *
   * Returning false is a refusal, and a refusal must leave the authorization
   * unminted. That is why confirmation sits BETWEEN prepare and authorize
   * rather than after: nothing is authorised until the user has agreed.
   */
  confirm?: (summary: TransactionSummary) => Promise<boolean>;
}

/** What the server says this transaction does. Rendered; never re-derived. */
export interface TransactionSummary {
  readonly action: string;
  readonly chain: string;
  readonly assetId: string;
  readonly amountMinor: string;
  readonly destination: string;
  readonly spender: string | null;
  readonly maxFeeWei: string;
  readonly simulation: {
    readonly outcome: "clean" | "warning" | "malicious" | "unavailable";
    readonly summary: string;
    readonly warnings: readonly string[];
  };
}

interface PrepareResponse {
  intentId: string;
  canonicalDigest: string;
  transactionVersion: number;
  expiresAt: number;
  confirmation: { challengeId: string; nonce: string; expiresAt: number };
  summary: TransactionSummary;
}

interface AuthorizeResponse {
  authorizationId: string;
  expiresAt: number;
  transactionVersion: number;
  signing: { challengeId: string; nonce: string };
  warnings: string[];
  integrity: { verdict: string };
}

/**
 * Default confirmation: device-owner authentication with the server's summary.
 *
 * `authenticateDeviceOwner`, not `confirmWithBiometrics`. The latter resolves
 * TRUE when no biometric is enrolled — correct for guarding an action inside an
 * already-unlocked app, and wrong here, where the prompt IS the authorisation
 * for money leaving the wallet. Device-owner auth falls back to the PIN,
 * pattern or passcode, so a phone without a fingerprint still gets a real
 * prompt instead of a silent pass.
 *
 * A screen should override this with something that renders the summary
 * properly. The prompt string is a floor, not the intended experience.
 */
async function defaultConfirm(summary: TransactionSummary): Promise<boolean> {
  const result = await authenticateDeviceOwner(describeForPrompt(summary));
  return result.ok;
}

/** One line a person can check against what they meant to do. */
function describeForPrompt(summary: TransactionSummary): string {
  const short = `${summary.destination.slice(0, 8)}…${summary.destination.slice(-6)}`;
  const verb = summary.action === "approve" ? "Approve spending of" : "Send";
  const base = `${verb} ${summary.amountMinor} ${summary.assetId} to ${short}`;
  // Warnings go in the prompt itself. A warning shown on a screen behind the
  // system biometric dialog is a warning the user is not reading at the moment
  // they decide.
  return summary.simulation.warnings.length > 0
    ? `${base}

⚠ ${summary.simulation.warnings[0]}`
    : base;
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

    // What we believe this transaction does. A wrong answer here cannot
    // produce a wrong signature — the server decodes the same calldata and
    // refuses if the two disagree — so this is a proposal, not a claim to be
    // trusted. `describeTransaction` REFUSES rather than guessing, because a
    // description the app cannot justify from the bytes would still be shown
    // to the user as though it were fact.
    let described;
    try {
      described = describeTransaction(transaction);
    } catch (e) {
      if (e instanceof UndescribableTransaction) {
        throw new MpcSignRefused("undescribable_transaction", e.message);
      }
      throw e;
    }

    const identity = await requireIdentity();

    // ── 1. PREPARE ────────────────────────────────────────────────────────
    // The server canonicalises, decodes the calldata itself, proves it agrees
    // with the description, simulates, freezes it, and returns the digest
    // everything downstream commits to.
    let prepared: PrepareResponse;
    try {
      prepared = await api<PrepareResponse>("/transactions/prepare", {
        method: "POST",
        body: {
          deviceId: identity.deviceId,
          appInstanceId: identity.appInstanceId,
          walletId: this.options.signWith,
          action: described.action,
          chain: described.chain,
          assetId: described.assetId,
          amountMinor: described.amountMinor,
          destination: described.destination,
          ...(described.spender ? { spender: described.spender } : {}),
          payload: {
            chainId: transaction.chainId,
            nonce: Number(transaction.nonce),
            gasLimit: transaction.gasLimit.toString(),
            maxFeePerGas: transaction.maxFeePerGas.toString(),
            maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
            to: transaction.to,
            value: transaction.value.toString(),
            data: transaction.data || "0x",
          },
        },
      });
    } catch (e) {
      throw this.describe(e);
    }

    // ── 2. CONFIRM ────────────────────────────────────────────────────────
    // The user sees the SERVER's summary and approves that. Approving our own
    // rendering of our own description would be the app agreeing with itself.
    const approved = await (this.options.confirm ?? defaultConfirm)(prepared.summary);
    if (!approved) {
      throw new MpcSignRefused("user_declined", "You declined this transaction.");
    }

    // ── 3. AUTHORIZE ──────────────────────────────────────────────────────
    // The digest echoed back is the one we DISPLAYED. It proves nothing on its
    // own — we could echo anything — but it catches the case where the screen
    // and the proposal disagreed, which is a UI bug far more often than an
    // attack and must block either way.
    let authorized: AuthorizeResponse;
    try {
      authorized = await api<AuthorizeResponse>("/transactions/authorize", {
        method: "POST",
        body: {
          intentId: prepared.intentId,
          deviceId: identity.deviceId,
          appInstanceId: identity.appInstanceId,
          displayedDigest: prepared.canonicalDigest,
          challengeId: prepared.confirmation.challengeId,
          challengeNonce: prepared.confirmation.nonce,
          confirmation: { method: "device_owner" },
          // No `integrity` block. Play Integrity is not wired into this app
          // yet, and sending a fabricated token would be worse than sending
          // none: the server treats a MISSING attestation as a weighted risk
          // signal and a MISMATCHED one as proof of tampering. Absent is the
          // honest state, and it is a state the boundary supports.
        },
      });
    } catch (e) {
      throw this.describe(e);
    }

    // ── 4. SIGN ───────────────────────────────────────────────────────────
    // No digest is sent. The server re-reads its own stored payload, derives
    // the EIP-1559 signing hash from THAT, and signs it.
    let response: { r: string; s: string; v: string };
    try {
      response = await api<{ r: string; s: string; v: string }>("/mpc/sign", {
        method: "POST",
        body: {
          signWith: this.options.signWith,
          authorizationId: authorized.authorizationId,
          intentId: prepared.intentId,
          deviceId: identity.deviceId,
          appInstanceId: identity.appInstanceId,
          challengeId: authorized.signing.challengeId,
          challengeNonce: authorized.signing.nonce,
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
    // MpcSigner verifies this recovers to the expected address over OUR digest.
    // That check is what makes the round trip safe to depend on: the server
    // derived the same hash independently, and if it signed anything else the
    // recovery fails here rather than on-chain.
    return signature;
  }

  private describe(e: unknown): Error {
    if (e instanceof ApiError) {
      const data = e.data as { error?: string; detail?: string; reasons?: string[] } | null;

      if (e.status === 409) {
        // The two retryable states, and the only ones the server names: an
        // authorization that aged out, and a proposal that moved or was already
        // signed. Both mean "start the transaction again", which is something
        // the app can actually do.
        return new MpcSignRefused(
          data?.error ?? "authorization_expired",
          data?.detail ?? "That took too long. Start the transaction again."
        );
      }
      if (e.status === 400 && data?.error === "proposal_refused") {
        // The server decoded the calldata and it did not agree with what this
        // app said the transaction does. That is a client bug, not a policy
        // refusal, and the reasons are safe to surface because the caller
        // supplied every value involved.
        return new MpcSignRefused(
          data.reasons?.[0] ?? "proposal_refused",
          "This transaction could not be prepared. It did not match what the app described."
        );
      }
      if (e.status === 403) {
        // A policy refusal is final: the same request will be refused again.
        //
        // The reason is read from `detail` first and `error` second. The agent
        // spend policy puts its machine-readable code in `detail`; the device
        // and boundary refusals put a human sentence there and the code in
        // `error`. Reading only one field silently lost half of them to the
        // generic fallback.
        const reason = data?.detail ?? data?.error ?? "policy_denied";
        const known = policyMessage(reason);
        return new MpcSignRefused(reason, known ?? policyMessage(data?.error ?? "") ?? GENERIC_REFUSAL);
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

/** Shown when the server refused for a reason this app has no wording for. */
const GENERIC_REFUSAL = "That signature was refused by policy.";

/**
 * Policy reasons, in language a person can act on.
 *
 * Returns null for an unrecognised code rather than a generic string, so the
 * caller can try the OTHER field before giving up. Collapsing to a generic
 * message here would have made "this device isn't authorised" — which has a
 * concrete fix — indistinguishable from a spend-limit refusal, which does not.
 */
function policyMessage(reason: string): string | null {
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
    case "asset_not_priceable":
      // The server refused to price the spend against the agent budget rather
      // than defaulting it to zero. Say what happened, not "try again".
      return "This asset can't be priced against the key's budget, so nothing was signed.";
    case "device_not_authorized":
      return "This device isn't authorised to sign. Set it up again in Settings.";
    default:
      return null;
  }
}

const pad64 = (v: string) => v.replace(/^0x/, "").padStart(64, "0");
const pad2 = (v: string) => v.replace(/^0x/, "").padStart(2, "0");
