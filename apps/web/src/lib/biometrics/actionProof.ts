// ---------------------------------------------------------------------------
// Action-bound biometric step-up.
//
// WHY THIS EXISTS, AND WHY IT IS NOT biometricPay.ts
//
// biometricPay.ts binds a proof to a TRANSFER: `{amount, asset, recipient,
// chain}`. That is the right shape for /api/wallets/transfer and it is in
// production, so its semantics are left exactly as they are.
//
// It is the wrong shape for everything else. The iOS Guardian app dispatches to
// a registry-fixed set of endpoints — /payments/create, /swaps,
// /investing/order, /investing/schedule, /earn/deposit, /cards/settings,
// /support/tickets — and an investing order has a symbol, a quantity and a side.
// It has no recipient and no chain. Forcing it through a transfer-shaped digest
// would mean binding to a subset of the fields that actually matter, which is a
// binding an attacker can slip: approve "buy 1 share", submit "buy 1000".
//
// THE DEFECT THIS CLOSES
//
// Guardian's `ServiceContainer.confirmAndDispatch` gates every money-moving
// action behind Face ID. `BiometricGate` returns a local `Bool` from `LAContext`,
// and nothing about it reaches the server. Measured across all seven endpoints
// Guardian can reach: zero enforced step-up, zero biometric proof, zero MFA. A
// bearer token alone authorised a $25,000 investing order, and the Face ID sheet
// was decorative — a patched client, a stolen token, or a replayed request
// skipped it and left no trace.
//
// So the fix could not be "wire up the client". There was no server-side control
// for a client to talk to, and shipping one would have produced a proof nothing
// validated.
//
// THE BINDING
//
// The digest commits to the ACTION, canonically: the HTTP method, the endpoint,
// and the full request body the client intends to send. At spend time the route
// re-derives the digest from the request it actually received and compares. A
// proof therefore authorises exactly one request and nothing else — not "some
// order", that order.
//
// Same three-step shape as biometricPay.ts, deliberately: challenge (90s) →
// assertion → single-use proof (120s). Sharing the shape means one mental model
// and one set of TTL expectations rather than two that drift.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  getCredentials,
  updateCounter,
} from "@/lib/webauthn";
import { log } from "@/lib/log";

/** A JSON body, as the Guardian registry produces it. */
export type CanonicalJSON =
  | string
  | number
  | boolean
  | null
  | CanonicalJSON[]
  | { [key: string]: CanonicalJSON };

export interface ActionIntent {
  userId: string;
  /** Registry endpoint path, e.g. "/investing/order". */
  endpoint: string;
  /** HTTP method, upper-cased by `canonicalise`. */
  method: string;
  /** The exact body that will be sent. */
  body: Record<string, CanonicalJSON>;
}

const CHALLENGE_PREFIX = "act:chal:";
const PROOF_PREFIX = "act:proof:";
const CHALLENGE_TTL_SECONDS = 90;
const PROOF_TTL_SECONDS = 120;

/** Bumped if the encoding below ever changes, so old proofs cannot be reinterpreted. */
const DIGEST_VERSION = "v1";

/**
 * Deterministic JSON serialisation.
 *
 * Object keys are sorted so that two bodies differing only in key order produce
 * the same digest — otherwise a client that serialises `{a,b}` and a server that
 * re-serialises `{b,a}` would disagree and every proof would be rejected as
 * tampering.
 *
 * Non-finite numbers and `undefined` are REFUSED rather than coerced. `NaN` and
 * `Infinity` have no JSON representation, and `JSON.stringify` silently turns
 * them into `null` — two different bodies would then hash identically. Throwing
 * makes that a loud bug at the point of use instead of a quiet collision in a
 * security check.
 */
export function canonicalJSON(value: CanonicalJSON): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalJSON: non-finite number (${value}) cannot be bound`);
      }
      // `String` is the canonical form and needs no help: JavaScript has one
      // numeric type, so `1.0` and `1` are the same value before this function
      // ever sees them, and `String(-0)` is already "0".
      //
      // An earlier version special-cased -0 here. That branch was dead — verified,
      // not assumed — and a test written against it could only ever pass. Removed
      // rather than left as reassuring decoration.
      return String(value);

    case "string":
      return JSON.stringify(value);

    case "object": {
      if (Array.isArray(value)) {
        // Order IS significant in an array and is preserved. Sorting here would
        // make ["a","b"] and ["b","a"] the same approval.
        return `[${value.map(canonicalJSON).join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, CanonicalJSON>);
      for (const [k, v] of entries) {
        if (v === undefined) {
          throw new Error(`canonicalJSON: key "${k}" is undefined; omit it or send null`);
        }
      }
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(",")}}`;
    }

    default:
      throw new Error(`canonicalJSON: unsupported type ${typeof value}`);
  }
}

/**
 * Length-prefixed concatenation.
 *
 * Joining fields with a delimiter — `parts.join("|")` — is injective only while
 * no field can contain the delimiter. Endpoints come from a fixed registry today,
 * so nothing can, but a digest whose correctness rests on that is one new field
 * away from letting an attacker shift a value across a boundary and authorise a
 * different action with a matching hash. Prefixing each part with its byte length
 * removes the question rather than answering it.
 */
function lengthPrefixed(parts: string[]): string {
  return parts.map((p) => `${Buffer.byteLength(p, "utf8")}:${p}`).join("");
}

/** SHA-256 over the canonical form of the action, hex. */
export function computeActionDigest(intent: ActionIntent, nonce: string): string {
  const canonical = lengthPrefixed([
    DIGEST_VERSION,
    intent.userId.trim().toLowerCase(),
    intent.method.trim().toUpperCase(),
    // Endpoint is compared byte-for-byte after trimming. NOT lower-cased: a path
    // is case-sensitive, and folding it would let /Investing/Order be approved by
    // a proof minted for /investing/order.
    intent.endpoint.trim(),
    canonicalJSON(intent.body),
    nonce.trim(),
  ]);

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ActionChallengeRecord {
  challengeId: string;
  challenge: string;
  userId: string;
  actionDigest: string;
  /** Needed to re-derive the digest at spend time — see BiometricProofRecord. */
  nonce: string;
  endpoint: string;
  method: string;
  createdAt: number;
  expiresAt: number;
}

export interface ActionProofRecord {
  proofId: string;
  userId: string;
  actionDigest: string;
  nonce: string;
  endpoint: string;
  method: string;
  credentialId: string;
  verifiedAt: number;
  expiresAt: number;
}

/** Step 1 — mint a challenge bound to this exact action. */
export async function createActionStepUpChallenge(intent: ActionIntent) {
  const credentials = await getCredentials(intent.userId);
  if (!credentials || credentials.length === 0) {
    throw new Error("No passkeys registered. Register a passkey before approving this action.");
  }

  const nonce = crypto.randomUUID();
  const actionDigest = computeActionDigest(intent, nonce);

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    // Forces Face ID / Touch ID / fingerprint. A silent credential or a
    // non-biometric fallback is refused — the whole point is proving a human was
    // present for THIS action.
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as never,
    })),
  });

  const challengeId = `act_chal_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();

  const record: ActionChallengeRecord = {
    challengeId,
    challenge: options.challenge,
    userId: intent.userId,
    actionDigest,
    nonce,
    endpoint: intent.endpoint,
    method: intent.method.trim().toUpperCase(),
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_SECONDS * 1000,
  };

  await kvSet(`${CHALLENGE_PREFIX}${challengeId}`, record, CHALLENGE_TTL_SECONDS);

  log.info("Action step-up challenge issued", {
    userId: intent.userId,
    challengeId,
    endpoint: intent.endpoint,
    method: record.method,
  });

  return { challengeId, options, expiresInSeconds: CHALLENGE_TTL_SECONDS };
}

/** Step 2 — verify the assertion and mint a single-use proof. */
export async function verifyActionStepUpAssertion(
  userId: string,
  challengeId: string,
  assertion: AuthenticationResponseJSON
) {
  const record = await kvGet<ActionChallengeRecord>(`${CHALLENGE_PREFIX}${challengeId}`);
  if (!record) {
    throw new Error("Step-up challenge not found or expired. Please approve again.");
  }
  if (record.userId !== userId) {
    throw new Error("Challenge belongs to a different user session.");
  }

  // Burn on read, before the signature is checked. A challenge that survives a
  // failed verification is a challenge an attacker can retry against.
  await kvDel(`${CHALLENGE_PREFIX}${challengeId}`);

  const credentials = await getCredentials(userId);
  const matched = credentials.find((c) => c.id === assertion.id);
  if (!matched) {
    throw new Error("Credential not recognised for this account.");
  }

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: record.challenge,
    expectedOrigin: EXPECTED_ORIGINS,
    expectedRPID: EXPECTED_RPIDS,
    credential: {
      id: matched.id,
      publicKey: matched.publicKey,
      counter: matched.counter,
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new Error("Biometric verification failed.");
  }

  // Clone detection.
  await updateCounter(userId, matched.id, verification.authenticationInfo.newCounter);

  const proofId = `act_proof_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();
  const proof: ActionProofRecord = {
    proofId,
    userId,
    actionDigest: record.actionDigest,
    nonce: record.nonce,
    endpoint: record.endpoint,
    method: record.method,
    credentialId: matched.id,
    verifiedAt: now,
    expiresAt: now + PROOF_TTL_SECONDS * 1000,
  };

  await kvSet(`${PROOF_PREFIX}${proofId}`, proof, PROOF_TTL_SECONDS);

  log.info("Action step-up assertion verified", {
    userId,
    proofId,
    endpoint: record.endpoint,
    credentialId: matched.id,
  });

  return { verified: true as const, proofId, expiresInSeconds: PROOF_TTL_SECONDS };
}

/**
 * Step 3 — validate and consume, at the point the action executes.
 *
 * Returns `{ valid: false }` for every failure, never throws, so a route cannot
 * accidentally treat a thrown error as a pass.
 */
export async function validateAndConsumeActionProof(
  userId: string,
  proofId: string,
  action: { endpoint: string; method: string; body: Record<string, CanonicalJSON> }
): Promise<{ valid: boolean; reason?: string }> {
  if (!proofId || typeof proofId !== "string" || !proofId.startsWith("act_proof_")) {
    return { valid: false, reason: "Malformed step-up proof." };
  }

  const proof = await kvGet<ActionProofRecord>(`${PROOF_PREFIX}${proofId}`);
  if (!proof) {
    return { valid: false, reason: "Step-up proof expired or already used." };
  }

  // Single use. Burned before any further check so a rejected attempt cannot be
  // retried with a mutated body until one matches.
  await kvDel(`${PROOF_PREFIX}${proofId}`);

  if (proof.userId !== userId) {
    return { valid: false, reason: "Step-up proof principal mismatch." };
  }
  if (Date.now() > proof.expiresAt) {
    return { valid: false, reason: "Step-up proof has expired." };
  }

  // ─── The binding ──────────────────────────────────────────────────────────
  //
  // Re-derive from the request actually being executed. Everything above is WHO
  // and WHEN; this is WHAT, and it is the only check that makes the Face ID
  // prompt mean what the user read on it.
  //
  // `nonce` is what makes this possible and is why it is stored: without it the
  // digest cannot be recomputed, and a stored digest with nothing to compare it
  // against is a promise no one can check.
  let submitted: string;
  try {
    submitted = computeActionDigest(
      { userId, endpoint: action.endpoint, method: action.method, body: action.body },
      proof.nonce
    );
  } catch (e) {
    // A body that cannot be canonicalised (NaN, undefined) cannot be bound, so it
    // cannot be approved. Refusing is the only safe answer.
    return {
      valid: false,
      reason: `Request body cannot be verified: ${e instanceof Error ? e.message : "invalid"}`,
    };
  }

  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(proof.actionDigest ?? "", "utf8");
  // Length first: timingSafeEqual throws on a mismatch, and unequal lengths mean
  // a corrupt record rather than an attacker-chosen input.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    log.warn("Step-up proof rejected — request does not match what was approved", {
      userId,
      proofId,
      // Digest prefixes only. A rejected attempt is exactly when not to widen
      // what ends up in logs.
      approvedDigest: proof.actionDigest?.slice(0, 12),
      submittedDigest: submitted.slice(0, 12),
      approvedEndpoint: proof.endpoint,
      submittedEndpoint: action.endpoint,
    });
    return {
      valid: false,
      reason: "This approval was for a different request. Please approve again.",
    };
  }

  return { valid: true };
}
