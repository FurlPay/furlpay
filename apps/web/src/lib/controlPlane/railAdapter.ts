import { arcRailAdapter } from "@/lib/chains/arcExecutionAdapter";
import { financialEnvironment } from "@/lib/flags";

// ---------------------------------------------------------------------------
// The seam between the control plane and a payment rail.
//
// WHY THIS EXISTS. Until now `/payments/execute` ended in a hardcoded "no rail
// is connected" block. That was honest, but it also meant the failure semantics
// the architecture claims — indeterminate is not failed, indeterminate is not
// settled, a rail outage is not a different rail — could not be tested at all,
// because there was nothing that could fail. This is the smallest interface that
// makes those claims executable.
//
// THE DEFAULT IS STILL ZERO ADAPTERS. Nothing registers one in production. An
// unregistered rail produces exactly the response it produced before, and the
// tests below assert that, so adding this seam cannot quietly become a path to
// pretending value moved.
//
// THE FIVE OUTCOMES, AND WHY THERE ARE FIVE RATHER THAN TWO.
//
//   SETTLED        the provider confirmed, and named a settlement reference
//   PENDING        accepted, not yet final — normal for most rails
//   REJECTED       the provider refused, authoritatively. Money did not move.
//   INDETERMINATE  we do not know. A timeout after submission lives here.
//   (a throw)      also INDETERMINATE, never anything else
//
// Collapsing INDETERMINATE into REJECTED is the single most expensive mistake
// available in a payments system: it invites a retry, and if the first attempt
// actually landed, the retry pays twice. Collapsing it into SETTLED is worse in
// the other direction. So the type makes both collapses impossible to express.
//
// A "SETTLED" OUTCOME WITHOUT A REFERENCE IS NOT A SETTLEMENT. The caller
// validates that, because an adapter that returns `{ kind: "SETTLED" }` with an
// empty reference is either buggy or lying, and in both cases the right answer
// is "we do not know" rather than "done".
// ---------------------------------------------------------------------------

export interface RailSubmitRequest {
  readonly organizationId: string;
  readonly authorizationId: string;
  readonly railId: string;
  readonly amountAtomic: string;
  readonly asset: string;
  readonly networkId: string;
  readonly destination: string;
  /** Recomputed at execution and identical to the authorized one. */
  readonly payloadHash: string;
  /**
   * Stable across retries of the SAME authorization, so an adapter talking to a
   * provider that supports idempotency keys can pass it straight through. This
   * is what makes "retry after a timeout" safe at the provider as well as here.
   */
  readonly idempotencyKey: string;
}

export type RailOutcome =
  | {
      readonly kind: "SETTLED";
      /** The provider's own reference. Required — see the header. */
      readonly settlementRef: string;
      readonly feeAtomic?: string;
      readonly confirmations?: number;
    }
  | { readonly kind: "PENDING"; readonly railRef: string }
  | { readonly kind: "REJECTED"; readonly reason: string }
  | { readonly kind: "INDETERMINATE"; readonly reason: string; readonly railRef?: string };

export interface RailAdapter {
  readonly railId: string;
  /**
   * True for adapters that must never run against real money.
   *
   * The registry refuses these in production. Without it, a test double left
   * registered by an import side-effect would be a live-money bypass — exactly
   * the class of "development-only security bypass" this codebase forbids.
   */
  readonly testOnly?: boolean;
  submit(req: RailSubmitRequest): Promise<RailOutcome>;
}

const adapters = new Map<string, RailAdapter>();

export class RailAdapterRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RailAdapterRefused";
  }
}

/**
 * Register an adapter for a rail.
 *
 * Refuses a `testOnly` adapter in production, loudly. A silent no-op here would
 * be worse than a throw: the deployment would look connected and every payment
 * would take a path nobody intended.
 */
export function registerRailAdapter(adapter: RailAdapter): void {
  if (adapter.testOnly && financialEnvironment() === "production") {
    throw new RailAdapterRefused(
      `refusing to register test-only adapter for "${adapter.railId}" in production`
    );
  }
  adapters.set(adapter.railId, adapter);
}

export function unregisterRailAdapter(railId: string): void {
  adapters.delete(railId);
}

// Rails whose adapters decide for themselves whether they may connect (flag, environment,
// endpoint, KMS signer). ARC-P1-004: the Arc adapter existed but nothing ever registered it, so
// /api/v1/payments/execute could not reach Arc even with every condition met. Each factory returns
// null when any condition fails, which keeps the rail unregistered (503) — never half-connected.
let configuredOnce = false;
const autoConnected = new Set<string>();
function connectConfiguredRails(): void {
  if (configuredOnce) return;
  configuredOnce = true;
  const arc = arcRailAdapter();
  if (arc && !adapters.has(arc.railId)) { registerRailAdapter(arc); autoConnected.add(arc.railId); }
}

/** Null when nothing is connected — the production case. */
export function railAdapterFor(railId: string): RailAdapter | null {
  connectConfiguredRails();
  return adapters.get(railId) ?? null;
}

/** Which rails have an adapter at all. Empty in production, by design. */
export function connectedRails(): string[] {
  connectConfiguredRails();
  return [...adapters.keys()].sort();
}

/** Tests only: forget that configured rails were connected (environment changed). */
export function resetConfiguredRailsForTests(): void {
  configuredOnce = false;
  for (const railId of autoConnected) adapters.delete(railId);
  autoConnected.clear();
}

/**
 * Run an adapter and normalise everything that can go wrong into an outcome.
 *
 * EVERY UNEXPECTED THING BECOMES INDETERMINATE. A throw, a timeout, a null, a
 * shape the type system cannot see (adapters talk to the outside world, so the
 * compiler's guarantees stop at this boundary) — all of them mean "we asked a
 * provider to move money and we do not know what happened". That is the only
 * safe reading, and it is deliberately the same reading for all of them so no
 * code path can accidentally treat one class of unknown as more knowable.
 *
 * THE TIMEOUT IS THE INTERESTING ONE. A timeout BEFORE submission and a timeout
 * AFTER submission are indistinguishable from here, and the second one may have
 * moved money. So a timeout is never REJECTED.
 */
export async function submitToRail(
  adapter: RailAdapter,
  req: RailSubmitRequest,
  timeoutMs = 15_000
): Promise<RailOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      adapter.submit(req),
      new Promise<RailOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              kind: "INDETERMINATE",
              reason: `no response from rail within ${timeoutMs}ms; the submission may have landed`,
            }),
          timeoutMs
        );
      }),
    ]);
    return validateOutcome(outcome);
  } catch (e) {
    return {
      kind: "INDETERMINATE",
      reason: `rail adapter threw: ${(e as Error)?.message ?? String(e)}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Reject a malformed outcome rather than believing it.
 *
 * The adapter is the boundary with an external system, so its return value is
 * untrusted input no matter what the type signature says. A SETTLED without a
 * reference, a PENDING without one, an unknown `kind`, a non-object — each
 * becomes INDETERMINATE, because a claim we cannot check is not evidence.
 */
function validateOutcome(outcome: unknown): RailOutcome {
  if (!outcome || typeof outcome !== "object") {
    return { kind: "INDETERMINATE", reason: "rail adapter returned a non-object" };
  }
  const o = outcome as Record<string, unknown>;
  const ref = (v: unknown) => typeof v === "string" && v.trim().length > 0;

  switch (o.kind) {
    case "SETTLED":
      if (!ref(o.settlementRef)) {
        // The whole point. "Done, but I cannot tell you what I did" is not done.
        return {
          kind: "INDETERMINATE",
          reason: "rail reported SETTLED with no settlement reference",
        };
      }
      return {
        kind: "SETTLED",
        settlementRef: String(o.settlementRef),
        ...(ref(o.feeAtomic) ? { feeAtomic: String(o.feeAtomic) } : {}),
        ...(typeof o.confirmations === "number" ? { confirmations: o.confirmations } : {}),
      };
    case "PENDING":
      if (!ref(o.railRef)) {
        return { kind: "INDETERMINATE", reason: "rail reported PENDING with no reference to poll" };
      }
      return { kind: "PENDING", railRef: String(o.railRef) };
    case "REJECTED":
      return { kind: "REJECTED", reason: ref(o.reason) ? String(o.reason) : "rail rejected" };
    case "INDETERMINATE":
      return {
        kind: "INDETERMINATE",
        reason: ref(o.reason) ? String(o.reason) : "rail returned an indeterminate result",
        ...(ref(o.railRef) ? { railRef: String(o.railRef) } : {}),
      };
    default:
      return {
        kind: "INDETERMINATE",
        reason: `rail returned an unrecognised outcome kind: ${JSON.stringify(o.kind)}`,
      };
  }
}
