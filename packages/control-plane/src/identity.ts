// ---------------------------------------------------------------------------
// Agent identity and the corporate delegation chain (KYA).
//
// THE QUESTION THIS FILE ANSWERS. When an agent presents a payment, "is this
// agent allowed to spend?" is the wrong question, because an agent has no
// authority of its own. The right question is "whose authority is this, and is
// that authority still intact all the way down?" — which is a chain:
//
//     Principal        the legal entity or individual whose money it is (KYC/KYB)
//       └─ Delegation  a scoped grant from the principal to an operator/role
//            └─ Operator   the developer or platform that runs the agent
//                 └─ Agent      one registered agent identity (DID / key)
//                      └─ Session   one attested runtime instance
//
// AUTHORITY IS THE INTERSECTION, NEVER THE UNION. Resolving the chain narrows
// at every hop: a delegation can only grant a subset of the principal's
// authority, an agent only a subset of its delegation, a session only a subset
// of its agent. `resolveAuthority` implements that as an intersection, so no
// link can widen what an ancestor allowed. The alternative — each link carrying
// its own independent limits — means a compromised agent record is a
// self-service permission grant.
//
// A BROKEN LINK IS A DENIAL, NOT A SKIP. A missing operator, an expired
// delegation, a suspended principal: each ends the resolution. The function
// never falls back to the nearest intact ancestor, because "the delegation
// expired so we used the principal's limits" is an unbounded agent.
//
// PURE. No clock of its own, no store, no crypto. `nowMs` is passed in and the
// records are handed to it, so the same chain always resolves the same way and
// every branch below is testable without a database.
// ---------------------------------------------------------------------------

import { mustParseAtomic, parseAtomic, type Atomic } from "./units";

/** Lifecycle shared by every link. Absence of a record is NOT a status — see
 *  `resolveAuthority`, which treats a missing link as a denial. */
export type IdentityStatus = "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";

export interface Principal {
  readonly principalId: string;
  readonly organizationId: string;
  /** "individual" or "entity" — drives which verification applies. */
  readonly kind: "individual" | "entity";
  readonly status: IdentityStatus;
  /** KYC (individual) or KYB (entity) verification outcome. */
  readonly verification: "unverified" | "pending" | "verified" | "rejected";
  readonly createdAt: string;
  readonly revokedAt?: string;
}

/**
 * A scoped grant from a principal to an operator.
 *
 * This is the layer corporate governance actually lives in: an employee who is
 * deprovisioned in the IdP loses their delegation, and every agent beneath it
 * dies with it. Without this link, deprovisioning a human would leave their
 * agents spending.
 */
export interface Delegation {
  readonly delegationId: string;
  readonly principalId: string;
  readonly operatorId: string;
  /** The human or system account this delegation was granted on behalf of. */
  readonly onBehalfOf: string;
  readonly status: IdentityStatus;
  readonly scope: AuthorityScope;
  readonly issuedAt: string;
  /** ISO 8601. A delegation with no expiry is a standing grant and is allowed,
   *  but the policy engine can require one per organization. */
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface Operator {
  readonly operatorId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: IdentityStatus;
  /** Verified domain the operator controls, when one has been attested. */
  readonly domain?: string;
  readonly createdAt: string;
}

/** Runtime attestation quality. Drives policy, not just telemetry. */
export type RuntimeAttestation =
  /** A hardware-attested enclave measurement was verified. */
  | { readonly kind: "tee"; readonly measurement: string }
  /** A passkey/WebAuthn assertion bound the session to a device. */
  | { readonly kind: "passkey"; readonly credentialId: string }
  /** The agent authenticated with a key and nothing more. */
  | { readonly kind: "key_only" }
  /** Nothing was attested. Distinguished from `key_only` deliberately. */
  | { readonly kind: "none" };

export interface Agent {
  readonly agentId: string;
  readonly principalId: string;
  readonly operatorId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: IdentityStatus;
  /** W3C DID or `cloudflare.pay` name, when the agent has one. */
  readonly did?: string;
  /** Key id of the agent's signing key — an SPKI fingerprint, not the key. */
  readonly keyId?: string;
  /** Narrows the delegation further. Never widens it. */
  readonly scope: AuthorityScope;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly status: IdentityStatus;
  readonly attestation: RuntimeAttestation;
  readonly startedAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  /** Per-session narrowing, e.g. a one-task budget. */
  readonly scope?: AuthorityScope;
}

// ── Authority scope ────────────────────────────────────────────────────────

/**
 * What a link permits. Every field is a CEILING, and intersection takes the
 * tighter of two.
 *
 * `undefined` means "this link says nothing about that dimension" and inherits
 * the ancestor's value. An EMPTY ARRAY means "nothing is allowed" and is NOT
 * the same thing — collapsing the two is how an allowlist that should have
 * blocked everything ends up unconstrained. Every list operation below keeps
 * them distinct.
 */
export interface AuthorityScope {
  readonly currency?: string;
  readonly maxAmountPerTxAtomic?: Atomic;
  readonly maxCumulativeAtomic?: Atomic;
  readonly spendingWindowSeconds?: number;
  readonly allowedMerchantDomains?: readonly string[];
  readonly allowedCategories?: readonly string[];
  readonly allowedRails?: readonly string[];
  readonly requireHumanApprovalAboveAtomic?: Atomic;
  /** Minimum attestation the session must carry. */
  readonly minAttestation?: RuntimeAttestation["kind"];
  readonly allowedJurisdictions?: readonly string[];
  readonly blockedJurisdictions?: readonly string[];
}

const ATTESTATION_RANK: Record<RuntimeAttestation["kind"], number> = {
  none: 0,
  key_only: 1,
  passkey: 2,
  tee: 3,
};

export function attestationRank(kind: RuntimeAttestation["kind"]): number {
  return ATTESTATION_RANK[kind];
}

/** Tighter of two optional ceilings: whichever is smaller wins. */
function minCeiling(a: Atomic | undefined, b: Atomic | undefined): Atomic | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return mustParseAtomic(a, "ceiling") <= mustParseAtomic(b, "ceiling") ? a : b;
}

function minNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Intersect two allowlists.
 *
 * `undefined ∩ X = X` (the silent side constrains nothing), and once either
 * side is a list the result is the set intersection — so a child can only ever
 * name values its parent already named. An empty result is retained as an empty
 * array, which correctly denies everything.
 */
function intersectAllow(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): readonly string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const set = new Set(a);
  return b.filter((v) => set.has(v));
}

/** Union two blocklists: anything either side blocks stays blocked. */
function unionBlock(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): readonly string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return [...new Set([...a, ...b])];
}

/**
 * Narrow `parent` by `child`. The result never permits more than `parent`.
 *
 * Currency is the one field where a mismatch is a CONFLICT rather than a
 * narrowing: two different currencies do not intersect to one of them, they
 * intersect to nothing. Returning either would let a child re-denominate its
 * parent's cap, so the caller is told the chain is inconsistent.
 */
export function narrowScope(
  parent: AuthorityScope,
  child: AuthorityScope | undefined
): { ok: true; scope: AuthorityScope } | { ok: false; conflict: string } {
  if (!child) return { ok: true, scope: parent };

  if (parent.currency && child.currency && parent.currency !== child.currency) {
    return {
      ok: false,
      conflict: `currency ${child.currency} is not permitted by the parent scope (${parent.currency})`,
    };
  }

  const parentAttest = parent.minAttestation;
  const childAttest = child.minAttestation;
  const minAttestation =
    parentAttest === undefined
      ? childAttest
      : childAttest === undefined
        ? parentAttest
        : // Stricter wins — a child may raise the bar, never lower it.
          ATTESTATION_RANK[childAttest] > ATTESTATION_RANK[parentAttest]
          ? childAttest
          : parentAttest;

  return {
    ok: true,
    scope: {
      currency: child.currency ?? parent.currency,
      maxAmountPerTxAtomic: minCeiling(parent.maxAmountPerTxAtomic, child.maxAmountPerTxAtomic),
      maxCumulativeAtomic: minCeiling(parent.maxCumulativeAtomic, child.maxCumulativeAtomic),
      spendingWindowSeconds: minNumber(parent.spendingWindowSeconds, child.spendingWindowSeconds),
      allowedMerchantDomains: intersectAllow(
        parent.allowedMerchantDomains,
        child.allowedMerchantDomains
      ),
      allowedCategories: intersectAllow(parent.allowedCategories, child.allowedCategories),
      allowedRails: intersectAllow(parent.allowedRails, child.allowedRails),
      // The APPROVAL THRESHOLD IS ALSO A MINIMUM, which is easy to get
      // backwards. A lower threshold means MORE payments need a human, so
      // taking the minimum is the conservative direction; taking the maximum
      // would let a child raise the bar and escape approval its parent wanted.
      requireHumanApprovalAboveAtomic: minCeiling(
        parent.requireHumanApprovalAboveAtomic,
        child.requireHumanApprovalAboveAtomic
      ),
      minAttestation,
      allowedJurisdictions: intersectAllow(parent.allowedJurisdictions, child.allowedJurisdictions),
      blockedJurisdictions: unionBlock(parent.blockedJurisdictions, child.blockedJurisdictions),
    },
  };
}

// ── Chain resolution ───────────────────────────────────────────────────────

export type ChainBreak =
  | "principal_missing"
  | "principal_inactive"
  | "principal_unverified"
  | "delegation_missing"
  | "delegation_inactive"
  | "delegation_expired"
  | "delegation_principal_mismatch"
  | "operator_missing"
  | "operator_inactive"
  | "operator_delegation_mismatch"
  | "agent_missing"
  | "agent_inactive"
  | "agent_expired"
  | "agent_principal_mismatch"
  | "agent_operator_mismatch"
  | "session_inactive"
  | "session_expired"
  | "session_agent_mismatch"
  | "attestation_insufficient"
  | "scope_conflict";

export interface ResolvedAuthority {
  readonly principalId: string;
  readonly organizationId: string;
  readonly delegationId: string;
  readonly operatorId: string;
  readonly agentId: string;
  readonly sessionId?: string;
  /** The intersected ceiling every downstream check evaluates against. */
  readonly scope: AuthorityScope;
  readonly attestation: RuntimeAttestation["kind"];
  /** Ordered link ids, for the evidence bundle's delegation trail. */
  readonly chain: readonly string[];
}

export type AuthorityResolution =
  | { readonly ok: true; readonly authority: ResolvedAuthority }
  | { readonly ok: false; readonly break: ChainBreak; readonly detail: string };

export interface ResolveAuthorityInput {
  readonly principal: Principal | null;
  readonly delegation: Delegation | null;
  readonly operator: Operator | null;
  readonly agent: Agent | null;
  /** Optional: an agent may act without a registered session. */
  readonly session?: AgentSession | null;
  readonly nowMs: number;
  /**
   * Whether the principal must have completed verification.
   *
   * Configurable because a sandbox organization legitimately has not, and
   * refusing there would make the sandbox untestable. In production this is
   * true and the API layer passes it as such.
   */
  readonly requireVerifiedPrincipal: boolean;
}

function expired(iso: string | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && nowMs >= at;
}

/**
 * Walk the chain and return the intersected authority, or the first break.
 *
 * ORDER IS DELIBERATE: ancestors before descendants, existence before
 * lifecycle, lifecycle before linkage, linkage before scope. A revoked
 * principal must never produce "attestation_insufficient" as its reason,
 * because that reason invites the caller to go and fix the attestation.
 */
export function resolveAuthority(input: ResolveAuthorityInput): AuthorityResolution {
  const { principal, delegation, operator, agent, session, nowMs } = input;

  if (!principal) return { ok: false, break: "principal_missing", detail: "no principal record" };
  if (principal.status !== "ACTIVE") {
    return { ok: false, break: "principal_inactive", detail: `principal is ${principal.status}` };
  }
  if (input.requireVerifiedPrincipal && principal.verification !== "verified") {
    return {
      ok: false,
      break: "principal_unverified",
      detail: `principal verification is ${principal.verification}`,
    };
  }

  if (!delegation) return { ok: false, break: "delegation_missing", detail: "no delegation record" };
  if (delegation.principalId !== principal.principalId) {
    return {
      ok: false,
      break: "delegation_principal_mismatch",
      detail: "delegation belongs to a different principal",
    };
  }
  if (delegation.status !== "ACTIVE") {
    return { ok: false, break: "delegation_inactive", detail: `delegation is ${delegation.status}` };
  }
  if (expired(delegation.expiresAt, nowMs)) {
    return { ok: false, break: "delegation_expired", detail: `delegation expired at ${delegation.expiresAt}` };
  }

  if (!operator) return { ok: false, break: "operator_missing", detail: "no operator record" };
  if (operator.operatorId !== delegation.operatorId) {
    return {
      ok: false,
      break: "operator_delegation_mismatch",
      detail: "operator is not the one this delegation names",
    };
  }
  if (operator.status !== "ACTIVE") {
    return { ok: false, break: "operator_inactive", detail: `operator is ${operator.status}` };
  }

  if (!agent) return { ok: false, break: "agent_missing", detail: "no agent record" };
  if (agent.principalId !== principal.principalId) {
    return {
      ok: false,
      break: "agent_principal_mismatch",
      detail: "agent belongs to a different principal",
    };
  }
  if (agent.operatorId !== operator.operatorId) {
    return {
      ok: false,
      break: "agent_operator_mismatch",
      detail: "agent is not operated by the delegated operator",
    };
  }
  if (agent.status !== "ACTIVE") {
    return { ok: false, break: "agent_inactive", detail: `agent is ${agent.status}` };
  }
  if (expired(agent.expiresAt, nowMs)) {
    return { ok: false, break: "agent_expired", detail: `agent expired at ${agent.expiresAt}` };
  }

  let attestation: RuntimeAttestation["kind"] = "key_only";
  if (session) {
    if (session.agentId !== agent.agentId) {
      return {
        ok: false,
        break: "session_agent_mismatch",
        detail: "session belongs to a different agent",
      };
    }
    if (session.status !== "ACTIVE") {
      return { ok: false, break: "session_inactive", detail: `session is ${session.status}` };
    }
    if (expired(session.expiresAt, nowMs)) {
      return { ok: false, break: "session_expired", detail: `session expired at ${session.expiresAt}` };
    }
    attestation = session.attestation.kind;
  }

  // Intersect: delegation ⊓ agent ⊓ session.
  let scope = delegation.scope;
  for (const [label, child] of [
    ["agent", agent.scope],
    ["session", session?.scope],
  ] as const) {
    const narrowed = narrowScope(scope, child ?? undefined);
    if (!narrowed.ok) {
      return { ok: false, break: "scope_conflict", detail: `${label}: ${narrowed.conflict}` };
    }
    scope = narrowed.scope;
  }

  if (scope.minAttestation && ATTESTATION_RANK[attestation] < ATTESTATION_RANK[scope.minAttestation]) {
    return {
      ok: false,
      break: "attestation_insufficient",
      detail: `scope requires ${scope.minAttestation} attestation, session presented ${attestation}`,
    };
  }

  return {
    ok: true,
    authority: {
      principalId: principal.principalId,
      organizationId: principal.organizationId,
      delegationId: delegation.delegationId,
      operatorId: operator.operatorId,
      agentId: agent.agentId,
      sessionId: session?.sessionId,
      scope,
      attestation,
      chain: [
        principal.principalId,
        delegation.delegationId,
        operator.operatorId,
        agent.agentId,
        ...(session ? [session.sessionId] : []),
      ],
    },
  };
}

/** True when a scope's numeric ceilings are internally coherent. Used at write
 *  time so an incoherent scope is rejected before it can be relied upon. */
export function scopeWellFormed(scope: AuthorityScope): { ok: true } | { ok: false; reason: string } {
  const perTx = scope.maxAmountPerTxAtomic;
  const cumulative = scope.maxCumulativeAtomic;
  if (perTx !== undefined && parseAtomic(perTx) === null) {
    return { ok: false, reason: "maxAmountPerTxAtomic is not an integer amount" };
  }
  if (cumulative !== undefined && parseAtomic(cumulative) === null) {
    return { ok: false, reason: "maxCumulativeAtomic is not an integer amount" };
  }
  if (perTx !== undefined && mustParseAtomic(perTx, "perTx") <= 0n) {
    return { ok: false, reason: "maxAmountPerTxAtomic must be positive" };
  }
  if (cumulative !== undefined && mustParseAtomic(cumulative, "cumulative") <= 0n) {
    return { ok: false, reason: "maxCumulativeAtomic must be positive" };
  }
  if (
    perTx !== undefined &&
    cumulative !== undefined &&
    mustParseAtomic(perTx, "perTx") > mustParseAtomic(cumulative, "cumulative")
  ) {
    return {
      ok: false,
      reason: "maxAmountPerTxAtomic exceeds maxCumulativeAtomic, so the per-tx cap can never bind",
    };
  }
  if (
    scope.spendingWindowSeconds !== undefined &&
    (!Number.isInteger(scope.spendingWindowSeconds) || scope.spendingWindowSeconds <= 0)
  ) {
    return { ok: false, reason: "spendingWindowSeconds must be a positive integer" };
  }
  const threshold = scope.requireHumanApprovalAboveAtomic;
  if (threshold !== undefined && parseAtomic(threshold) === null) {
    return { ok: false, reason: "requireHumanApprovalAboveAtomic is not an integer amount" };
  }
  return { ok: true };
}
