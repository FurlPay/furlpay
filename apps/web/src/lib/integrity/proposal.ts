import { randomUUID, randomBytes } from "crypto";
import { kvGet, kvSet } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { intentDigest, type CanonicalIntent } from "./canonical";
import {
  chainPayloadDigest,
  verifyPayloadMatchesIntent,
  normaliseChainPayload,
  type EvmChainPayload,
  type PayloadRefusal,
} from "./evmPayload";
import type { SimulationResult, UserConfirmation } from "./boundary";

// ---------------------------------------------------------------------------
// The server's own copy of a transaction, from proposal to signature.
//
// WHY A STORED RECORD AND NOT A REQUEST PARAMETER. The whole boundary rests on
// the server holding the intent. Every alternative reduces to the client
// re-describing the transaction at each step, and a description the client
// repeats is a description the client can change. So the flow is:
//
//   1. PREPARE   client proposes; server canonicalises, verifies the calldata
//                actually means what the intent says, simulates, and STORES
//                the result. Returns a digest and a summary to display.
//   2. AUTHORIZE client returns the digest it displayed, plus the user's
//                confirmation and whatever integrity evidence the platform
//                produced. Server checks the echoed digest against its own
//                copy and mints an authorization.
//   3. SIGN      client presents the authorization. Server re-reads the stored
//                payload, derives the chain signing hash from it, signs THAT.
//
// The client never supplies bytes to be signed at any step. It supplies a
// proposal once, and thereafter it can only point at what the server stored.
//
// VERSIONING IS THE TOCTOU GUARD. `version` increments on every mutation of
// this record. An authorization freezes the version it was minted under, so a
// proposal edited after the security cycle ran cannot be signed — it must go
// through a new cycle. `version` is deliberately not a timestamp: two edits in
// the same millisecond must be distinguishable.
//
// THE ECHOED DIGEST IS NOT A SECURITY CHECK BY ITSELF. A client that wanted to
// lie could echo whatever the server sent. It is a CONSISTENCY check: it
// catches a client that rendered one transaction and confirmed another, which
// is a UI bug far more often than an attack, and both must block.
// ---------------------------------------------------------------------------

/** How long a prepared proposal survives unconfirmed. Longer than the
 *  authorization TTL because a user reading a confirmation screen is slow. */
export const PROPOSAL_TTL_MS = 10 * 60_000;

const PROPOSAL_KEY = (id: string) => `tx:proposal:${id}`;

export type ProposalStatus =
  /** Prepared and simulated. Nothing authorised yet. */
  | "prepared"
  /** User confirmed and an authorization has been minted. */
  | "authorized"
  /** A signature was produced against it. Terminal for signing purposes. */
  | "signed"
  /** Refused, cancelled or expired. Terminal. */
  | "void";

export interface TransactionProposal {
  readonly intentId: string;
  readonly userId: string;
  readonly walletId: string;
  readonly deviceId: string;
  readonly appInstanceId: string;
  /** The canonicalised intent. The signer signs what THIS describes. */
  readonly intent: CanonicalIntent;
  /** The exact transaction bytes, frozen at prepare time. */
  readonly payload: EvmChainPayload;
  readonly canonicalDigest: string;
  readonly simulation: SimulationResult | null;
  readonly confirmation: UserConfirmation | null;
  readonly status: ProposalStatus;
  /** Increments on every mutation. Frozen into the authorization. */
  readonly version: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type PrepareRefusal = PayloadRefusal | "intent_invalid" | "proposal_expired";

export interface PrepareResult {
  readonly ok: boolean;
  readonly proposal?: TransactionProposal;
  readonly refusals: readonly PrepareRefusal[];
}

export interface PrepareInput {
  readonly userId: string;
  readonly walletId: string;
  readonly deviceId: string;
  readonly appInstanceId: string;
  readonly action: CanonicalIntent["action"];
  readonly chain: string;
  readonly assetId: string;
  readonly amountMinor: string;
  readonly destination: string;
  readonly spender?: string;
  readonly payload: EvmChainPayload;
  /** How long the intent itself stays signable. */
  readonly validForMs?: number;
}

/**
 * Canonicalise, verify and store a proposal.
 *
 * The order here is the point. The payload digest is folded into the intent
 * BEFORE the intent digest is taken, so the digest that every later control
 * commits to covers the actual transaction bytes — not a summary of them. Then
 * the calldata is decoded and compared to the intent, because a digest proves
 * the bytes did not change and says nothing about what they mean.
 */
export async function prepareProposal(
  input: PrepareInput,
  now: number = Date.now()
): Promise<PrepareResult> {
  let payload: EvmChainPayload;
  try {
    payload = normaliseChainPayload(input.payload);
  } catch {
    return { ok: false, refusals: ["intent_invalid"] };
  }

  const validFor = input.validForMs ?? PROPOSAL_TTL_MS;
  const intent: CanonicalIntent = {
    action: input.action,
    intentId: `itx_${randomUUID().replace(/-/g, "")}`,
    accountId: input.userId,
    chain: input.chain,
    assetId: input.assetId,
    amountMinor: input.amountMinor,
    destination: input.destination,
    spender: input.spender,
    // The calldata is carried in the payload, and the payload digest below is
    // what binds it. Duplicating it here would mean two copies that could
    // disagree, and the boundary would have to decide which one it believed.
    chainPayloadDigest: chainPayloadDigest(payload),
    // Server-issued, from the CSPRNG. A client-chosen nonce is not anti-replay.
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now,
    expiresAt: now + validFor,
  };

  let canonicalDigest: string;
  try {
    canonicalDigest = intentDigest(intent);
  } catch {
    // Canonicalisation refused the intent — a malformed amount, a reserved
    // separator in an address. Not signable, and not worth storing.
    return { ok: false, refusals: ["intent_invalid"] };
  }

  // THE CHECK THAT MAKES THE INTENT MEAN SOMETHING. Without it the amount and
  // the recipient shown to the user are decoration next to whatever the
  // calldata does.
  const verified = verifyPayloadMatchesIntent(intent, payload);
  if (!verified.ok) {
    audit("signing.authorization_refused", input.userId, {
      stage: "prepare",
      reasons: verified.refusals.join(","),
      assetId: input.assetId,
      chain: input.chain,
    });
    return { ok: false, refusals: verified.refusals };
  }

  const proposal: TransactionProposal = {
    intentId: intent.intentId,
    userId: input.userId,
    walletId: input.walletId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    intent,
    payload,
    canonicalDigest,
    simulation: null,
    confirmation: null,
    status: "prepared",
    version: 1,
    createdAt: now,
    expiresAt: now + validFor,
  };

  await kvSet(PROPOSAL_KEY(proposal.intentId), proposal, Math.ceil(validFor / 1000));
  return { ok: true, proposal, refusals: [] };
}

export async function getProposal(intentId: string): Promise<TransactionProposal | null> {
  return kvGet<TransactionProposal>(PROPOSAL_KEY(intentId));
}

/**
 * Replace a proposal, bumping its version.
 *
 * Every mutation goes through here so the version can never be forgotten. A
 * missed bump would silently reopen the TOCTOU window this field exists to
 * close, and nothing downstream would report it — the authorization would
 * simply match a record that had moved.
 */
export async function updateProposal(
  proposal: TransactionProposal,
  patch: Partial<
    Pick<TransactionProposal, "simulation" | "confirmation" | "status">
  >,
  now: number = Date.now()
): Promise<TransactionProposal> {
  const updated: TransactionProposal = {
    ...proposal,
    ...patch,
    version: proposal.version + 1,
  };
  const ttl = Math.max(1, Math.ceil((proposal.expiresAt - now) / 1000));
  await kvSet(PROPOSAL_KEY(proposal.intentId), updated, ttl);
  return updated;
}

/**
 * Load a proposal and confirm it belongs to this caller, device and instance.
 *
 * Ownership is re-checked on every read rather than assumed from the id.
 * `intentId` is unguessable, but unguessable is not the same as unforgeable,
 * and an id that leaks — into a log, a crash report, a screenshot — must not
 * become an authorisation.
 */
export async function loadOwnedProposal(input: {
  intentId: string;
  userId: string;
  deviceId: string;
  appInstanceId: string;
  now?: number;
}): Promise<
  | { ok: true; proposal: TransactionProposal }
  | { ok: false; reason: "not_found" | "not_owned" | "expired" | "not_pending" }
> {
  const now = input.now ?? Date.now();
  const proposal = await getProposal(input.intentId);
  if (!proposal) return { ok: false, reason: "not_found" };
  if (
    proposal.userId !== input.userId ||
    proposal.deviceId !== input.deviceId ||
    proposal.appInstanceId !== input.appInstanceId
  ) {
    return { ok: false, reason: "not_owned" };
  }
  if (now > proposal.expiresAt) return { ok: false, reason: "expired" };
  // "signed" and "void" are terminal. Re-authorising a signed proposal is how
  // one approval becomes two payments.
  if (proposal.status === "signed" || proposal.status === "void") {
    return { ok: false, reason: "not_pending" };
  }
  return { ok: true, proposal };
}
