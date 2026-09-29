import { Money, requireAsset, type Asset } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// Revenue events — the single typed record of what FurlPay actually earned.
//
// ── THE DISTINCTION THIS MODULE EXISTS TO ENFORCE ──────────────────────────
//
// If $10,000 moves across a rail and FurlPay keeps $25, then TPV is $10,000
// and revenue is $25. Reporting the $10,000 as revenue is the single most
// common way a payments company lies to itself, and it is an easy mistake to
// make structurally: the big number is the one the rail hands you, and the
// small one has to be derived.
//
// So a revenue event carries BOTH, in separate fields that cannot be confused:
//
//   volume — the gross amount that moved. Pass-through. Never revenue.
//   fee    — what FurlPay keeps. Revenue, and only if `status` says realized.
//
// There is deliberately no field called `amount`. Anyone writing a report has
// to say which of the two they mean.
//
// ── SIMULATED IS NOT REVENUE ───────────────────────────────────────────────
//
// Most of this platform's money paths are a deliberate pre-licence simulation.
// Those paths still emit events, because knowing the shape of the flow is
// useful, but they are recorded with status "simulated" and every aggregation
// excludes them from revenue by default.
//
// `INTEGRATION_MODE=live` does NOT reclassify them. An event's status is
// decided by the code path that produced it, from evidence it actually has —
// a Stripe charge id, a confirmed on-chain settlement — never by an env var.
//
// ── MONEY IS EXACT ─────────────────────────────────────────────────────────
//
// Amounts are `Money` (bigint minor units) from lib/money. No floats reach
// this module. Fee-from-volume is computed with Money.scale(bps, 10_000n),
// which is integer arithmetic with an explicit rounding mode.
// ---------------------------------------------------------------------------

/** Which revenue engine an event belongs to. Mirrors the strategy taxonomy. */
export type RevenueEngine =
  | "transaction"
  | "subscription"
  | "api"
  | "protocol"
  | "card"
  | "stablecoin"
  | "custody"
  | "aum";

/**
 * The specific code path that produced the event.
 *
 * Only sources with a real code path behind them are listed. The four engines
 * that are blocked on licences and partners (card, stablecoin, custody, aum)
 * have NO sources here on purpose: adding a placeholder so a dashboard tile
 * renders would be fabricating revenue. They get sources when their
 * integrations exist.
 */
export type RevenueSource =
  | "swap_integrator_fee"
  | "subscription_charge"
  | "x402_payment";

/** Which engine each source rolls up into. */
export const SOURCE_ENGINE: Record<RevenueSource, RevenueEngine> = {
  swap_integrator_fee: "transaction",
  subscription_charge: "subscription",
  x402_payment: "api",
};

/**
 * Lifecycle of a revenue event.
 *
 *   pending   — earned but not yet in our control. An accrued LI.FI integrator
 *               fee sitting in the FeeCollector is pending: it is owed, and a
 *               withdrawal has not happened.
 *   realized  — collected, with evidence. Counted as revenue.
 *   reversed  — refunded/charged back after being realized. Negates the
 *               original rather than deleting it; the books keep both rows.
 *   voided    — never actually earned (a failed or abandoned flow).
 *   simulated — produced by a pre-licence simulation path. Never revenue.
 */
export type RevenueStatus = "pending" | "realized" | "reversed" | "voided" | "simulated";

/** Statuses that count toward revenue. Everything else does not. */
export const REALIZED_STATUSES: readonly RevenueStatus[] = ["realized"] as const;

export interface RevenueEvent {
  /** Deterministic — see `idempotencyKey`. Doubles as the primary key. */
  id: string;
  /** Epoch millis the event was recorded. */
  createdAt: number;
  /** Account that generated the revenue, when one is identifiable. */
  userId: string | null;
  /** Reserved for organization-scoped billing; null until orgs exist. */
  organizationId: string | null;
  source: RevenueSource;
  engine: RevenueEngine;
  status: RevenueStatus;
  /** Asset id from lib/money (e.g. "USD", "USDC.base"). */
  asset: string;
  /** Settlement chain, when on-chain. Null for fiat. */
  chain: string | null;
  /** What FurlPay keeps, in minor units, as a decimal string. */
  feeMinor: string;
  /**
   * Gross amount that moved, in minor units. Null when the concept does not
   * apply — a flat subscription charge has no underlying volume, and
   * pretending it does would corrupt the take-rate denominator.
   */
  volumeMinor: string | null;
  /**
   * Fee as basis points of volume, when both are known. Derived, stored for
   * reporting convenience. Null when there is no volume to take a rate on.
   */
  feeBps: number | null;
  /** Provider reference: Stripe charge, on-chain tx hash, request id. */
  externalRef: string | null;
  /** Non-sensitive context. Never secrets, never PII, never card data. */
  metadata: Record<string, string | number | boolean | null>;
}

/**
 * The deterministic identity of a revenue event.
 *
 * Idempotency here is not "retry safety" as an afterthought — it is the
 * definition of the row. The key is derived from the underlying BUSINESS
 * event, so the same Stripe charge, the same settled transaction hash or the
 * same swap execution produces byte-identical keys no matter how many times a
 * webhook is redelivered or a handler retried.
 *
 * Note what is NOT in the key: timestamps, amounts, status. Including any of
 * them would let a redelivery with a recomputed amount create a second row,
 * which is precisely the double-count this prevents.
 */
export function idempotencyKey(source: RevenueSource, externalRef: string): string {
  const ref = externalRef.trim().toLowerCase();
  if (!ref) throw new Error(`revenue: ${source} needs a non-empty externalRef for idempotency`);
  return `${source}:${ref}`;
}

/** Basis points of `volume` that `fee` represents, or null when undefined. */
export function bpsOf(fee: Money, volume: Money | null): number | null {
  if (!volume || volume.isZero()) return null;
  // Integer math end to end: (fee * 10000) / volume, rounded half-up to a
  // whole basis point. Both are minor units of the same asset by construction.
  const num = fee.minor * 10_000n;
  const den = volume.minor;
  const whole = num / den;
  const rem = num % den;
  return Number(rem * 2n >= den ? whole + 1n : whole);
}

/**
 * Take `bps` basis points of `volume`.
 *
 * Rounding is "floor" — toward the customer. Taking the extra minor unit on
 * every transaction is how a platform quietly overcharges, and the direction
 * of a rounding decision on a fee is a business choice that should be written
 * down rather than defaulted.
 */
export function feeFromBps(volume: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`revenue: bps must be a non-negative integer, got ${bps}`);
  }
  return volume.scale(BigInt(bps), 10_000n, "floor");
}

/** Resolve an asset id to the registry entry, throwing on an unknown id. */
export function assetFor(id: string): Asset {
  return requireAsset(id);
}
