// ---------------------------------------------------------------------------
// Intent Mandates — the bounded, verifiable object a human signs.
//
// WHAT A MANDATE IS. Not a permission record in our database, which we could
// edit. A statement the principal made, signed, that we can only read. That
// distinction is the whole security value: if the agent's authority lived only
// in a row we control, then compromising our control plane would be
// indistinguishable from the principal granting more authority. A signed
// mandate means a wider grant requires the principal's key.
//
// WHY THE CREDENTIAL FORMAT IS BEHIND AN INTERFACE. AP2 carries mandates as
// W3C Verifiable Credentials in SD-JWT form; @furlpay/ap2 in this repo carries
// them as Ed25519-signed canonical JSON; a card network's Verifiable Intent will
// be something else again. All three say the same thing about authority. So the
// SEMANTICS live here as a plain object and the FORMAT lives behind
// `MandateCredentialVerifier`. A codebase that hard-codes one format has to be
// rewritten to accept the second one, and mandates are exactly the kind of
// object that arrives in three formats.
//
// STRUCTURAL VALIDATION IS SEPARATE FROM SIGNATURE VALIDATION, AND BOTH ARE
// REQUIRED. A correctly signed mandate with a negative cap, an expiry in the
// past, or a cumulative limit below its per-transaction limit is a mandate whose
// author did not mean what it says. Signature checks catch tampering; they say
// nothing about coherence. `validateMandateShape` is the coherence half and it
// runs on the ISSUE path too, so an incoherent mandate is never signed at all.
//
// CANONICALIZATION IS SHARED WITH THE SIGNER. Recursively sorted keys, no
// whitespace. Two parties that canonicalize differently produce signatures
// neither can verify, and the failure looks like a bad key rather than a
// formatting disagreement — so this function is exported and is the only one
// anything in the control plane uses.
// ---------------------------------------------------------------------------

import {
  scopeWellFormed,
  type AuthorityScope,
} from "./identity";
import { mustParseAtomic, parseAtomic, type Atomic } from "./units";

/** Rails a mandate may authorize. Open string type: a new rail is a registry
 *  entry, not a change to the mandate format. */
export type RailId = string;

/**
 * The authority a principal delegates, in the report's own vocabulary.
 *
 * Mirrors `authority_scope` from the API spec field for field, so a mandate
 * posted to /api/v1/mandates/intent maps here without reinterpretation. It
 * projects onto `AuthorityScope` for chain intersection — the projection is
 * `authorityScopeOf` below, and it is the only place the two vocabularies meet.
 */
export interface MandateAuthorityScope {
  readonly currency: string;
  readonly maxAmountPerTxAtomic: Atomic;
  readonly maxCumulativeAtomic: Atomic;
  readonly spendingWindowSeconds: number;
  /** Empty array = no merchant is allowed. Absent = unconstrained. */
  readonly allowedMerchantDomains?: readonly string[];
  readonly allowedCategories?: readonly string[];
  readonly allowedRails?: readonly RailId[];
  readonly requireHumanApprovalAboveAtomic?: Atomic;
  readonly allowedJurisdictions?: readonly string[];
  readonly blockedJurisdictions?: readonly string[];
  /** Asset the caps are denominated in, when narrower than `currency`. */
  readonly asset?: string;
  readonly networks?: readonly string[];
}

export type MandateStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "CONSUMED";

export interface IntentMandate {
  readonly mandateId: string;
  readonly organizationId: string;
  readonly principalId: string;
  /** The ONE agent this mandate empowers — a DID or an agent id. */
  readonly delegatedTo: string;
  readonly authorityScope: MandateAuthorityScope;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly notBefore?: string;
  /** Single-use replay guard. Stored, never re-derived. */
  readonly nonce: string;
  /** True when the mandate authorizes exactly one payment. */
  readonly singleUse?: boolean;
  /** Bumped whenever the semantics of evaluation change. */
  readonly policyVersion: string;
  readonly status: MandateStatus;
  readonly revokedAt?: string;
  readonly revokedReason?: string;
}

// ── Canonicalization ───────────────────────────────────────────────────────

/** Deterministic JSON with recursively sorted keys and no whitespace. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const source = v as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        // `undefined` is dropped rather than serialized: JSON.stringify would
        // omit it anyway, and keeping it in the key list would make the sorted
        // order depend on a field that never reaches the output.
        if (source[k] !== undefined) acc[k] = sortKeys(source[k]);
        return acc;
      }, {});
  }
  return v;
}

/**
 * The exact bytes a principal signs.
 *
 * Deliberately excludes `status`, `revokedAt` and `revokedReason`: those are
 * OUR lifecycle bookkeeping, not part of what the principal asserted, and
 * including them would invalidate the signature the moment we revoked — leaving
 * us unable to prove what the mandate said.
 */
export function mandateSigningPayload(m: IntentMandate): string {
  return canonicalize({
    mandateId: m.mandateId,
    organizationId: m.organizationId,
    principalId: m.principalId,
    delegatedTo: m.delegatedTo,
    authorityScope: m.authorityScope,
    issuedAt: m.issuedAt,
    expiresAt: m.expiresAt,
    notBefore: m.notBefore,
    nonce: m.nonce,
    singleUse: m.singleUse,
    policyVersion: m.policyVersion,
  });
}

// ── Credential format boundary ─────────────────────────────────────────────

/** How the mandate arrived. `internal` is our own Ed25519 envelope. */
export type CredentialFormat = "internal-ed25519" | "ap2-sd-jwt" | "ap2-ed25519" | "vc-jwt";

export interface MandateCredential {
  readonly format: CredentialFormat;
  /** The wire form, verbatim, as received. Never re-serialized before verify. */
  readonly token: string;
  /** Key id or issuer DID the verifier should resolve. */
  readonly keyId: string;
}

export type CredentialVerification =
  | { readonly ok: true; readonly subject: string; readonly verifiedAt: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Verifies a mandate credential against its issuer.
 *
 * An implementation MUST fail closed on an unresolvable issuer. Returning `ok`
 * for "we could not check" is the single most expensive mistake available at
 * this boundary, because everything downstream then treats the mandate as the
 * principal's own statement.
 */
export interface MandateCredentialVerifier {
  readonly formats: readonly CredentialFormat[];
  verify(credential: MandateCredential, payload: string): Promise<CredentialVerification>;
}

// ── Structural validation ──────────────────────────────────────────────────

export type MandateShapeError =
  | "missing_ids"
  | "currency_missing"
  | "amount_unparseable"
  | "amount_not_positive"
  | "per_tx_exceeds_cumulative"
  | "window_invalid"
  | "expiry_invalid"
  | "expiry_before_issue"
  | "not_before_after_expiry"
  | "nonce_missing"
  | "policy_version_missing"
  | "empty_rail_allowlist_with_approval_threshold"
  | "approval_threshold_unparseable"
  | "scope_incoherent";

export type MandateShapeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: MandateShapeError; readonly detail: string };

/** Longest life a mandate may be issued with. A mandate valid for a year is a
 *  standing wallet with extra steps; the control plane refuses to mint one. */
export const MAX_MANDATE_LIFETIME_MS = 90 * 24 * 3600 * 1000;

export function validateMandateShape(m: IntentMandate): MandateShapeResult {
  if (!m.mandateId || !m.organizationId || !m.principalId || !m.delegatedTo) {
    return { ok: false, error: "missing_ids", detail: "mandateId, organizationId, principalId and delegatedTo are all required" };
  }
  if (!m.nonce) return { ok: false, error: "nonce_missing", detail: "nonce is required for replay protection" };
  if (!m.policyVersion) {
    return { ok: false, error: "policy_version_missing", detail: "policyVersion is required" };
  }

  const s = m.authorityScope;
  if (!s.currency) return { ok: false, error: "currency_missing", detail: "authorityScope.currency is required" };

  const perTx = parseAtomic(s.maxAmountPerTxAtomic);
  const cumulative = parseAtomic(s.maxCumulativeAtomic);
  if (perTx === null || cumulative === null) {
    return {
      ok: false,
      error: "amount_unparseable",
      detail: "maxAmountPerTxAtomic and maxCumulativeAtomic must be integer strings in the asset's minor units",
    };
  }
  if (perTx <= 0n || cumulative <= 0n) {
    return { ok: false, error: "amount_not_positive", detail: "mandate caps must be positive" };
  }
  if (perTx > cumulative) {
    return {
      ok: false,
      error: "per_tx_exceeds_cumulative",
      detail: `per-transaction cap ${s.maxAmountPerTxAtomic} exceeds the cumulative cap ${s.maxCumulativeAtomic}, so the per-tx cap can never bind`,
    };
  }
  if (!Number.isInteger(s.spendingWindowSeconds) || s.spendingWindowSeconds <= 0) {
    return { ok: false, error: "window_invalid", detail: "spendingWindowSeconds must be a positive integer" };
  }
  if (s.requireHumanApprovalAboveAtomic !== undefined && parseAtomic(s.requireHumanApprovalAboveAtomic) === null) {
    return {
      ok: false,
      error: "approval_threshold_unparseable",
      detail: "requireHumanApprovalAboveAtomic must be an integer string",
    };
  }

  const issued = Date.parse(m.issuedAt);
  const expires = Date.parse(m.expiresAt);
  if (!Number.isFinite(expires)) {
    return { ok: false, error: "expiry_invalid", detail: "expiresAt is not a valid ISO 8601 instant" };
  }
  if (Number.isFinite(issued) && expires <= issued) {
    return { ok: false, error: "expiry_before_issue", detail: "expiresAt must be after issuedAt" };
  }
  if (Number.isFinite(issued) && expires - issued > MAX_MANDATE_LIFETIME_MS) {
    return {
      ok: false,
      error: "expiry_invalid",
      detail: `mandate lifetime exceeds the ${MAX_MANDATE_LIFETIME_MS / 86_400_000}-day maximum`,
    };
  }
  if (m.notBefore) {
    const nb = Date.parse(m.notBefore);
    if (Number.isFinite(nb) && nb >= expires) {
      return { ok: false, error: "not_before_after_expiry", detail: "notBefore must precede expiresAt" };
    }
  }

  const coherent = scopeWellFormed(authorityScopeOf(s));
  if (!coherent.ok) return { ok: false, error: "scope_incoherent", detail: coherent.reason };

  return { ok: true };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export type MandateLiveness =
  | { readonly live: true }
  | { readonly live: false; readonly reason: "revoked" | "expired" | "not_yet_valid" | "consumed"; readonly detail: string };

/**
 * Whether the mandate itself is currently usable.
 *
 * Stored status is checked BEFORE the clock: "REVOKED" and "expired by the
 * clock" are different facts an operator needs told apart, and a record that
 * says REVOKED must never be reported as merely expired — the second reads like
 * something that will resolve on its own.
 */
export function mandateLiveness(m: IntentMandate, nowMs: number): MandateLiveness {
  if (m.status === "REVOKED") {
    return { live: false, reason: "revoked", detail: m.revokedReason ?? "mandate was revoked" };
  }
  if (m.status === "CONSUMED") {
    return { live: false, reason: "consumed", detail: "single-use mandate has already been used" };
  }
  if (m.status === "EXPIRED") {
    return { live: false, reason: "expired", detail: "mandate is marked expired" };
  }
  const expires = Date.parse(m.expiresAt);
  if (!Number.isFinite(expires) || nowMs >= expires) {
    return { live: false, reason: "expired", detail: `mandate expired at ${m.expiresAt}` };
  }
  if (m.notBefore) {
    const nb = Date.parse(m.notBefore);
    if (Number.isFinite(nb) && nowMs < nb) {
      return { live: false, reason: "not_yet_valid", detail: `mandate is not valid before ${m.notBefore}` };
    }
  }
  return { live: true };
}

/** Project the mandate's vocabulary onto the chain-intersection vocabulary. */
export function authorityScopeOf(s: MandateAuthorityScope): AuthorityScope {
  return {
    currency: s.currency,
    maxAmountPerTxAtomic: s.maxAmountPerTxAtomic,
    maxCumulativeAtomic: s.maxCumulativeAtomic,
    spendingWindowSeconds: s.spendingWindowSeconds,
    allowedMerchantDomains: s.allowedMerchantDomains,
    allowedCategories: s.allowedCategories,
    allowedRails: s.allowedRails,
    requireHumanApprovalAboveAtomic: s.requireHumanApprovalAboveAtomic,
    allowedJurisdictions: s.allowedJurisdictions,
    blockedJurisdictions: s.blockedJurisdictions,
  };
}

/** Remaining cumulative headroom under this mandate, atomic. Never negative. */
export function remainingCumulative(m: IntentMandate, spentAtomic: Atomic): Atomic {
  const cap = mustParseAtomic(m.authorityScope.maxCumulativeAtomic, "maxCumulativeAtomic");
  const spent = mustParseAtomic(spentAtomic, "spentAtomic");
  const left = cap - spent;
  return (left < 0n ? 0n : left).toString();
}
