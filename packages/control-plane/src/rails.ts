// ---------------------------------------------------------------------------
// The rail port, and the router that chooses between rails.
//
// WHY THIS IS A SEPARATE PORT FROM lib/providers/types.ts. That boundary models
// a PROVIDER — an on-ramp, an off-ramp, a bank, a card issuer — and its rules
// are the right ones. This boundary models a RAIL: the path a specific payment
// takes to reach a specific recipient. One provider can offer several rails
// (Circle offers CCTP and a bank transfer), and one rail can be served by
// several providers. Collapsing them means the router cannot express "USDC over
// Base" as a choice distinct from "whoever Circle is today".
//
// THE FOUR RULES FROM providers/types.ts APPLY HERE UNCHANGED, and are repeated
// because the temptation to break them is the same:
//
//   1. QUOTE AND EXECUTE ARE SEPARATE. A quote has an expiry and no obligation.
//   2. STATUS IS PULLED, NOT ONLY PUSHED. `getStatus` is mandatory. A webhook
//      that never arrives is normal.
//   3. AN ADAPTER MAPS, IT DOES NOT DECIDE. No ledger posting, no policy, no
//      choosing a fallback rail. Those live above this line.
//   4. THE RAIL IS NEVER ASKED WHETHER THE CUSTOMER CAN AFFORD IT. We answer
//      that from our own ledger and policy engine.
//
// AND ONE RULE SPECIFIC TO RAILS:
//
//   5. A RAIL NEVER HOLDS A KEY. `execute` receives an EXECUTION TOKEN issued by
//      the control plane and redeemed against the signing plane. An adapter that
//      took a private key, or that could produce a signature itself, would move
//      the trust boundary from the enclave into the adapter — and there are a
//      dozen adapters.
//
// FAILOVER IS A PRE-COMMITMENT DECISION ONLY. Once `execute` has been called,
// "it failed" and "it succeeded and the response was lost" are indistinguishable
// from here. Re-issuing against a second rail is how a recipient is paid twice
// with no way to recover the second payment. `assertFailoverAllowed` refuses on
// any phase where value may already be committed — the same stance
// providers/router.ts takes, for the same reason.
// ---------------------------------------------------------------------------

import { bps } from "./drift";
import { mustParseAtomic, type Atomic } from "./units";

export type RailKind = "stablecoin" | "card" | "bank" | "x402" | "mpp";

/** Settlement finality, as a property of the rail rather than a latency guess. */
export type Finality =
  /** Irreversible once included. Stablecoins at the required depth. */
  | "irreversible"
  /** Reversible by the network's own rules for a bounded period (ACH, cards). */
  | "revocable"
  /** Held in escrow pending release — x402 deferred settlement. */
  | "escrowed";

export interface RailCapability {
  readonly railId: string;
  readonly kind: RailKind;
  readonly displayName: string;
  /** Networks this rail can deliver on. */
  readonly networks: readonly string[];
  readonly assets: readonly string[];
  /** ISO-3166 alpha-2 destinations. Empty = unrestricted. */
  readonly countries: readonly string[];
  readonly minAmountAtomic: Atomic;
  readonly maxAmountAtomic: Atomic;
  readonly finality: Finality;
  /** Typical time to the finality this rail offers. */
  readonly expectedSettlementSeconds: number;
  /** Fixed fee the rail charges, atomic, in the payment asset. */
  readonly fixedFeeAtomic: Atomic;
  /** Variable fee in basis points of the amount. */
  readonly variableFeeBps: number;
  /** True when the rail can hold funds pending verification before release. */
  readonly supportsDeferredSettlement: boolean;
  /** True when the rail can be reversed by us after settlement. */
  readonly supportsReversal: boolean;
}

// ── Quote / authorize / execute ────────────────────────────────────────────

export interface RailQuoteRequest {
  readonly paymentId: string;
  readonly amountAtomic: Atomic;
  readonly asset: string;
  readonly networkId: string;
  readonly destination: string;
  readonly destinationCountry?: string;
  /** Idempotency for the quote itself, so a retried quote is the same quote. */
  readonly requestId: string;
}

export interface RailQuote {
  readonly railId: string;
  /** Opaque to us. Handed back at execute so the price is honoured. */
  readonly railQuoteId: string;
  readonly amountAtomic: Atomic;
  readonly feeAtomic: Atomic;
  /** Amount + fee. Stated by the adapter so we never re-derive it. */
  readonly totalDebitAtomic: Atomic;
  readonly asset: string;
  readonly networkId: string;
  readonly expiresAt: string;
  readonly expectedSettlementSeconds: number;
  readonly finality: Finality;
}

/**
 * The control plane's permission for one execution, redeemed at the signer.
 *
 * `payloadHash` is what makes this token narrow: the signing plane will only
 * sign a payload whose hash matches, so a token stolen in flight cannot be
 * redeemed for a different transfer. A bearer token with no payload binding is a
 * bearer instrument.
 */
export interface ExecutionToken {
  readonly tokenId: string;
  readonly paymentId: string;
  readonly railId: string;
  readonly railQuoteId: string;
  /** Hash of the exact payload the signer may sign. */
  readonly payloadHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Single-use. The signing plane burns it. */
  readonly nonce: string;
}

export interface RailAuthorizeRequest {
  readonly paymentId: string;
  readonly quote: RailQuote;
  readonly destination: string;
  readonly idempotencyKey: string;
}

export interface RailAuthorization {
  readonly railId: string;
  /** The rail's own reference for the authorization. */
  readonly railRef: string;
  /** The exact bytes that must be signed, hex. Never a key, never a signature. */
  readonly payloadHex: string;
  readonly payloadHash: string;
  readonly expiresAt: string;
}

export interface RailExecuteRequest {
  readonly paymentId: string;
  readonly authorization: RailAuthorization;
  readonly executionToken: ExecutionToken;
  /** Signature produced by the signing plane over `payloadHash`. */
  readonly signatureHex: string;
  readonly idempotencyKey: string;
}

export type SettlementState =
  | "SUBMITTED"
  | "PENDING"
  | "ESCROWED"
  | "SETTLED"
  | "FAILED"
  /** The outcome is genuinely unknown. MUST reach a status poll, never a retry. */
  | "INDETERMINATE";

export interface RailSettlement {
  readonly railId: string;
  readonly railRef: string;
  readonly state: SettlementState;
  /** On-chain hash or provider settlement id. Evidence, not decoration. */
  readonly settlementRef?: string;
  readonly explorerUrl?: string;
  readonly settledAt?: string;
  readonly feeAtomic?: Atomic;
  readonly failureReason?: string;
  /** The rail's own status string, verbatim, for support and audit. */
  readonly railStatus: string;
}

export class RailError extends Error {
  constructor(
    readonly railId: string,
    message: string,
    readonly opts: { retryable?: boolean; indeterminate?: boolean } = {}
  ) {
    super(message);
    this.name = "RailError";
  }
}

/** A rail. Every method maps; none decides. */
export interface PaymentRail {
  readonly capability: RailCapability;
  quote(request: RailQuoteRequest): Promise<RailQuote>;
  /** Prepare the payload. Produces bytes to sign — never a signature. */
  authorize(request: RailAuthorizeRequest): Promise<RailAuthorization>;
  /** Submit. Idempotent on `idempotencyKey`. */
  execute(request: RailExecuteRequest): Promise<RailSettlement>;
  getStatus(railRef: string): Promise<RailSettlement>;
}

// ── Registry ───────────────────────────────────────────────────────────────

export class RailRegistry {
  private readonly rails = new Map<string, PaymentRail>();

  register(rail: PaymentRail): void {
    const id = rail.capability.railId;
    if (this.rails.has(id)) {
      // Two rails answering one id makes selection order-dependent, and which
      // one moved the money unanswerable afterwards.
      throw new Error(`Rail "${id}" is already registered.`);
    }
    this.rails.set(id, rail);
  }

  get(railId: string): PaymentRail | undefined {
    return this.rails.get(railId);
  }

  list(): readonly PaymentRail[] {
    return [...this.rails.values()];
  }

  capabilities(): readonly RailCapability[] {
    return this.list().map((r) => r.capability);
  }

  clear(): void {
    this.rails.clear();
  }
}

// ── Health ─────────────────────────────────────────────────────────────────

export type RailHealthState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface RailHealth {
  readonly railId: string;
  readonly state: RailHealthState;
  readonly observedAt: string;
  readonly detail?: string;
  /** Operator override. Outranks observed health in BOTH directions. */
  readonly operatorPaused?: boolean;
}

// ── Selection ──────────────────────────────────────────────────────────────

export type RouteRejection =
  | "asset_unsupported"
  | "network_unsupported"
  | "country_unsupported"
  | "below_minimum"
  | "above_maximum"
  | "not_in_policy_allowlist"
  | "finality_insufficient"
  | "rail_unavailable"
  | "rail_paused"
  | "escrow_required_unsupported";

export interface RouteCandidate {
  readonly railId: string;
  readonly quote: RailQuote;
  /** Integer score, higher is better. Deterministic — see `scoreRoute`. */
  readonly score: number;
  readonly breakdown: {
    readonly costScore: number;
    readonly latencyScore: number;
    readonly finalityScore: number;
    readonly healthScore: number;
    readonly preferenceScore: number;
  };
}

export interface RouteRejected {
  readonly railId: string;
  readonly reason: RouteRejection;
  readonly detail: string;
}

export interface RouteSelection {
  readonly selected: RouteCandidate | null;
  /** Ranked, best first. The selected one is `ranked[0]`. */
  readonly ranked: readonly RouteCandidate[];
  /** Why each excluded rail was excluded. An operator asking "why B?" gets this. */
  readonly rejected: readonly RouteRejected[];
}

export interface RouteConstraints {
  readonly amountAtomic: Atomic;
  readonly asset: string;
  readonly networkId: string;
  readonly destinationCountry?: string;
  /** Rails the mandate/policy permits. Empty array = none. Absent = all. */
  readonly allowedRails?: readonly string[];
  /** Ordered caller preference. Earlier entries score higher. */
  readonly preferredRails?: readonly string[];
  /** Minimum finality the payment requires. */
  readonly requiredFinality?: Finality;
  /** True when the payment must be held before release (x402 deferred). */
  readonly requireEscrow?: boolean;
}

const FINALITY_RANK: Record<Finality, number> = { revocable: 1, escrowed: 2, irreversible: 3 };

/**
 * Score one candidate. Integers only.
 *
 * WEIGHTS ARE EXPLICIT AND THE AXES ARE NORMALISED TO 0–100 EACH, because a
 * score is only useful if a human can reconstruct it. `breakdown` is returned
 * alongside so an operator asking "why was the cheaper rail not chosen?" can
 * read the answer rather than infer it.
 *
 * Cost is normalised against `worstFeeAtomic` — the most expensive candidate in
 * this selection — rather than against an absolute scale, because "expensive"
 * only means anything relative to the alternatives available for this payment.
 */
export function scoreRoute(input: {
  readonly quote: RailQuote;
  readonly worstFeeAtomic: Atomic;
  readonly slowestSeconds: number;
  readonly health: RailHealthState;
  readonly preferenceIndex: number;
  readonly preferenceCount: number;
}): RouteCandidate["breakdown"] & { total: number } {
  const fee = mustParseAtomic(input.quote.feeAtomic, "feeAtomic");
  const worst = mustParseAtomic(input.worstFeeAtomic, "worstFeeAtomic");

  // 100 when cheapest, 0 when the most expensive. Equal fees all score 100.
  const costScore = worst === 0n ? 100 : 100 - Math.round(bps(fee, worst) / 100);

  const slowest = Math.max(1, input.slowestSeconds);
  const latencyScore =
    100 - Math.round((Math.min(input.quote.expectedSettlementSeconds, slowest) / slowest) * 100);

  const finalityScore = FINALITY_RANK[input.quote.finality] * 33;

  const healthScore =
    input.health === "healthy" ? 100 : input.health === "unknown" ? 60 : input.health === "degraded" ? 30 : 0;

  const preferenceScore =
    input.preferenceIndex < 0 || input.preferenceCount === 0
      ? 0
      : Math.round(((input.preferenceCount - input.preferenceIndex) / input.preferenceCount) * 100);

  // Health is weighted highest: the cheapest rail that is down costs more than
  // any fee difference, because a failed execution on a money path is an
  // incident rather than a retry.
  const total =
    healthScore * 4 + costScore * 3 + latencyScore * 2 + finalityScore * 2 + preferenceScore * 3;

  return { costScore, latencyScore, finalityScore, healthScore, preferenceScore, total };
}

/**
 * Filter rails against the constraints. Pure — no quoting, no network.
 *
 * Separated from scoring so the eligibility answer is available without paying
 * for a quote from every rail, and so the rejection reasons are produced by the
 * same function whether or not a quote was ever obtained.
 */
export function eligibleRails(input: {
  readonly capabilities: readonly RailCapability[];
  readonly constraints: RouteConstraints;
  readonly health: ReadonlyMap<string, RailHealth>;
}): { readonly eligible: readonly RailCapability[]; readonly rejected: readonly RouteRejected[] } {
  const { constraints: c } = input;
  const amount = mustParseAtomic(c.amountAtomic, "amountAtomic");
  const eligible: RailCapability[] = [];
  const rejected: RouteRejected[] = [];
  const reject = (railId: string, reason: RouteRejection, detail: string) =>
    rejected.push({ railId, reason, detail });

  for (const cap of input.capabilities) {
    // An EMPTY allowlist denies everything; an ABSENT one constrains nothing.
    // The two are different and the policy layer relies on the distinction.
    if (c.allowedRails !== undefined && !c.allowedRails.includes(cap.railId)) {
      reject(cap.railId, "not_in_policy_allowlist", "rail is not in the mandate's allowed rails");
      continue;
    }
    if (!cap.assets.map((a) => a.toUpperCase()).includes(c.asset.toUpperCase())) {
      reject(cap.railId, "asset_unsupported", `${cap.displayName} does not carry ${c.asset}`);
      continue;
    }
    if (!cap.networks.includes(c.networkId)) {
      reject(cap.railId, "network_unsupported", `${cap.displayName} does not deliver on ${c.networkId}`);
      continue;
    }
    if (
      c.destinationCountry &&
      cap.countries.length > 0 &&
      !cap.countries.includes(c.destinationCountry)
    ) {
      reject(cap.railId, "country_unsupported", `${cap.displayName} does not serve ${c.destinationCountry}`);
      continue;
    }
    if (amount < mustParseAtomic(cap.minAmountAtomic, "minAmountAtomic")) {
      reject(cap.railId, "below_minimum", `amount is below ${cap.displayName}'s minimum`);
      continue;
    }
    if (amount > mustParseAtomic(cap.maxAmountAtomic, "maxAmountAtomic")) {
      reject(cap.railId, "above_maximum", `amount exceeds ${cap.displayName}'s maximum`);
      continue;
    }
    if (c.requiredFinality && FINALITY_RANK[cap.finality] < FINALITY_RANK[c.requiredFinality]) {
      reject(
        cap.railId,
        "finality_insufficient",
        `${cap.displayName} offers ${cap.finality} finality; ${c.requiredFinality} is required`
      );
      continue;
    }
    if (c.requireEscrow && !cap.supportsDeferredSettlement) {
      reject(
        cap.railId,
        "escrow_required_unsupported",
        `${cap.displayName} cannot hold funds pending verification, which this payment requires`
      );
      continue;
    }

    const h = input.health.get(cap.railId);
    if (h?.operatorPaused) {
      reject(cap.railId, "rail_paused", h.detail ?? "paused by an operator");
      continue;
    }
    if (h?.state === "unavailable") {
      reject(cap.railId, "rail_unavailable", h.detail ?? "rail reports unavailable");
      continue;
    }

    eligible.push(cap);
  }

  return { eligible, rejected };
}

/** Rank quoted candidates. `quotes` must come from `eligibleRails` survivors. */
export function selectRoute(input: {
  readonly quotes: readonly RailQuote[];
  readonly constraints: RouteConstraints;
  readonly health: ReadonlyMap<string, RailHealth>;
  readonly rejected: readonly RouteRejected[];
}): RouteSelection {
  if (input.quotes.length === 0) {
    return { selected: null, ranked: [], rejected: input.rejected };
  }

  let worstFee = 0n;
  let slowest = 1;
  for (const q of input.quotes) {
    const fee = mustParseAtomic(q.feeAtomic, "feeAtomic");
    if (fee > worstFee) worstFee = fee;
    slowest = Math.max(slowest, q.expectedSettlementSeconds);
  }

  const preferred = input.constraints.preferredRails ?? [];
  const candidates: RouteCandidate[] = input.quotes.map((quote) => {
    const scored = scoreRoute({
      quote,
      worstFeeAtomic: worstFee.toString(),
      slowestSeconds: slowest,
      health: input.health.get(quote.railId)?.state ?? "unknown",
      preferenceIndex: preferred.indexOf(quote.railId),
      preferenceCount: preferred.length,
    });
    const { total, ...breakdown } = scored;
    return { railId: quote.railId, quote, score: total, breakdown };
  });

  // Ties break on railId so selection is stable across calls. An unstable
  // tiebreak means two identical requests can route differently, which makes an
  // incident impossible to reproduce.
  const ranked = [...candidates].sort((a, b) =>
    b.score === a.score ? (a.railId < b.railId ? -1 : 1) : b.score - a.score
  );

  return { selected: ranked[0], ranked, rejected: input.rejected };
}

/**
 * Whether the AUTHORIZATION permits trying a different rail at all.
 *
 * Two independent conditions have to hold before a second rail is touched, and
 * they fail for different reasons, so they are separate functions:
 *
 *   1. The authorization must have permitted cross-rail fallback in the first
 *      place (this function). A mandate naming `allowed_rails: ["stablecoin"]`
 *      did not authorize a card payment, and a stablecoin outage does not
 *      change what it authorized. A router that reaches for an available card
 *      here has silently widened the principal's grant — which is the single
 *      most dangerous thing a routing layer can do, because it looks like
 *      resilience.
 *
 *   2. Nothing can already be committed (`assertFailoverAllowed`).
 *
 * DEFAULT IS DENY. `failoverPolicy` absent means no fallback. An opt-out would
 * make the safe behaviour the one somebody has to remember.
 */
export type FailoverPolicy =
  /** No second rail, ever. The payment fails and the caller decides. */
  | { readonly mode: "none" }
  /** Only these rails, and only if the mandate also allows them. */
  | { readonly mode: "explicit"; readonly rails: readonly string[] };

export type FailoverAuthorization =
  | { readonly permitted: true; readonly candidates: readonly string[] }
  | { readonly permitted: false; readonly reason: string };

/**
 * Resolve which rails a failover may consider.
 *
 * The result is the INTERSECTION of the failover policy and the mandate's
 * allowlist, never the union. `allowedRails === undefined` means the mandate did
 * not constrain rails, so the policy's list stands on its own; an EMPTY
 * `allowedRails` array means the mandate allows no rail and the intersection is
 * correctly empty.
 */
export function authorizeFailover(input: {
  readonly policy: FailoverPolicy | undefined;
  readonly allowedRails: readonly string[] | undefined;
  readonly failedRailId: string;
}): FailoverAuthorization {
  const policy = input.policy ?? { mode: "none" };
  if (policy.mode === "none") {
    return {
      permitted: false,
      reason:
        "the authorization did not permit cross-rail fallback; a rail outage does not widen what the principal granted",
    };
  }

  const fromPolicy = policy.rails.filter((r) => r !== input.failedRailId);
  const candidates =
    input.allowedRails === undefined
      ? fromPolicy
      : fromPolicy.filter((r) => input.allowedRails!.includes(r));

  if (candidates.length === 0) {
    return {
      permitted: false,
      reason:
        input.allowedRails === undefined
          ? `the failover policy names no rail other than ${input.failedRailId}`
          : `no rail is in both the failover policy and the mandate's allowed rails`,
    };
  }
  return { permitted: true, candidates };
}

/**
 * Whether a second rail may be tried after a failure, given the settlement state.
 *
 * Allowed only where nothing can have been committed. `INDETERMINATE` is the
 * important entry: it looks like a failure and may be a success, so it must
 * reach a status poll.
 */
export function assertFailoverAllowed(state: SettlementState): void {
  if (state === "SUBMITTED" || state === "PENDING" || state === "ESCROWED" || state === "SETTLED") {
    throw new RailError(
      "router",
      `Failover refused: the payment is ${state}, so value may already be committed. ` +
        `Re-issuing on another rail risks paying the recipient twice with no recovery. Poll getStatus instead.`
    );
  }
  if (state === "INDETERMINATE") {
    throw new RailError(
      "router",
      "Failover refused: the outcome is INDETERMINATE. 'Failed' and 'succeeded, response lost' are " +
        "indistinguishable from here — this must reach a status poll, never a retry."
    );
  }
}
