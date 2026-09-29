import { kvGet, kvIncrBy } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// The burst bound, made atomic.
//
// WHAT WAS WRONG. lib/agent/decayingAllowance.ts is a correct leaky bucket and a
// pure function, but wiring it meant READ the balance, compute, WRITE it back.
// agentPolicy.ts's own comment conceded the consequence:
//
//     "This bucket is read-modify-write on KV and is NOT [atomic], so two
//      simultaneous spends can both observe the same balance. The burst bound is
//      therefore soft under concurrency."
//
// Measured, that is not a small gap. Ten concurrent $20 authorizations against a
// $25 bucket all read a full bucket, all pass the burst gate, and the burst bound
// contributes nothing — the daily counter is left doing the whole job, which is
// exactly the spend SHAPE problem the bucket was added to solve.
//
// WHY A SLIDING-WINDOW COUNTER AND NOT A LOCK. A lock around a money path is an
// availability vulnerability: whoever can make the holder slow can stall every
// other authorization, and a lock that must not deadlock needs a timeout, which
// reintroduces the question of what to do when it expires. `kvIncrBy` is already
// atomic (Redis INCRBY), and the daily budget already uses it in a
// reserve-then-refund shape. This applies the same discipline to the burst bound:
// increment FIRST, compare SECOND, refund if it overshot. Two concurrent spends
// can therefore both be denied — which is a retry — but the cap can never be
// exceeded, which would be money gone.
//
// THE APPROXIMATION, STATED HONESTLY. A true leaky bucket drains continuously. A
// two-window sliding counter weights the previous window by how much of the
// current one has elapsed, so its estimate is exact at a window boundary and
// slightly generous mid-window for traffic that was front-loaded in the previous
// window. The error is bounded by one window's capacity and it is bounded in the
// SAFE direction more often than not; what it buys is atomicity, which the exact
// algorithm could not have without a Lua script this KV layer does not expose.
//
// FAIL CLOSED. Every KV fault denies, matching the daily counter's posture for
// agent money movement. A burst bound that fails open is not a bound.
// ---------------------------------------------------------------------------

/** Two windows are retained: the current one and its predecessor. */
const RETAIN_WINDOWS = 3;

export interface BurstConfig {
  /** Most that may be spent, in minor units, within any `windowSeconds`. */
  readonly capMinor: number;
  /** Length of the sliding window, in seconds. */
  readonly windowSeconds: number;
}

/**
 * Derive the window from a cap and a refill rate.
 *
 * `capMinor` over `refillMinorPerPeriod` per `refillPeriodSeconds` is the same
 * statement as "at most capMinor per W seconds", where W is how long the refill
 * takes to restore a full cap. Expressing it this way is what makes the bound
 * implementable with counters instead of a continuously-draining balance.
 */
export function burstConfigFrom(input: {
  readonly capMinor: number;
  readonly refillMinorPerPeriod: number;
  readonly refillPeriodSeconds: number;
}): BurstConfig {
  const cap = Math.max(1, Math.floor(input.capMinor));
  const rate = Math.max(1, Math.floor(input.refillMinorPerPeriod));
  const seconds = Math.max(1, Math.round((input.refillPeriodSeconds * cap) / rate));
  return { capMinor: cap, windowSeconds: seconds };
}

export type BurstOutcome =
  | { readonly allowed: true; readonly usedMinor: number; readonly capMinor: number }
  | {
      readonly allowed: false;
      readonly reason: "burst_rate_exceeded" | "burst_amount_exceeds_cap" | "burst_store_unavailable";
      readonly detail: string;
      readonly retryAfterSeconds: number | null;
    };

function windowKeys(namespace: string, config: BurstConfig, nowMs: number) {
  const index = Math.floor(nowMs / 1000 / config.windowSeconds);
  return {
    index,
    current: `${namespace}:${index}`,
    previous: `${namespace}:${index - 1}`,
    /** How far into the current window we are, 0..1. */
    elapsed: ((nowMs / 1000) % config.windowSeconds) / config.windowSeconds,
  };
}

/**
 * Reserve `amountMinor` against the burst bound, atomically.
 *
 * Returns `allowed: false` having already returned any reservation it made, so a
 * denial never leaves the window over-counted. The one exception is a KV fault on
 * the refund path, which under-spends rather than over-spends and is logged.
 */
export async function reserveBurst(input: {
  readonly namespace: string;
  readonly config: BurstConfig;
  readonly amountMinor: number;
  readonly nowMs?: number;
}): Promise<BurstOutcome> {
  const { namespace, config } = input;
  const amount = Math.round(input.amountMinor);
  const nowMs = input.nowMs ?? Date.now();

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      allowed: false,
      reason: "burst_amount_exceeds_cap",
      detail: "amount must be a positive integer number of minor units",
      retryAfterSeconds: null,
    };
  }

  // A single spend larger than the whole window's capacity can never succeed, and
  // saying so with `retryAfterSeconds: null` is the difference between "wait" and
  // "this will never work". decayingAllowance made the same distinction; losing it
  // is how a caller ends up retrying forever.
  if (amount > config.capMinor) {
    return {
      allowed: false,
      reason: "burst_amount_exceeds_cap",
      detail: `a single authorization of ${amount} exceeds the ${config.capMinor} burst cap; waiting will not help`,
      retryAfterSeconds: null,
    };
  }

  const keys = windowKeys(namespace, config, nowMs);
  const ttl = config.windowSeconds * RETAIN_WINDOWS;

  // RESERVE FIRST. The increment is atomic, so concurrent callers each see their
  // own post-increment total and cannot both read a stale "there is room".
  let currentTotal: number;
  try {
    currentTotal = await kvIncrBy(keys.current, amount, ttl);
  } catch (e) {
    log.error("burst window counter unavailable", { namespace, error: (e as Error).message });
    return {
      allowed: false,
      reason: "burst_store_unavailable",
      detail: "burst counter could not be reserved; denying rather than proceeding unbounded",
      retryAfterSeconds: null,
    };
  }

  let previousTotal = 0;
  try {
    previousTotal = Number((await kvGet<number>(keys.previous)) ?? 0) || 0;
  } catch (e) {
    // The predecessor is unreadable. Treat it as FULL rather than empty: assuming
    // zero would widen the allowance exactly when we cannot see what was spent.
    log.warn("burst previous window unreadable; assuming full", {
      namespace,
      error: (e as Error).message,
    });
    previousTotal = config.capMinor;
  }

  const estimated = Math.round(previousTotal * (1 - keys.elapsed)) + currentTotal;

  if (estimated > config.capMinor) {
    await refund(keys.current, amount, ttl, namespace);
    // When the window rolls, the previous window's weighted contribution drops
    // out. That is the earliest moment a retry could succeed.
    const remainingWindow = Math.ceil(config.windowSeconds * (1 - keys.elapsed));
    return {
      allowed: false,
      reason: "burst_rate_exceeded",
      detail: `burst usage would reach ${estimated} against a cap of ${config.capMinor}`,
      retryAfterSeconds: Math.max(1, remainingWindow),
    };
  }

  return { allowed: true, usedMinor: estimated, capMinor: config.capMinor };
}

/**
 * Return a reservation for an authorization that was refused downstream.
 *
 * The lockout this prevents is the one F-2 fixed for the old bucket: the burst
 * bound is debited before the daily counter is consulted, so a payment the daily
 * counter refuses must give its reservation back or a payment that moved no money
 * permanently reduces future capacity.
 */
export async function releaseBurst(input: {
  readonly namespace: string;
  readonly config: BurstConfig;
  readonly amountMinor: number;
  readonly nowMs?: number;
}): Promise<void> {
  const keys = windowKeys(input.namespace, input.config, input.nowMs ?? Date.now());
  await refund(keys.current, Math.round(input.amountMinor), input.config.windowSeconds * RETAIN_WINDOWS, input.namespace);
}

async function refund(key: string, amount: number, ttl: number, namespace: string): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    await kvIncrBy(key, -amount, ttl);
  } catch (e) {
    // The window stays over-counted until it expires, which under-spends rather
    // than over-spends. Same trade the daily counter's refund path takes.
    log.error("burst window refund failed", { namespace, error: (e as Error).message });
  }
}

/** Current usage estimate, for an ops console. Never used for a decision. */
export async function burstUsage(input: {
  readonly namespace: string;
  readonly config: BurstConfig;
  readonly nowMs?: number;
}): Promise<{ usedMinor: number; capMinor: number; windowSeconds: number }> {
  const keys = windowKeys(input.namespace, input.config, input.nowMs ?? Date.now());
  const [current, previous] = await Promise.all([
    kvGet<number>(keys.current).catch(() => 0),
    kvGet<number>(keys.previous).catch(() => 0),
  ]);
  const used = Math.round((Number(previous ?? 0) || 0) * (1 - keys.elapsed)) + (Number(current ?? 0) || 0);
  return { usedMinor: Math.max(0, used), capMinor: input.config.capMinor, windowSeconds: input.config.windowSeconds };
}
