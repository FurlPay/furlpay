import { Money } from "@/lib/money/money";
import { log } from "@/lib/log";
import { appendRevenueEvent, type WriteOutcome } from "./store";
import {
  assetFor,
  bpsOf,
  idempotencyKey,
  SOURCE_ENGINE,
  type RevenueEvent,
  type RevenueSource,
  type RevenueStatus,
} from "./types";

// ---------------------------------------------------------------------------
// The recorder — the ONE way a revenue event gets written.
//
// Every earning path calls `recordRevenue`. Nothing constructs a RevenueEvent
// by hand and nothing writes to the store directly, so the rules below are
// enforced once rather than remembered at each call site:
//
//   - fee and volume are the same asset (you cannot take a USD fee on a
//     USDC.base volume and have the basis points mean anything),
//   - fee is never negative except on a reversal,
//   - fee never exceeds volume when volume is known,
//   - feeBps is derived, never passed in,
//   - the id is derived from the business event, never random.
//
// ── RECORDING NEVER BREAKS THE BUSINESS PATH ───────────────────────────────
//
// `recordRevenue` is called from inside webhook handlers and settlement paths.
// If the books are unavailable, the correct outcome is that the PAYMENT still
// succeeds and the reporting has a hole we can see — not that a customer's
// subscription fails because an analytics table was unreachable.
//
// So it logs and returns `{ recorded: false }` on a store failure instead of
// throwing. That is a deliberate asymmetry with the settlement code, which
// fails closed: there, a missing record risks paying twice; here, a missing
// record risks under-reporting. Under-reporting is recoverable by replaying
// from the provider; a double payment is not.
// ---------------------------------------------------------------------------

export interface RecordInput {
  source: RevenueSource;
  status: RevenueStatus;
  /** The provider's identifier for the underlying business event. */
  externalRef: string;
  /** What FurlPay keeps. */
  fee: Money;
  /** Gross amount that moved, when the concept applies. */
  volume?: Money | null;
  userId?: string | null;
  organizationId?: string | null;
  chain?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  /** Injectable for tests. */
  now?: number;
}

export interface RecordResult extends Partial<WriteOutcome> {
  recorded: boolean;
  event?: RevenueEvent;
  error?: string;
}

/** Validate and normalise, throwing on programmer error. */
export function buildRevenueEvent(input: RecordInput): RevenueEvent {
  const { source, status, fee, externalRef } = input;
  const volume = input.volume ?? null;

  if (volume && volume.asset.id !== fee.asset.id) {
    throw new Error(
      `revenue: fee asset ${fee.asset.id} does not match volume asset ${volume.asset.id} — ` +
        "a rate across two assets is meaningless",
    );
  }
  if (status !== "reversed" && fee.isNegative()) {
    throw new Error(`revenue: negative fee is only valid on a reversal (status=${status})`);
  }
  if (status === "reversed" && !fee.isNegative() && !fee.isZero()) {
    throw new Error("revenue: a reversal must carry a negative fee so it negates the original");
  }
  if (volume && !volume.isNegative() && fee.compare(volume) === 1) {
    throw new Error(
      `revenue: fee ${fee.toString()} exceeds volume ${volume.toString()} — ` +
        "almost always a unit mix-up (major vs minor)",
    );
  }

  // Reversals get their own id so the original row is preserved untouched.
  const baseId = idempotencyKey(source, externalRef);
  const id = status === "reversed" ? `${baseId}:reversal` : baseId;

  return {
    id,
    createdAt: input.now ?? Date.now(),
    userId: input.userId ?? null,
    organizationId: input.organizationId ?? null,
    source,
    engine: SOURCE_ENGINE[source],
    status,
    asset: fee.asset.id,
    chain: input.chain ?? fee.asset.chain,
    feeMinor: fee.minor.toString(),
    volumeMinor: volume ? volume.minor.toString() : null,
    feeBps: bpsOf(fee, volume),
    externalRef,
    metadata: input.metadata ?? {},
  };
}

/**
 * Record a revenue event. Idempotent on (source, externalRef).
 *
 * Never throws for store-level problems — see the note above. It DOES throw
 * for invalid input, because a fee larger than its volume or a cross-asset
 * rate is a bug in the caller that should fail loudly in tests, not become a
 * silently wrong row in the books.
 */
export async function recordRevenue(input: RecordInput): Promise<RecordResult> {
  let event: RevenueEvent;
  try {
    event = buildRevenueEvent(input);
  } catch (e) {
    log.error("revenue event rejected as invalid", {
      source: input.source,
      error: (e as Error).message,
    });
    throw e;
  }

  try {
    const outcome = await appendRevenueEvent(event);
    return { recorded: true, event, ...outcome };
  } catch (e) {
    return { recorded: false, event, error: (e as Error).message };
  }
}

/** Convenience for the common "amount in minor units of a known asset" shape. */
export function minor(amount: bigint | number | string, assetId: string): Money {
  return Money.ofMinor(amount, assetFor(assetId));
}

/**
 * USD from a float, for the legacy paths that still carry `number` dollars.
 *
 * Every existing money path in the app predates lib/money and passes doubles
 * around. Refusing them here would mean not instrumenting anything, so this is
 * the one sanctioned conversion — and it is deliberately narrow: it rounds to
 * cents half-up at the boundary and is the only place a float is allowed to
 * become Money. New code should build Money directly and never call this.
 */
export function usdFromFloat(dollars: number): Money {
  if (!Number.isFinite(dollars)) throw new Error(`revenue: non-finite USD amount ${dollars}`);
  const cents = Math.round(dollars * 100);
  return Money.ofMinor(BigInt(cents), assetFor("USD"));
}
