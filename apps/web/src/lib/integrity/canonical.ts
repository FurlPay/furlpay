import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Canonical request form, and the digest that binds every other control to it.
//
// THIS IS THE LOAD-BEARING FILE. Attestation, simulation, user confirmation and
// the signature are four separate controls, and each one is worthless on its
// own if they can be pointed at four different transactions. The attack is not
// hypothetical and needs no cryptography broken:
//
//     1. Client builds "send 10 USDC to Alice".
//     2. Simulation runs on that. Clean.
//     3. User confirms that. Approved.
//     4. Attestation token is minted for that.
//     5. Something between step 4 and the signer swaps in
//        "approve unlimited USDC to Attacker".
//     6. Every control passed. The wrong transaction is signed.
//
// The defence is that all four controls commit to the SAME BYTES. This module
// produces those bytes and their digest. `requestHash` from Play Integrity and
// `clientDataHash` from App Attest are both filled with this digest, the
// simulation is keyed on it, and the final signed payload is re-canonicalised
// and compared to it. A mismatch anywhere is a hard block.
//
// WHY HAND-ROLLED AND NOT JSON.stringify. Key order in JS objects is insertion
// order, so two structurally identical intents serialise differently depending
// on how they were built. The client and the server would then compute
// different digests for the same transaction, and the system would either
// fail every request or — far worse — someone would "fix" it by removing the
// comparison. Canonicalisation must be defined once, precisely, and match on
// both sides byte for byte.
//
// SIZE. Play Integrity caps `requestHash` at 500 bytes. A SHA-256 hex digest is
// 64, so the digest fits with room to spare. The canonical STRING may be any
// length because only its digest is transmitted.
// ---------------------------------------------------------------------------

/**
 * A money-moving intent, in the only shape the security boundary understands.
 *
 * Deliberately flat and typed as strings. Numbers are excluded on purpose: a
 * float has no canonical decimal representation, so `10.1` could serialise
 * differently on two platforms and break the binding. Amounts arrive as
 * integer minor-unit strings, matching lib/money/money.ts.
 */
export interface CanonicalIntent {
  /** What kind of movement. Part of the digest so a transfer cannot be
   *  replayed as an approval. */
  readonly action:
    | "transfer"
    | "approve"
    | "swap"
    | "withdraw"
    | "contract_call"
    | "card_authorize";
  /** Our own transaction id. Makes the digest unique per intent. */
  readonly intentId: string;
  /** Acting account. Binds the intent to who authorised it. */
  readonly accountId: string;
  /** Settlement domain, e.g. "arbitrum". Never assume one chain. */
  readonly chain: string;
  /** Asset id from lib/money/money.ts, e.g. "USDC.arbitrum". */
  readonly assetId: string;
  /** Integer minor units as a decimal string. Never a float. */
  readonly amountMinor: string;
  /** Where value goes. Lower-cased for EVM; case-sensitive elsewhere. */
  readonly destination: string;
  /**
   * For `approve`: who is being granted the allowance.
   *
   * Separate from `destination` because an approval's danger is the SPENDER,
   * and folding the two together would let an unlimited approval to an
   * attacker share a digest with a transfer to a friend.
   */
  readonly spender?: string;
  /** Raw calldata, hex. Included verbatim — this is where the real payload is. */
  readonly calldata?: string;
  /**
   * SHA-256 of the exact chain-level transaction this intent will produce.
   *
   * WITHOUT THIS FIELD the boundary binds a DESCRIPTION of a payment while the
   * bytes underneath stay free. A client could submit `amountMinor: "1"` —
   * passing every budget, every policy, every confirmation screen — next to
   * calldata transferring the whole balance, and nothing above would notice,
   * because nothing above was looking at the calldata.
   *
   * Folding the payload digest into the intent digest means simulation,
   * attestation, confirmation and the signature all commit to the transaction
   * itself and not merely to a summary of it. See `evmPayload.ts`, where the
   * calldata is additionally DECODED and compared field-by-field — the digest
   * proves the bytes did not change, the decode proves they mean what the
   * intent claims.
   *
   * Optional so a non-EVM settlement domain, whose payload is a different shape
   * entirely, is not forced into an EVM-shaped field.
   */
  readonly chainPayloadDigest?: string;
  /** Anti-replay. A server-issued value the client cannot choose. */
  readonly nonce: string;
  /** Unix ms. Bounds how long an authorisation stays usable. */
  readonly issuedAt: number;
  /** Unix ms. After this the intent may not be signed. */
  readonly expiresAt: number;
}

/**
 * Field order for canonicalisation.
 *
 * Declared explicitly rather than sorted at runtime. A sort depends on locale
 * and on the exact key strings; if either differs between client and server the
 * digests diverge silently. An explicit list also means adding a field is a
 * deliberate, reviewable act — and adding one WITHOUT adding it here would
 * leave that field outside the binding, which is the subtle version of having
 * no binding at all.
 */
const FIELD_ORDER: readonly (keyof CanonicalIntent)[] = [
  "action",
  "intentId",
  "accountId",
  "chain",
  "assetId",
  "amountMinor",
  "destination",
  "spender",
  "calldata",
  "chainPayloadDigest",
  "nonce",
  "issuedAt",
  "expiresAt",
];

export class CanonicalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalisationError";
  }
}

/** Addresses are compared case-insensitively on EVM; everything else is exact. */
function normaliseAddress(value: string, chain: string): string {
  const evm = /^0x[0-9a-fA-F]{40}$/.test(value);
  // Only EVM addresses are case-folded. A Solana address is base58 and case IS
  // significant, so lower-casing it would produce a different, wrong address.
  return evm ? value.toLowerCase() : value;
}

function assertField(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CanonicalisationError(`Canonical intent field "${name}" must be a non-empty string.`);
  }
  // A separator inside a value would let one field impersonate two. "ab"
  // in `destination` could otherwise shift every later field by one position
  // and produce a digest matching a completely different intent.
  if (value.includes(SEPARATOR) || value.includes(RECORD)) {
    throw new CanonicalisationError(`Canonical intent field "${name}" contains a reserved separator.`);
  }
}

/** Unit separator (0x1F) and record separator (0x1E) — never valid in our
 *  field values, which is what makes the encoding unambiguous. */
const SEPARATOR = "";
const RECORD = "";

/**
 * Deterministic string form of an intent.
 *
 * Format: `v1` then, for each field in FIELD_ORDER, `name US value RS`.
 * Absent optional fields are emitted with an empty value rather than skipped —
 * skipping would make `{spender: undefined, calldata: "0xab"}` and
 * `{spender: "0xab", calldata: undefined}` collide.
 */
export function canonicalise(intent: CanonicalIntent): string {
  assertField("action", intent.action);
  assertField("intentId", intent.intentId);
  assertField("accountId", intent.accountId);
  assertField("chain", intent.chain);
  assertField("assetId", intent.assetId);
  assertField("destination", intent.destination);
  assertField("nonce", intent.nonce);

  // Amount must be an integer minor-unit string. A float here is the bug this
  // whole module exists to make impossible.
  if (!/^-?\d+$/.test(intent.amountMinor)) {
    throw new CanonicalisationError(
      `amountMinor must be integer minor units as a decimal string, got "${intent.amountMinor}".`
    );
  }
  if (!Number.isInteger(intent.issuedAt) || !Number.isInteger(intent.expiresAt)) {
    throw new CanonicalisationError("issuedAt and expiresAt must be integer milliseconds.");
  }
  if (intent.expiresAt <= intent.issuedAt) {
    throw new CanonicalisationError("expiresAt must be after issuedAt.");
  }

  const parts: string[] = ["v1"];
  for (const field of FIELD_ORDER) {
    const raw = intent[field];
    let value: string;
    if (raw === undefined || raw === null) value = "";
    else if (typeof raw === "number") value = String(raw);
    else value = String(raw);

    if (field === "destination" || field === "spender") {
      value = value ? normaliseAddress(value, intent.chain) : "";
    }
    if (field === "calldata" && value) {
      // Hex is case-insensitive; normalising prevents a cosmetic difference
      // from breaking the binding.
      value = value.toLowerCase();
    }
    if (value.includes(SEPARATOR) || value.includes(RECORD)) {
      throw new CanonicalisationError(`Field "${field}" contains a reserved separator.`);
    }
    parts.push(`${field}${SEPARATOR}${value}${RECORD}`);
  }
  return parts.join("");
}

/**
 * SHA-256 of the canonical form, lower-case hex.
 *
 * This single value is what goes into Play Integrity's `requestHash`, App
 * Attest's `clientDataHash`, the simulation cache key, and the record of what
 * the user confirmed. Everything downstream compares against it.
 */
export function intentDigest(intent: CanonicalIntent): string {
  return createHash("sha256").update(canonicalise(intent), "utf8").digest("hex");
}

/**
 * Compare two intents by digest.
 *
 * Used to answer the only question that matters at the signer: "is the thing
 * about to be signed the thing that was simulated, attested and confirmed?"
 */
export function sameIntent(a: CanonicalIntent, b: CanonicalIntent): boolean {
  return intentDigest(a) === intentDigest(b);
}

export type BindingFailure =
  | "digest_mismatch"
  | "expired"
  | "not_yet_valid"
  | "nonce_mismatch"
  | "account_mismatch";

export interface BindingResult {
  readonly bound: boolean;
  readonly failures: readonly BindingFailure[];
  readonly digest: string;
}

/**
 * Verify that a presented intent matches the digest it claims, is still live,
 * and belongs to the account and nonce the server issued.
 *
 * Returns EVERY failure rather than the first. During an incident the
 * difference between "expired" and "digest mismatch" is the difference between
 * a slow user and an active attack, and finding out one at a time wastes the
 * window in which that distinction is useful.
 *
 * Deliberately NOT constant-time. The digest is not a secret — it is derived
 * from an intent the client authored and already holds. Timing tells an
 * attacker nothing they cannot compute themselves.
 */
export function verifyBinding(
  intent: CanonicalIntent,
  expected: {
    readonly digest: string;
    readonly nonce: string;
    readonly accountId: string;
  },
  now: number = Date.now()
): BindingResult {
  const failures: BindingFailure[] = [];
  const digest = intentDigest(intent);

  if (digest !== expected.digest) failures.push("digest_mismatch");
  if (intent.nonce !== expected.nonce) failures.push("nonce_mismatch");
  if (intent.accountId !== expected.accountId) failures.push("account_mismatch");
  if (now > intent.expiresAt) failures.push("expired");
  // Small tolerance for clock skew between the device and the server. Without
  // it, a phone a few seconds fast has every authorisation rejected.
  if (now + 60_000 < intent.issuedAt) failures.push("not_yet_valid");

  return { bound: failures.length === 0, failures, digest };
}
