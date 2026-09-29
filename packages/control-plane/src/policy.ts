// ---------------------------------------------------------------------------
// The deterministic policy engine.
//
// ONE FUNCTION DECIDES WHETHER MONEY MAY MOVE, AND IT IS PURE.
//
// Everything expensive has already happened by the time `evaluatePolicy` is
// called: the chain was resolved, the revocation store was read, the recipient
// was verified, the drift engine scored the sequence, the clock was read. All of
// those are handed in as VALUES. The consequence is the property that matters
// most about this file — the authorization decision is a function of its inputs,
// so it is reproducible, exhaustively testable, explainable to a customer, and
// defensible to a regulator. A decision that cannot be replayed cannot be
// audited, and an unauditable money decision is a liability whatever its
// accuracy.
//
// AN LLM IS NEVER ON THIS PATH. Not as a judge, not as a tiebreak, not as a
// "confidence" input. A model that can be talked into an answer by the same
// prompt injection that produced the payment is not a control, and a model whose
// output varies run to run cannot produce the reproducibility above. The agent
// PROPOSES; this function DECIDES. Semantic signals, if they ever arrive, arrive
// as one more weighted entry in the drift engine — data feeding a deterministic
// rule, never authority over it.
//
// THREE OUTCOMES, AND THE MIDDLE ONE IS NOT A SOFTENED DENY:
//
//     ALLOW  every check passed; execution may proceed.
//     HOLD   the decision needs a human, or a risk signal needs review. The
//            payment is parked and RECOVERABLE.
//     DENY   refused. Terminal.
//
// HOLD exists because the alternative to it is worse in both directions: denying
// everything suspicious makes the product unusable, and allowing everything
// merely-suspicious makes the controls decorative.
//
// ORDER IS THE SECURITY PROPERTY, NOT A STYLE CHOICE. Liveness before limits,
// limits before risk, risk before approval. A revoked mandate must never produce
// "approval required" as its reason, because that reason invites the caller to go
// and get an approval for authority that no longer exists — and a caller who
// obtains one has been told by our own API that it would help.
//
// CHECKS THAT COULD NOT RUN ARE DENIALS. `evaluatePolicy` takes the revocation
// verdict and the recipient verdict as required inputs rather than optional ones,
// so there is no shape of this call in which a check was skipped and the payment
// was allowed anyway.
// ---------------------------------------------------------------------------

import type { DriftAssessment } from "./drift";
import type { AuthorityScope, ResolvedAuthority } from "./identity";
import type { IntentMandate, MandateLiveness, RailId } from "./mandate";
import type { RecipientVerdict } from "./recipient";
import type { RevocationVerdict } from "./revocation";
import { mustParseAtomic, parseAtomic, type Atomic } from "./units";

// ── The policy record ──────────────────────────────────────────────────────

/** A rule set attached to an organization, principal, or agent. Versioned:
 *  a decision records WHICH version produced it, so a later edit cannot make a
 *  past decision look like it followed rules that did not exist yet. */
export interface PolicyDocument {
  readonly policyId: string;
  readonly organizationId: string;
  /** Monotonic per policyId. Part of every decision record. */
  readonly version: number;
  readonly name: string;
  readonly status: "ACTIVE" | "DISABLED";

  readonly amount?: {
    readonly maxPerTransactionAtomic?: Atomic;
    readonly maxHourlyAtomic?: Atomic;
    readonly maxDailyAtomic?: Atomic;
    readonly maxMonthlyAtomic?: Atomic;
  };

  readonly currency?: {
    /** Empty = none allowed. Absent = unconstrained. */
    readonly allowed?: readonly string[];
    readonly blocked?: readonly string[];
  };

  readonly merchant?: {
    readonly allowedDomains?: readonly string[];
    readonly blockedDomains?: readonly string[];
    readonly allowedMccs?: readonly string[];
    readonly blockedMccs?: readonly string[];
    readonly allowedRecipientIds?: readonly string[];
    readonly blockedRecipientIds?: readonly string[];
    /** Contract addresses a stablecoin payment may interact with. */
    readonly allowedContracts?: readonly string[];
  };

  readonly rails?: {
    readonly allowed?: readonly RailId[];
    readonly blocked?: readonly RailId[];
  };

  readonly approval?: {
    readonly requiredAboveAtomic?: Atomic;
    readonly requiredForNewRecipient?: boolean;
    readonly requiredForNewRail?: boolean;
    readonly approverRole?: string;
    readonly timeoutSeconds?: number;
    /** Fail-closed by type: there is no ALLOW to choose here. */
    readonly onTimeout?: "HOLD" | "DENY";
  };

  readonly geography?: {
    readonly allowedJurisdictions?: readonly string[];
    readonly blockedJurisdictions?: readonly string[];
  };

  readonly time?: {
    readonly activeFrom?: string;
    readonly activeUntil?: string;
    /** UTC hours [0..23] during which payments may be initiated. */
    readonly allowedHoursUtc?: readonly number[];
    readonly allowedDaysUtc?: readonly number[];
  };

  readonly risk?: {
    /** Drift score at or above which this policy holds. Overrides the default. */
    readonly holdScore?: number;
    readonly denyScore?: number;
    /** Hold when the recipient check reported a first use of this recipient. */
    readonly holdOnFirstUse?: boolean;
    /** Minimum runtime attestation. */
    readonly minAttestation?: "none" | "key_only" | "passkey" | "tee";
  };
}

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Spend already recorded against each accounting window, atomic. */
export interface WindowExposure {
  readonly perTransactionAtomic?: never;
  readonly hourlyAtomic: Atomic;
  readonly dailyAtomic: Atomic;
  readonly monthlyAtomic: Atomic;
  /** Spend against this mandate's own cumulative window. */
  readonly mandateWindowAtomic: Atomic;
}

export interface CandidateEvaluation {
  readonly amountAtomic: Atomic;
  readonly asset: string;
  readonly currency: string;
  readonly networkId: string;
  readonly railId: RailId;
  readonly recipientId: string;
  readonly merchantDomain?: string;
  readonly mcc?: string;
  readonly category?: string;
  readonly jurisdiction?: string;
  readonly contractAddress?: string;
}

export interface EvaluatePolicyInput {
  readonly authority: ResolvedAuthority;
  readonly mandate: IntentMandate;
  readonly mandateLiveness: MandateLiveness;
  readonly revocation: RevocationVerdict;
  readonly recipient: RecipientVerdict;
  readonly drift: DriftAssessment;
  readonly policies: readonly PolicyDocument[];
  readonly candidate: CandidateEvaluation;
  readonly exposure: WindowExposure;
  /** Whether a valid human approval is already recorded for this payment. */
  readonly approvalPresent: boolean;
  /** True when the rail is one this agent has not used before. */
  readonly railIsNew: boolean;
  readonly nowMs: number;
}

// ── Output ─────────────────────────────────────────────────────────────────

export type PolicyVerdict = "ALLOW" | "HOLD" | "DENY";

export type PolicyCheckId =
  | "revocation"
  | "mandate_liveness"
  | "mandate_agent_binding"
  | "mandate_denomination"
  | "mandate_per_tx"
  | "mandate_cumulative"
  | "scope_merchant"
  | "scope_category"
  | "scope_rail"
  | "scope_jurisdiction"
  | "policy_status"
  | "policy_amount"
  | "policy_currency"
  | "policy_merchant"
  | "policy_rail"
  | "policy_geography"
  | "policy_time"
  | "policy_attestation"
  | "recipient_verification"
  | "drift"
  | "approval";

export interface PolicyCheck {
  readonly id: PolicyCheckId;
  readonly outcome: "pass" | "hold" | "deny" | "not_applicable";
  readonly detail: string;
  /** The policy that produced this outcome, when one did. */
  readonly policyId?: string;
  readonly policyVersion?: number;
}

export interface EscalationRequirement {
  readonly approverRole: string;
  readonly timeoutSeconds: number;
  readonly onTimeout: "HOLD" | "DENY";
  readonly reason: string;
  readonly thresholdAtomic?: Atomic;
}

export interface PolicyDecision {
  readonly verdict: PolicyVerdict;
  /** The first denial, or the reason a hold was placed. Empty on ALLOW. */
  readonly primaryReason?: string;
  readonly checks: readonly PolicyCheck[];
  readonly requiresApproval: boolean;
  readonly escalation?: EscalationRequirement;
  /** Every policy consulted, by id and version. The audit trail needs this. */
  readonly evaluatedPolicies: readonly { readonly policyId: string; readonly version: number }[];
  readonly evaluated: {
    readonly amountAtomic: Atomic;
    readonly mandateWindowBeforeAtomic: Atomic;
    readonly mandateWindowAfterAtomic: Atomic;
    readonly driftScore: number;
  };
}

/** Default escalation when a policy demands approval but names no parameters. */
export const DEFAULT_ESCALATION = {
  approverRole: "finance_admin",
  timeoutSeconds: 900,
  onTimeout: "HOLD" as const,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Allowlist membership with the empty/absent distinction preserved.
 *
 * `undefined` → unconstrained. `[]` → nothing is allowed. Collapsing them is the
 * bug that turns "we have not configured merchants yet" into "every merchant is
 * permitted", and it reads identically in a code review.
 */
function allowed(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (list === undefined) return true;
  if (value === undefined) return false;
  return list.some((entry) => matchDomain(value, entry));
}

function blocked(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (!list || list.length === 0 || value === undefined) return false;
  return list.some((entry) => matchDomain(value, entry));
}

/**
 * Exact match, or a single leading `*.` wildcard.
 *
 * `*.example.com` matches a subdomain and NOT the apex, matching
 * @furlpay/x402-guard's `matchesPattern` exactly — the two must agree, because a
 * payer-side gate and the control plane running different matchers disagree
 * about who may be paid, and the disagreement surfaces as a payment that
 * settled when it should not have.
 */
function matchDomain(value: string, pattern: string): boolean {
  const v = value.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1);
    return v.endsWith(suffix) && v.length > suffix.length;
  }
  return v === p;
}

function tighterCeiling(a: Atomic | undefined, b: Atomic | undefined): Atomic | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return mustParseAtomic(a, "ceiling") <= mustParseAtomic(b, "ceiling") ? a : b;
}

// ── The engine ─────────────────────────────────────────────────────────────

/**
 * Decide. Pure, synchronous, deterministic.
 *
 * Returns on the FIRST deny. Holds accumulate: a payment can be held for two
 * independent reasons and an operator needs both, because clearing one and
 * releasing would then execute a payment the second reason was still objecting
 * to.
 */
export function evaluatePolicy(input: EvaluatePolicyInput): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const holds: string[] = [];
  const { candidate: c, mandate, authority, nowMs } = input;

  const amount = parseAtomic(c.amountAtomic);
  const windowBefore = parseAtomic(input.exposure.mandateWindowAtomic);

  const evaluatedPolicies = input.policies.map((p) => ({ policyId: p.policyId, version: p.version }));
  const baseEvaluated = {
    amountAtomic: c.amountAtomic,
    mandateWindowBeforeAtomic: input.exposure.mandateWindowAtomic,
    mandateWindowAfterAtomic: input.exposure.mandateWindowAtomic,
    driftScore: input.drift.score,
  };

  const deny = (id: PolicyCheckId, detail: string, policy?: PolicyDocument): PolicyDecision => {
    checks.push({
      id,
      outcome: "deny",
      detail,
      policyId: policy?.policyId,
      policyVersion: policy?.version,
    });
    return {
      verdict: "DENY",
      primaryReason: detail,
      checks,
      requiresApproval: false,
      evaluatedPolicies,
      evaluated: baseEvaluated,
    };
  };
  const pass = (id: PolicyCheckId, detail: string, policy?: PolicyDocument) =>
    checks.push({ id, outcome: "pass", detail, policyId: policy?.policyId, policyVersion: policy?.version });
  const hold = (id: PolicyCheckId, detail: string, policy?: PolicyDocument) => {
    checks.push({ id, outcome: "hold", detail, policyId: policy?.policyId, policyVersion: policy?.version });
    holds.push(detail);
  };
  const na = (id: PolicyCheckId, detail: string) =>
    checks.push({ id, outcome: "not_applicable", detail });

  if (amount === null) {
    return deny("policy_amount", `amount "${c.amountAtomic}" is not an integer amount in the asset's minor units`);
  }
  if (amount <= 0n) return deny("policy_amount", "amount must be positive");
  if (windowBefore === null) {
    return deny("mandate_cumulative", "recorded window exposure is not an integer amount; refusing rather than assuming zero");
  }
  const windowAfter = windowBefore + amount;
  const evaluated = { ...baseEvaluated, mandateWindowAfterAtomic: windowAfter.toString() };

  // ── 1. Live revocation. FIRST, always. ──────────────────────────────────
  if (!input.revocation.live) {
    return {
      ...deny("revocation", `revocation check failed (${input.revocation.reason}): ${input.revocation.detail}`),
      evaluated,
    };
  }
  pass("revocation", `authority live; ${input.revocation.checkedSubjects} subjects checked`);

  // ── 2. Mandate liveness and binding ─────────────────────────────────────
  if (!input.mandateLiveness.live) {
    return {
      ...deny("mandate_liveness", `mandate ${input.mandateLiveness.reason}: ${input.mandateLiveness.detail}`),
      evaluated,
    };
  }
  pass("mandate_liveness", "mandate is within its validity window");

  // A mandate empowers ONE agent. `delegatedTo` may be the agent id or its DID.
  if (mandate.delegatedTo !== authority.agentId && mandate.delegatedTo !== (authority as { did?: string }).did) {
    const matchesDid = mandate.delegatedTo.startsWith("did:") && mandate.delegatedTo.includes(authority.agentId);
    if (!matchesDid) {
      return {
        ...deny(
          "mandate_agent_binding",
          `mandate delegates to "${mandate.delegatedTo}" but the resolved agent is ${authority.agentId}`
        ),
        evaluated,
      };
    }
  }
  pass("mandate_agent_binding", `mandate is bound to agent ${authority.agentId}`);

  // ── 3. Denomination. Comparing unlike units is a silent multiplier bug. ──
  const scope = mandate.authorityScope;
  if (scope.currency.toUpperCase() !== c.currency.toUpperCase()) {
    return {
      ...deny(
        "mandate_denomination",
        `mandate is denominated in ${scope.currency}; payment is in ${c.currency}. A cap in one unit says nothing about an amount in another.`
      ),
      evaluated,
    };
  }
  if (scope.asset && scope.asset.toUpperCase() !== c.asset.toUpperCase()) {
    return {
      ...deny("mandate_denomination", `mandate names asset ${scope.asset}; payment carries ${c.asset}`),
      evaluated,
    };
  }
  if (scope.networks && !scope.networks.includes(c.networkId)) {
    return {
      ...deny("mandate_denomination", `mandate does not authorize network ${c.networkId}`),
      evaluated,
    };
  }
  pass("mandate_denomination", `${c.asset} on ${c.networkId} matches the mandate's denomination`);

  // ── 4. Mandate limits, intersected with the delegation chain ────────────
  // The chain's intersected ceiling is used, not the mandate's alone: a mandate
  // cannot grant more than the delegation that produced the agent.
  const chainScope: AuthorityScope = authority.scope;
  const perTx = tighterCeiling(scope.maxAmountPerTxAtomic, chainScope.maxAmountPerTxAtomic)!;
  const cumulative = tighterCeiling(scope.maxCumulativeAtomic, chainScope.maxCumulativeAtomic)!;

  if (amount > mustParseAtomic(perTx, "perTx")) {
    return {
      ...deny("mandate_per_tx", `amount ${c.amountAtomic} exceeds the effective per-transaction cap ${perTx}`),
      evaluated,
    };
  }
  pass("mandate_per_tx", `within the per-transaction cap ${perTx}`);

  if (windowAfter > mustParseAtomic(cumulative, "cumulative")) {
    return {
      ...deny(
        "mandate_cumulative",
        `cumulative exposure would reach ${windowAfter} against a cap of ${cumulative}; ` +
          `a sequence of individually-legal payments is still bounded in total`
      ),
      evaluated,
    };
  }
  pass("mandate_cumulative", `cumulative exposure ${windowAfter} is within ${cumulative}`);

  // ── 5. Scope allowlists from the mandate + chain ────────────────────────
  const effectiveDomains =
    scope.allowedMerchantDomains === undefined
      ? chainScope.allowedMerchantDomains
      : chainScope.allowedMerchantDomains === undefined
        ? scope.allowedMerchantDomains
        : scope.allowedMerchantDomains.filter((d) => chainScope.allowedMerchantDomains!.includes(d));

  if (effectiveDomains !== undefined) {
    if (!allowed(effectiveDomains, c.merchantDomain)) {
      return {
        ...deny(
          "scope_merchant",
          c.merchantDomain
            ? `merchant domain ${c.merchantDomain} is not in the mandate's allowlist`
            : "the mandate constrains merchant domains and this payment names none"
        ),
        evaluated,
      };
    }
    pass("scope_merchant", `merchant ${c.merchantDomain} is allowed by the mandate`);
  } else {
    na("scope_merchant", "mandate does not constrain merchant domains");
  }

  if (scope.allowedCategories !== undefined) {
    if (!allowed(scope.allowedCategories, c.category)) {
      return {
        ...deny("scope_category", `category ${c.category ?? "(none)"} is not in the mandate's allowlist`),
        evaluated,
      };
    }
    pass("scope_category", `category ${c.category} is allowed`);
  } else {
    na("scope_category", "mandate does not constrain categories");
  }

  const effectiveRails =
    scope.allowedRails === undefined
      ? chainScope.allowedRails
      : chainScope.allowedRails === undefined
        ? scope.allowedRails
        : scope.allowedRails.filter((r) => chainScope.allowedRails!.includes(r));

  if (effectiveRails !== undefined) {
    if (!effectiveRails.includes(c.railId)) {
      return {
        ...deny("scope_rail", `rail ${c.railId} is not in the mandate's allowed rails`),
        evaluated,
      };
    }
    pass("scope_rail", `rail ${c.railId} is allowed by the mandate`);
  } else {
    na("scope_rail", "mandate does not constrain rails");
  }

  const scopeBlockedJur = chainScope.blockedJurisdictions ?? scope.blockedJurisdictions;
  if (blocked(scopeBlockedJur, c.jurisdiction)) {
    return {
      ...deny("scope_jurisdiction", `jurisdiction ${c.jurisdiction} is blocked by the delegation chain`),
      evaluated,
    };
  }
  const scopeAllowedJur = chainScope.allowedJurisdictions ?? scope.allowedJurisdictions;
  if (scopeAllowedJur !== undefined && !allowed(scopeAllowedJur, c.jurisdiction)) {
    return {
      ...deny("scope_jurisdiction", `jurisdiction ${c.jurisdiction ?? "(unknown)"} is not permitted by the delegation chain`),
      evaluated,
    };
  }
  pass("scope_jurisdiction", "jurisdiction is permitted by the delegation chain");

  // ── 6. Recipient verification ──────────────────────────────────────────
  if (!input.recipient.ok) {
    return {
      ...deny("recipient_verification", `recipient verification failed (${input.recipient.reason}): ${input.recipient.detail}`),
      evaluated,
    };
  }
  pass("recipient_verification", `destination attested for ${c.networkId}`);

  // ── 7. Organization policies ───────────────────────────────────────────
  let approvalThreshold = tighterCeiling(
    scope.requireHumanApprovalAboveAtomic,
    chainScope.requireHumanApprovalAboveAtomic
  );
  let escalationSpec: { approverRole: string; timeoutSeconds: number; onTimeout: "HOLD" | "DENY" } = {
    ...DEFAULT_ESCALATION,
  };
  let escalationReason: string | undefined;
  let requireApprovalFlag = false;

  for (const policy of input.policies) {
    if (policy.status !== "ACTIVE") {
      na("policy_status", `policy ${policy.policyId} v${policy.version} is disabled`);
      continue;
    }
    pass("policy_status", `policy ${policy.policyId} v${policy.version} is active`, policy);

    // Time. Checked early because an out-of-window payment should not be
    // evaluated against the rest of the rule set at all — the answer is no
    // regardless, and a later reason would be misleading.
    const t = policy.time;
    if (t) {
      if (t.activeFrom) {
        const from = Date.parse(t.activeFrom);
        if (Number.isFinite(from) && nowMs < from) {
          return { ...deny("policy_time", `policy ${policy.policyId} is not active until ${t.activeFrom}`, policy), evaluated };
        }
      }
      if (t.activeUntil) {
        const until = Date.parse(t.activeUntil);
        if (Number.isFinite(until) && nowMs >= until) {
          return { ...deny("policy_time", `policy ${policy.policyId} stopped being active at ${t.activeUntil}`, policy), evaluated };
        }
      }
      const d = new Date(nowMs);
      if (t.allowedHoursUtc !== undefined && !t.allowedHoursUtc.includes(d.getUTCHours())) {
        return {
          ...deny("policy_time", `payments are not permitted at ${d.getUTCHours()}:00 UTC under policy ${policy.policyId}`, policy),
          evaluated,
        };
      }
      if (t.allowedDaysUtc !== undefined && !t.allowedDaysUtc.includes(d.getUTCDay())) {
        return {
          ...deny("policy_time", `payments are not permitted on UTC day ${d.getUTCDay()} under policy ${policy.policyId}`, policy),
          evaluated,
        };
      }
      pass("policy_time", "within the policy's active window", policy);
    }

    // Currency.
    const cur = policy.currency;
    if (cur) {
      if (blocked(cur.blocked, c.currency)) {
        return { ...deny("policy_currency", `currency ${c.currency} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (cur.allowed !== undefined && !cur.allowed.map((x) => x.toUpperCase()).includes(c.currency.toUpperCase())) {
        return { ...deny("policy_currency", `currency ${c.currency} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      pass("policy_currency", `currency ${c.currency} is permitted`, policy);
    }

    // Amount windows. Each is a separate ceiling and each is checked against
    // the exposure ALREADY recorded plus this payment — the same arithmetic the
    // mandate's cumulative check uses, so the two cannot disagree.
    const a = policy.amount;
    if (a) {
      if (a.maxPerTransactionAtomic && amount > mustParseAtomic(a.maxPerTransactionAtomic, "maxPerTransaction")) {
        return {
          ...deny("policy_amount", `amount exceeds policy ${policy.policyId}'s per-transaction cap ${a.maxPerTransactionAtomic}`, policy),
          evaluated,
        };
      }
      const windows: [Atomic | undefined, Atomic, string][] = [
        [a.maxHourlyAtomic, input.exposure.hourlyAtomic, "hourly"],
        [a.maxDailyAtomic, input.exposure.dailyAtomic, "daily"],
        [a.maxMonthlyAtomic, input.exposure.monthlyAtomic, "monthly"],
      ];
      for (const [cap, spent, label] of windows) {
        if (!cap) continue;
        const spentValue = parseAtomic(spent);
        if (spentValue === null) {
          return {
            ...deny("policy_amount", `recorded ${label} exposure is unreadable; refusing rather than treating it as zero`, policy),
            evaluated,
          };
        }
        if (spentValue + amount > mustParseAtomic(cap, `max${label}`)) {
          return {
            ...deny(
              "policy_amount",
              `${label} exposure would reach ${spentValue + amount} against policy ${policy.policyId}'s cap ${cap}`,
              policy
            ),
            evaluated,
          };
        }
      }
      pass("policy_amount", "within every configured amount window", policy);
    }

    // Merchant and recipient.
    const m = policy.merchant;
    if (m) {
      if (blocked(m.blockedDomains, c.merchantDomain)) {
        return { ...deny("policy_merchant", `merchant domain ${c.merchantDomain} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.allowedDomains !== undefined && !allowed(m.allowedDomains, c.merchantDomain)) {
        return { ...deny("policy_merchant", `merchant domain ${c.merchantDomain ?? "(none)"} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.blockedMccs && c.mcc && m.blockedMccs.includes(c.mcc)) {
        return { ...deny("policy_merchant", `merchant category ${c.mcc} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.allowedMccs !== undefined && (!c.mcc || !m.allowedMccs.includes(c.mcc))) {
        return { ...deny("policy_merchant", `merchant category ${c.mcc ?? "(none)"} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.blockedRecipientIds && m.blockedRecipientIds.includes(c.recipientId)) {
        return { ...deny("policy_merchant", `recipient ${c.recipientId} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.allowedRecipientIds !== undefined && !m.allowedRecipientIds.includes(c.recipientId)) {
        return { ...deny("policy_merchant", `recipient ${c.recipientId} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      if (m.allowedContracts !== undefined && c.contractAddress) {
        const permitted = m.allowedContracts.some(
          (x) => x.trim().toLowerCase() === c.contractAddress!.trim().toLowerCase()
        );
        if (!permitted) {
          return { ...deny("policy_merchant", `contract ${c.contractAddress} is not in policy ${policy.policyId}'s allowlist`, policy), evaluated };
        }
      }
      pass("policy_merchant", "merchant, category, recipient and contract all permitted", policy);
    }

    // Rails.
    const r = policy.rails;
    if (r) {
      if (r.blocked && r.blocked.includes(c.railId)) {
        return { ...deny("policy_rail", `rail ${c.railId} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (r.allowed !== undefined && !r.allowed.includes(c.railId)) {
        return { ...deny("policy_rail", `rail ${c.railId} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      pass("policy_rail", `rail ${c.railId} is permitted`, policy);
    }

    // Geography.
    const g = policy.geography;
    if (g) {
      if (blocked(g.blockedJurisdictions, c.jurisdiction)) {
        return { ...deny("policy_geography", `jurisdiction ${c.jurisdiction} is blocked by policy ${policy.policyId}`, policy), evaluated };
      }
      if (g.allowedJurisdictions !== undefined && !allowed(g.allowedJurisdictions, c.jurisdiction)) {
        return { ...deny("policy_geography", `jurisdiction ${c.jurisdiction ?? "(unknown)"} is not permitted by policy ${policy.policyId}`, policy), evaluated };
      }
      pass("policy_geography", "jurisdiction permitted", policy);
    }

    // Attestation.
    const risk = policy.risk;
    if (risk?.minAttestation) {
      const rank = { none: 0, key_only: 1, passkey: 2, tee: 3 } as const;
      if (rank[authority.attestation] < rank[risk.minAttestation]) {
        return {
          ...deny(
            "policy_attestation",
            `policy ${policy.policyId} requires ${risk.minAttestation} runtime attestation; the session presented ${authority.attestation}`,
            policy
          ),
          evaluated,
        };
      }
      pass("policy_attestation", `attestation ${authority.attestation} satisfies the policy`, policy);
    }

    // Approval requirements. The TIGHTEST threshold across all policies and the
    // mandate wins, because a lower threshold means MORE payments see a human.
    const ap = policy.approval;
    if (ap) {
      approvalThreshold = tighterCeiling(approvalThreshold, ap.requiredAboveAtomic);
      if (ap.approverRole) escalationSpec = { ...escalationSpec, approverRole: ap.approverRole };
      if (ap.timeoutSeconds) escalationSpec = { ...escalationSpec, timeoutSeconds: ap.timeoutSeconds };
      if (ap.onTimeout) escalationSpec = { ...escalationSpec, onTimeout: ap.onTimeout };
      if (ap.requiredForNewRecipient && input.recipient.firstUse) {
        requireApprovalFlag = true;
        escalationReason = `policy ${policy.policyId} requires approval for a first payment to a recipient`;
      }
      if (ap.requiredForNewRail && input.railIsNew) {
        requireApprovalFlag = true;
        escalationReason = `policy ${policy.policyId} requires approval for a rail this agent has not used`;
      }
    }

    // Risk holds from this policy's own thresholds.
    if (risk?.holdOnFirstUse && input.recipient.firstUse) {
      hold("drift", `policy ${policy.policyId} holds first payments to a new recipient for review`, policy);
    }
    if (risk?.denyScore !== undefined && input.drift.score >= risk.denyScore) {
      return {
        ...deny(
          "drift",
          `drift score ${input.drift.score} reached policy ${policy.policyId}'s deny threshold ${risk.denyScore}: ` +
            input.drift.signals.map((s) => s.id).join(", "),
          policy
        ),
        evaluated,
      };
    }
    if (risk?.holdScore !== undefined && input.drift.score >= risk.holdScore) {
      hold(
        "drift",
        `drift score ${input.drift.score} reached policy ${policy.policyId}'s hold threshold ${risk.holdScore}: ` +
          input.drift.signals.map((s) => s.id).join(", "),
        policy
      );
    }
  }

  // ── 8. Drift, at its own configured verdict ─────────────────────────────
  if (input.drift.verdict === "DENY") {
    return {
      ...deny(
        "drift",
        `sequence-level controls refused this payment (score ${input.drift.score}): ` +
          input.drift.signals.map((s) => `${s.id} (${s.detail})`).join("; ")
      ),
      evaluated,
    };
  }
  if (input.drift.verdict === "HOLD") {
    hold(
      "drift",
      `sequence-level controls require review (score ${input.drift.score}): ` +
        input.drift.signals.map((s) => s.id).join(", ")
    );
  } else {
    pass("drift", `sequence-level controls clear (score ${input.drift.score})`);
  }

  // ── 9. Approval ────────────────────────────────────────────────────────
  const overThreshold =
    approvalThreshold !== undefined && amount > mustParseAtomic(approvalThreshold, "approvalThreshold");
  const requiresApproval = overThreshold || requireApprovalFlag;

  if (requiresApproval) {
    if (input.approvalPresent) {
      pass("approval", "a valid human approval is recorded for this payment");
    } else {
      const reason =
        escalationReason ??
        `amount ${c.amountAtomic} exceeds the human-approval threshold ${approvalThreshold}`;
      checks.push({ id: "approval", outcome: "hold", detail: reason });
      return {
        verdict: "HOLD",
        primaryReason: reason,
        checks,
        requiresApproval: true,
        escalation: {
          ...escalationSpec,
          reason,
          thresholdAtomic: approvalThreshold,
        },
        evaluatedPolicies,
        evaluated,
      };
    }
  } else {
    na("approval", "no rule required a human for this payment");
  }

  // ── 10. Any outstanding hold ───────────────────────────────────────────
  if (holds.length > 0) {
    return {
      verdict: "HOLD",
      primaryReason: holds[0],
      checks,
      requiresApproval,
      escalation: { ...escalationSpec, reason: holds.join(" | ") },
      evaluatedPolicies,
      evaluated,
    };
  }

  return {
    verdict: "ALLOW",
    checks,
    requiresApproval,
    evaluatedPolicies,
    evaluated,
  };
}
