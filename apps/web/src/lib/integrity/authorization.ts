import { randomUUID } from "crypto";
import { kvGet, kvSet, kvSetNx, kvDel } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { intentDigest, type CanonicalIntent } from "./canonical";
import {
  authorizeForSigning,
  type AuthorizationRefusal,
  type SimulationResult,
  type UserConfirmation,
} from "./boundary";
import type { AppIntegritySignal } from "./types";

// ---------------------------------------------------------------------------
// Signing authorization — the ticket a signer demands before it will act.
//
// WHY A TICKET AND NOT A PER-REQUEST CHECK. `/api/mpc/sign` accepted a digest
// plus "advisory" context and said so in its own comment: "the digest is
// authoritative and we cannot verify that these fields describe it." That is
// exactly the hole. A caller who can reach the route can sign ANY 32 bytes,
// and the policy gate above it is priced from numbers the same caller supplied.
//
// The fix is not to add more fields to that request. Any field the client
// sends, the client can choose. The fix is that the SERVER holds the intent,
// runs the boundary itself, and mints a short-lived single-use ticket. The
// signing request then presents the ticket rather than describing the work.
//
// So the trust flow inverts:
//
//   before:  client says "sign 0xabc…, it's a $10 transfer, honest"
//   after:   client says "sign under authorization auth_7f2…"
//            server looks up what auth_7f2 actually authorised, re-derives the
//            digest from ITS OWN stored intent, and signs that
//
// THREE PROPERTIES THIS BUYS, none of which a request-shaped check can give:
//
//   1. The digest is server-derived. A client cannot present a digest for one
//      transaction and metadata for another, because it presents neither.
//   2. Single use. A captured authorization is worth one signature, and only
//      if it is still within its short window.
//   3. TOCTOU is closed. The intent is frozen into the authorization at mint
//      time, so mutating the stored transaction afterwards cannot change what
//      gets signed — it invalidates the authorization instead.
//
// DURABILITY IS NOT OPTIONAL. All state lives on the KV layer, which is Redis
// in production. A process-local Map would mean a replayed authorization simply
// lands on a different lambda and succeeds — the same reasoning that made the
// App Attest assertion counter durable in providers.ts.
// ---------------------------------------------------------------------------

/** How long an authorization stays usable. Deliberately short: it exists to
 *  bridge confirmation and signing, which is seconds, not minutes. */
export const AUTHORIZATION_TTL_MS = 120_000;

/** Retention for the consumed marker. Must outlive the authorization itself,
 *  or a replay after expiry would find no record and look novel. */
const CONSUMED_TTL_SECONDS = 24 * 3600;

const AUTH_KEY = (id: string) => `sign:auth:${id}`;
const CONSUMED_KEY = (id: string) => `sign:auth:consumed:${id}`;

/**
 * A minted authorization.
 *
 * `intent` is stored WHOLE rather than as a digest. The signer needs to
 * re-derive the digest from the intent itself — storing only the digest would
 * mean trusting a value we cannot recompute, which is the property we are
 * trying to remove.
 */
export interface SigningAuthorization {
  readonly authorizationId: string;
  readonly canonicalDigest: string;
  /** The exact intent that was authorised. The signer signs THIS. */
  readonly intent: CanonicalIntent;
  readonly userId: string;
  readonly walletId: string;
  /**
   * The device and app instance this authorization was minted FOR.
   *
   * Without these the chain USER → DEVICE → APP INSTANCE → … is broken at its
   * second link: an authorization would be usable from any client holding the
   * session, which is exactly what a stolen token gives an attacker.
   *
   * `deviceKeyVersion` is what makes revocation retroactive. Revoking a device
   * bumps its key version, so every outstanding authorization minted under the
   * old version fails its check — without needing to enumerate and delete them,
   * which on a KV store is a scan that cannot be done atomically.
   */
  readonly deviceId: string;
  readonly appInstanceId: string;
  readonly deviceKeyVersion: number;
  /** The challenge that must be consumed alongside this authorization. */
  readonly challengeId: string;
  /**
   * Version of the stored transaction at mint time.
   *
   * The TOCTOU guard: if the transaction record has advanced since, the world
   * changed after the security cycle ran and the authorization is void.
   */
  readonly transactionVersion: number;
  readonly simulationDigest: string;
  readonly confirmationDigest: string;
  readonly integrityDigest: string | null;
  readonly integrityVerdict: AppIntegritySignal["verdict"] | null;
  readonly warnings: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type AuthorizationFailure =
  | AuthorizationRefusal
  | "authorization_not_found"
  | "authorization_expired"
  | "authorization_replayed"
  | "authorization_user_mismatch"
  | "authorization_wallet_mismatch"
  | "authorization_device_mismatch"
  | "authorization_app_instance_mismatch"
  | "authorization_device_key_rotated"
  | "authorization_challenge_mismatch"
  | "transaction_version_mismatch"
  | "signing_unavailable";

export interface MintResult {
  readonly ok: boolean;
  readonly authorization?: SigningAuthorization;
  readonly failures: readonly AuthorizationFailure[];
  readonly warnings: readonly string[];
  /** Full internal detail. Logged and audited, never returned to a client. */
  readonly diagnostics: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Run the boundary and mint an authorization if every control agrees.
 *
 * The caller supplies the SERVER's copy of the intent — not the client's. That
 * is the whole point: if this function is ever handed a client-supplied intent,
 * the guarantee collapses to "the client agreed with itself".
 */
export async function mintAuthorization(input: {
  intent: CanonicalIntent;
  expected: { nonce: string; accountId: string };
  userId: string;
  walletId: string;
  deviceId: string;
  appInstanceId: string;
  deviceKeyVersion: number;
  challengeId: string;
  transactionVersion: number;
  simulation: SimulationResult | null;
  integrity: AppIntegritySignal | null;
  confirmation: UserConfirmation | null;
  now?: number;
}): Promise<MintResult> {
  const now = input.now ?? Date.now();
  const digest = intentDigest(input.intent);

  const decision = authorizeForSigning(
    {
      intent: input.intent,
      expected: input.expected,
      simulation: input.simulation,
      integrity: input.integrity,
      confirmation: input.confirmation,
      // At mint time the intent IS what will be signed. The signer re-checks
      // this against its own rebuild, which is where a substitution would show.
      aboutToSign: input.intent,
    },
    now
  );

  const diagnostics: Record<string, string | number | boolean | null> = {
    canonicalDigest: digest,
    simulationDigest: input.simulation?.boundDigest ?? null,
    confirmationDigest: input.confirmation?.boundDigest ?? null,
    integrityDigest: input.integrity?.boundDigest ?? null,
    integrityVerdict: input.integrity?.verdict ?? null,
    transactionVersion: input.transactionVersion,
    riskWeight: decision.riskWeight,
  };

  if (!decision.allowed) {
    audit("signing.authorization_refused", input.userId, {
      ...diagnostics,
      reasons: decision.refusals.join(","),
      walletId: input.walletId,
    });
    return {
      ok: false,
      failures: decision.refusals,
      warnings: decision.warnings,
      diagnostics,
    };
  }

  const authorization: SigningAuthorization = {
    authorizationId: `auth_${randomUUID().replace(/-/g, "")}`,
    canonicalDigest: digest,
    intent: input.intent,
    userId: input.userId,
    walletId: input.walletId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    deviceKeyVersion: input.deviceKeyVersion,
    challengeId: input.challengeId,
    transactionVersion: input.transactionVersion,
    simulationDigest: input.simulation!.boundDigest,
    confirmationDigest: input.confirmation!.boundDigest,
    integrityDigest: input.integrity?.boundDigest ?? null,
    integrityVerdict: input.integrity?.verdict ?? null,
    warnings: decision.warnings,
    issuedAt: now,
    expiresAt: now + AUTHORIZATION_TTL_MS,
  };

  await kvSet(
    AUTH_KEY(authorization.authorizationId),
    authorization,
    Math.ceil(AUTHORIZATION_TTL_MS / 1000)
  );

  audit("signing.authorization_granted", input.userId, {
    ...diagnostics,
    authorizationId: authorization.authorizationId,
    walletId: input.walletId,
    warnings: decision.warnings.length,
  });

  return {
    ok: true,
    authorization,
    failures: [],
    warnings: decision.warnings,
    diagnostics,
  };
}

export interface ConsumeResult {
  readonly ok: boolean;
  readonly authorization?: SigningAuthorization;
  readonly failures: readonly AuthorizationFailure[];
  readonly diagnostics: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Claim an authorization for exactly one signature.
 *
 * ORDER MATTERS, and this ordering is the replay defence:
 *
 *   1. Claim the consumed marker with SET NX — atomic, so two concurrent
 *      requests cannot both win.
 *   2. Only then load and validate.
 *
 * Doing it the other way round (validate, then mark) leaves a window in which
 * two concurrent replays both pass validation and both sign. On serverless
 * those two requests are on different instances, so nothing local would catch
 * it.
 *
 * The cost is that a request failing validation still burns the authorization.
 * That is the correct trade: an authorization is cheap to re-mint through the
 * normal flow, and a signature is not recoverable.
 */
export async function consumeAuthorization(input: {
  authorizationId: string;
  userId: string;
  walletId: string;
  /** The device and instance PRESENTING the authorization now. */
  deviceId: string;
  appInstanceId: string;
  /** The device's CURRENT key version, read from the registry by the caller.
   *  A revoked or rotated device no longer matches what was minted. */
  currentDeviceKeyVersion: number;
  /** The challenge the caller consumed for this operation. */
  challengeId: string;
  /** Current version of the stored transaction, for the TOCTOU check. */
  currentTransactionVersion: number;
  /**
   * What the signer path REBUILT, when it rebuilds anything.
   *
   * Optional, and the distinction is important rather than a convenience:
   *
   *   ABSENT  — the signer signs the server's own stored intent directly
   *             (/api/mpc/sign). There is nothing to cross-check against,
   *             because no second construction of the transaction exists. The
   *             stored record is re-canonicalised below to prove it was not
   *             tampered with at rest, which is the only check available and
   *             the only one needed.
   *
   *   PRESENT — the signer built a chain-specific encoding (RLP, a Solana
   *             message) from the intent. THAT rebuild is exactly where a
   *             substitution can occur, so it must be canonicalised and
   *             compared. A signer path that rebuilds and does NOT pass this
   *             has an unchecked gap.
   */
  aboutToSign?: CanonicalIntent;
  now?: number;
}): Promise<ConsumeResult> {
  const now = input.now ?? Date.now();
  const failures: AuthorizationFailure[] = [];

  // 1. Atomic single-use claim, BEFORE any validation.
  const claimed = await kvSetNx(CONSUMED_KEY(input.authorizationId), now, CONSUMED_TTL_SECONDS);
  if (!claimed) {
    audit("signing.replay_blocked", input.userId, {
      authorizationId: input.authorizationId,
      walletId: input.walletId,
    });
    return {
      ok: false,
      failures: ["authorization_replayed"],
      diagnostics: { authorizationId: input.authorizationId, replayed: true },
    };
  }

  const stored = await kvGet<SigningAuthorization>(AUTH_KEY(input.authorizationId));
  if (!stored) {
    // Either it never existed or it aged out. Both mean there is no record of
    // what was authorised, and signing without that record is signing blind.
    return {
      ok: false,
      failures: ["authorization_not_found"],
      diagnostics: { authorizationId: input.authorizationId },
    };
  }

  // 2. Bind to the caller. An authorization minted for one account must not be
  //    presentable by another, even with a valid session.
  if (stored.userId !== input.userId) failures.push("authorization_user_mismatch");
  if (stored.walletId !== input.walletId) failures.push("authorization_wallet_mismatch");
  // Device and app instance. An authorization minted on one phone must not be
  // presentable from another, even with a valid session for the same user —
  // that is precisely the stolen-token replay this binding exists to stop.
  if (stored.deviceId !== input.deviceId) failures.push("authorization_device_mismatch");
  if (stored.appInstanceId !== input.appInstanceId) {
    failures.push("authorization_app_instance_mismatch");
  }
  // Retroactive revocation: revoking or rotating bumps the key version, so
  // every authorization minted under the old one stops verifying here.
  if (stored.deviceKeyVersion !== input.currentDeviceKeyVersion) {
    failures.push("authorization_device_key_rotated");
  }
  // The challenge must be the one this authorization was minted with. A
  // challenge from another operation would let two half-authorised flows be
  // spliced into one signature.
  if (stored.challengeId !== input.challengeId) {
    failures.push("authorization_challenge_mismatch");
  }
  if (now > stored.expiresAt) failures.push("authorization_expired");

  // 3. TOCTOU. The stored transaction must not have moved since the security
  //    cycle ran. A mutation requires a NEW cycle, never a silent re-sign.
  if (stored.transactionVersion !== input.currentTransactionVersion) {
    failures.push("transaction_version_mismatch");
  }

  // 4. THE LAST CHECK BEFORE THE KEY. Re-derive the digest and compare it with
  //    what was authorised. When the signer rebuilt the transaction, that
  //    rebuild is what gets checked; otherwise the stored intent is
  //    re-canonicalised, which proves the record was not altered at rest.
  const signingDigest = intentDigest(input.aboutToSign ?? stored.intent);
  if (signingDigest !== stored.canonicalDigest) {
    failures.push("signing_payload_mismatch");
  }

  // 5. Re-assert the internal consistency recorded at mint. Cheap, and it
  //    catches a tampered or partially-written store entry.
  if (
    stored.simulationDigest !== stored.canonicalDigest ||
    stored.confirmationDigest !== stored.canonicalDigest
  ) {
    failures.push("signing_payload_mismatch");
  }

  const diagnostics = {
    authorizationId: stored.authorizationId,
    canonicalDigest: stored.canonicalDigest,
    observedSigningDigest: signingDigest,
    storedVersion: stored.transactionVersion,
    currentVersion: input.currentTransactionVersion,
    integrityVerdict: stored.integrityVerdict,
    ageMs: now - stored.issuedAt,
  };

  if (failures.length > 0) {
    log.error("signing authorization refused at consume", { ...diagnostics, failures });
    audit("signing.authorization_refused", input.userId, {
      ...diagnostics,
      reasons: failures.join(","),
      walletId: input.walletId,
    });
    return { ok: false, failures, diagnostics };
  }

  // Drop the authorization record now that it is spent. The consumed marker
  // outlives it, so a later replay is still recognised as a replay rather than
  // as an unknown id.
  await kvDel(AUTH_KEY(stored.authorizationId));

  return { ok: true, authorization: stored, failures: [], diagnostics };
}

/**
 * Client-safe refusal message.
 *
 * The server logs and audits the full reason; the client gets something
 * actionable that does not enumerate our controls. A caller probing the signer
 * should not learn which of five checks it tripped, because that turns the
 * endpoint into a map of the defences.
 */
export function clientSafeRefusal(failures: readonly AuthorizationFailure[]): {
  error: string;
  detail: string;
  retryable: boolean;
} {
  // Expiry and replay are safe to name: both are states the legitimate client
  // needs to handle, and neither reveals anything about detection.
  if (failures.includes("authorization_expired")) {
    return {
      error: "authorization_expired",
      detail: "This authorization has expired. Start the transaction again.",
      retryable: true,
    };
  }
  if (failures.includes("authorization_replayed")) {
    return {
      error: "authorization_already_used",
      detail: "This authorization has already been used.",
      retryable: false,
    };
  }
  if (failures.includes("simulation_stale")) {
    return {
      error: "simulation_stale",
      detail: "The transaction preview is out of date. Review it again.",
      retryable: true,
    };
  }
  // Everything else — every binding mismatch — collapses to one message. The
  // distinction between "your simulation was for a different transaction" and
  // "your confirmation was" is exactly what an attacker would use to find the
  // seam.
  return {
    error: "authorization_invalid",
    detail: "This transaction could not be authorized. Start again.",
    retryable: true,
  };
}
