import { isTerminal, RESERVED_STATES, type TxState } from "@/lib/money/lifecycle";
import {
  evaluateCorridor,
  type CapabilityDecision,
  type CapabilityQuery,
  type IneligibilityReason,
  type ProviderCapability,
} from "./capability";
import type { ProviderAdapter, ProviderId, ProviderKind } from "./types";

// ---------------------------------------------------------------------------
// Provider registry, health, selection and failover.
//
// THE ONE RULE THAT MAKES THIS FILE WORTH HAVING:
//
//     Failover is a routing decision BEFORE money moves, and a manual decision
//     after.
//
// Automatic retry against a second provider is correct when the first one
// declined a quote. It is catastrophic once an instruction has been accepted,
// because "the request failed" and "the request succeeded and the response was
// lost" are indistinguishable from here. Re-issuing a payout against provider
// B while provider A is quietly paying it out is how a customer is paid twice
// and the money is unrecoverable. So `assertFailoverAllowed` refuses on any
// state where value may already be committed, and says why.
//
// SELECTION IS EXPLAINABLE. `selectProvider` returns the rejected candidates
// with their reasons, not just a winner. An operator asking "why did this go
// to B?" gets an answer from the same call the router made.
// ---------------------------------------------------------------------------

// ── Registry ───────────────────────────────────────────────────────────────

class Registry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  private key(kind: ProviderKind, id: ProviderId): string {
    return `${kind}:${id}`;
  }

  register(adapter: ProviderAdapter): void {
    const key = this.key(adapter.kind, adapter.id);
    if (this.adapters.has(key)) {
      // Two adapters answering to one id means selection is order-dependent,
      // and which one moved the money becomes unanswerable after the fact.
      throw new Error(`Provider "${key}" is already registered.`);
    }
    this.adapters.set(key, adapter);
  }

  get(kind: ProviderKind, id: ProviderId): ProviderAdapter | undefined {
    return this.adapters.get(this.key(kind, id));
  }

  list(kind?: ProviderKind): readonly ProviderAdapter[] {
    const all = [...this.adapters.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }

  clear(): void {
    this.adapters.clear();
  }
}

export const providerRegistry = new Registry();

// ── Health ─────────────────────────────────────────────────────────────────

export type HealthState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface ProviderHealth {
  readonly providerId: ProviderId;
  readonly kind: ProviderKind;
  readonly state: HealthState;
  readonly observedAt: string;
  readonly detail?: string;
  /** Set by an operator. Outranks observed health in BOTH directions: a paused
   *  provider is never selected, however healthy it looks. */
  readonly operatorPaused?: boolean;
}

const health = new Map<string, ProviderHealth>();

export function recordProviderHealth(input: {
  providerId: ProviderId;
  kind: ProviderKind;
  state: HealthState;
  detail?: string;
}): void {
  const key = `${input.kind}:${input.providerId}`;
  const previous = health.get(key);
  health.set(key, {
    providerId: input.providerId,
    kind: input.kind,
    state: input.state,
    detail: input.detail,
    observedAt: new Date().toISOString(),
    // A health probe must not silently un-pause a provider an operator stopped.
    operatorPaused: previous?.operatorPaused ?? false,
  });
}

export function setProviderPaused(
  kind: ProviderKind,
  providerId: ProviderId,
  paused: boolean,
  detail?: string
): void {
  const key = `${kind}:${providerId}`;
  const previous = health.get(key);
  health.set(key, {
    providerId,
    kind,
    state: previous?.state ?? "unknown",
    detail: detail ?? previous?.detail,
    observedAt: new Date().toISOString(),
    operatorPaused: paused,
  });
}

export function getProviderHealth(kind: ProviderKind, providerId: ProviderId): ProviderHealth {
  return (
    health.get(`${kind}:${providerId}`) ?? {
      providerId,
      kind,
      // UNKNOWN, not healthy. A provider we have never probed has not earned
      // the benefit of the doubt, and selection treats unknown as unusable.
      state: "unknown",
      observedAt: new Date().toISOString(),
    }
  );
}

export function allProviderHealth(): readonly ProviderHealth[] {
  return [...health.values()];
}

/** Test seam. Never called by application code. */
export function __resetProviderState(): void {
  health.clear();
  providerRegistry.clear();
}

// ── Selection ──────────────────────────────────────────────────────────────

export type SelectionReason = IneligibilityReason | "no_adapter_registered" | "provider_unhealthy" | "operator_paused";

export interface SelectionCandidate {
  readonly providerId: ProviderId;
  readonly eligible: boolean;
  readonly reasons: readonly SelectionReason[];
  readonly capability: ProviderCapability;
}

export interface SelectionResult {
  readonly selected: { adapter: ProviderAdapter; capability: ProviderCapability } | null;
  /** Every candidate considered, winner included, with its reasons. */
  readonly candidates: readonly SelectionCandidate[];
  /** One line for an operator when nothing was selected. */
  readonly summary: string;
}

/** Rank eligible candidates. Deterministic — a tie must not resolve randomly,
 *  or two identical requests route differently and reconciliation splits. */
function rank(a: SelectionCandidate, b: SelectionCandidate): number {
  const order: Record<string, number> = { instant: 0, "T+0": 1, "T+1": 2, "T+2": 3, "T+3_or_more": 4 };
  const bySettlement =
    (order[a.capability.settlementWindow] ?? 9) - (order[b.capability.settlementWindow] ?? 9);
  if (bySettlement !== 0) return bySettlement;
  return a.providerId.localeCompare(b.providerId);
}

/**
 * Choose a provider for a corridor.
 *
 * Considers, in this order: does a capability row exist; is the contract live;
 * is the merchant category accepted; are credentials present; is the amount in
 * bounds; is an adapter actually registered; is the provider healthy and not
 * paused. Every one of those can be the reason a corridor is dark, and the
 * caller gets all of them.
 */
export function selectProvider(query: CapabilityQuery): SelectionResult {
  const decisions: readonly CapabilityDecision[] = evaluateCorridor(query);

  if (decisions.length === 0) {
    return {
      selected: null,
      candidates: [],
      summary:
        `No provider capability is declared for ${query.direction} ${query.fiatCurrency} in ` +
        `${query.country} via ${query.paymentMethod} for ${query.assetId}. ` +
        "This corridor does not exist yet — see lib/providers/capability.ts.",
    };
  }

  const candidates: SelectionCandidate[] = decisions.map((decision) => {
    const reasons: SelectionReason[] = [...decision.reasons];
    const adapter = providerRegistry.get(decision.capability.kind, decision.capability.providerId);
    if (!adapter) reasons.push("no_adapter_registered");

    const status = getProviderHealth(decision.capability.kind, decision.capability.providerId);
    if (status.operatorPaused) reasons.push("operator_paused");
    else if (status.state !== "healthy") reasons.push("provider_unhealthy");

    return {
      providerId: decision.capability.providerId,
      eligible: reasons.length === 0,
      reasons,
      capability: decision.capability,
    };
  });

  const winner = candidates.filter((c) => c.eligible).sort(rank)[0];
  if (!winner) {
    return {
      selected: null,
      candidates,
      summary: candidates
        .map((c) => `${c.providerId}: ${c.reasons.join(", ")}`)
        .join(" | "),
    };
  }

  const adapter = providerRegistry.get(winner.capability.kind, winner.providerId)!;
  return {
    selected: { adapter, capability: winner.capability },
    candidates,
    summary: `selected ${winner.providerId}`,
  };
}

// ── Failover ───────────────────────────────────────────────────────────────

export class FailoverRefused extends Error {
  readonly state: TxState;
  constructor(state: TxState, detail: string) {
    super(detail);
    this.name = "FailoverRefused";
    this.state = state;
  }
}

/**
 * May this transaction be re-routed to a different provider?
 *
 * Only from a state where NOTHING has been committed. The dangerous case is
 * not an obvious success — it is the timeout: the first provider may have
 * accepted the instruction and lost the response. Re-issuing against a second
 * provider then pays twice, and there is no mechanism to claw the second one
 * back. So an indeterminate outcome does not fail over; it goes to a status
 * poll, and if that cannot resolve it, to a human.
 */
export function assertFailoverAllowed(state: TxState, indeterminate: boolean): void {
  if (indeterminate) {
    throw new FailoverRefused(
      state,
      "The first provider's outcome is indeterminate — the instruction may have been accepted and " +
        "the response lost. Failing over could pay twice. Poll for status; escalate to MANUAL_REVIEW " +
        "if it cannot be resolved."
    );
  }

  if (RESERVED_STATES.includes(state)) {
    throw new FailoverRefused(
      state,
      `Value is already committed in state ${state}. Re-routing to another provider would move money ` +
        "a second time. Reverse or refund the existing movement first."
    );
  }

  if (isTerminal(state)) {
    throw new FailoverRefused(
      state,
      `${state} is terminal. Start a new transaction rather than re-routing a finished one.`
    );
  }
}

/** True when failover is safe, without throwing. For selection-time checks. */
export function failoverAllowed(state: TxState, indeterminate: boolean): boolean {
  try {
    assertFailoverAllowed(state, indeterminate);
    return true;
  } catch {
    return false;
  }
}
