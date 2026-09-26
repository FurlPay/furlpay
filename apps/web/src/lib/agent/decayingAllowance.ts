// ---------------------------------------------------------------------------
// Decaying agent allowance — leaky token bucket.
//
// RELATIONSHIP TO agentPolicy.ts
// The existing control plane enforces a per-transaction cap and a rolling
// UTC-day budget. That is a good spend LIMIT but a poor spend SHAPE: a
// compromised agent key can drain the entire daily budget in one second, at
// 09:00:01, and the budget has no opinion about it. Then at midnight UTC the
// full budget returns at once.
//
// This module adds the missing dimension — RATE. Authority accrues
// continuously at rho minor-units per second up to a cap:
//
//     A(t) = min( cap,  A(t_last) + rho * (t - t_last) )   then subtract spend
//
// A drained bucket refills gradually, so an attacker who captures a key gets
// the bucket's current contents and then the trickle rate, not the day's
// budget. The legitimate pattern for an agent — many small spends spread over
// hours — is unaffected, which is what makes this cheap to adopt.
//
// This is a supplement, not a replacement: callers should enforce BOTH. The
// bucket bounds the burst, the daily budget bounds the total.
//
// INTEGER MINOR UNITS throughout. Accrual is computed in exact integer
// arithmetic against a stored timestamp rather than by a decrementing timer,
// so the result does not depend on being called on any particular schedule,
// and a process restart cannot silently refill the bucket.
// ---------------------------------------------------------------------------

export interface BucketConfig {
  /** Maximum authority the bucket can hold, in minor units. */
  capMinor: number;
  /**
   * Refill rate in minor units per second. A cap of $500 with a full refill
   * over 24h is rho = 50000/86400 — which is not an integer, so rates are
   * expressed as a numerator over a window rather than a rounded per-second
   * value. Rounding rho to an integer would silently change the policy.
   */
  refillMinorPerWindow: number;
  refillWindowSeconds: number;
  /**
   * Any single spend at or above this trips the bucket into step-up mode
   * regardless of available balance. Guards against one large legitimate-
   * looking transaction draining a well-funded bucket.
   */
  singleSpendStepUpMinor?: number;
}

export interface BucketState {
  /** Authority available as of `updatedAtMs`, in minor units. */
  availableMinor: number;
  /** Epoch milliseconds the balance was last computed. */
  updatedAtMs: number;
}

export type SpendDecision =
  | { outcome: "allow"; state: BucketState; availableAfterMinor: number }
  | {
      outcome: "step_up";
      reason: "single_spend_threshold";
      state: BucketState;
      thresholdMinor: number;
    }
  | {
      outcome: "deny";
      reason: "insufficient_allowance";
      state: BucketState;
      availableMinor: number;
      shortfallMinor: number;
      /** When the bucket will hold enough, or null if never at this cap. */
      retryAtMs: number | null;
    };

export class AllowanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowanceConfigError";
  }
}

function assertConfig(cfg: BucketConfig): void {
  if (!Number.isSafeInteger(cfg.capMinor) || cfg.capMinor <= 0) {
    throw new AllowanceConfigError(`capMinor must be a positive integer, got ${cfg.capMinor}`);
  }
  if (!Number.isSafeInteger(cfg.refillMinorPerWindow) || cfg.refillMinorPerWindow < 0) {
    throw new AllowanceConfigError(
      `refillMinorPerWindow must be a non-negative integer, got ${cfg.refillMinorPerWindow}`,
    );
  }
  if (!Number.isFinite(cfg.refillWindowSeconds) || cfg.refillWindowSeconds <= 0) {
    throw new AllowanceConfigError(
      `refillWindowSeconds must be positive, got ${cfg.refillWindowSeconds}`,
    );
  }
}

/** A bucket starts full: granting an allowance should be immediately usable. */
export function initBucket(cfg: BucketConfig, nowMs: number = Date.now()): BucketState {
  assertConfig(cfg);
  return { availableMinor: cfg.capMinor, updatedAtMs: nowMs };
}

/**
 * Accrue the bucket forward to `nowMs` without spending.
 *
 * Accrual floors to whole minor units — you cannot hold a third of a cent of
 * authority. Flooring is deliberately in the user's disfavour so repeated
 * small calls can never accrue MORE than the configured rate, which rounding
 * up or to-nearest would allow: call it 1000 times a second and the fractional
 * remainders would compound into free allowance.
 *
 * The floored remainder is not lost — because accrual is always computed from
 * `updatedAtMs`, and that timestamp only advances when whole units are
 * actually credited.
 */
export function accrue(cfg: BucketConfig, state: BucketState, nowMs: number): BucketState {
  assertConfig(cfg);

  // A clock that went backwards (NTP correction, a replayed record) must not
  // grant authority. Hold the balance and keep the later timestamp.
  if (nowMs <= state.updatedAtMs) {
    return { availableMinor: Math.min(state.availableMinor, cfg.capMinor), updatedAtMs: state.updatedAtMs };
  }
  if (state.availableMinor >= cfg.capMinor) {
    return { availableMinor: cfg.capMinor, updatedAtMs: nowMs };
  }

  const elapsedMs = nowMs - state.updatedAtMs;
  const windowMs = cfg.refillWindowSeconds * 1000;
  const accrued = Math.floor((cfg.refillMinorPerWindow * elapsedMs) / windowMs);

  if (accrued <= 0) {
    // Not yet a whole unit. Do NOT advance updatedAtMs, or the fractional
    // progress is discarded and a frequently-polled bucket never refills.
    return state;
  }

  const available = Math.min(cfg.capMinor, state.availableMinor + accrued);

  // Advance the clock only by the time actually converted into units, so the
  // leftover fraction carries into the next call.
  const consumedMs = Math.ceil((accrued * windowMs) / cfg.refillMinorPerWindow);
  return {
    availableMinor: available,
    updatedAtMs: available >= cfg.capMinor ? nowMs : state.updatedAtMs + Math.min(consumedMs, elapsedMs),
  };
}

/**
 * Evaluate a spend against the bucket.
 *
 * PURE: returns the decision and the resulting state; it does not persist.
 * The caller commits the returned state atomically alongside the spend, the
 * same reserve-then-commit discipline agentPolicy.ts already uses for the
 * daily budget. Deciding and persisting in one function would make the
 * concurrent case impossible to get right.
 */
export function evaluateSpend(
  cfg: BucketConfig,
  state: BucketState,
  amountMinor: number,
  nowMs: number = Date.now(),
): SpendDecision {
  assertConfig(cfg);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new AllowanceConfigError(`spend amountMinor must be a positive integer, got ${amountMinor}`);
  }

  const accrued = accrue(cfg, state, nowMs);

  // The single-spend gate is checked BEFORE the balance check. A large spend
  // should prompt for a passkey because it is large — not be refused for
  // insufficient funds, which tells the user the wrong thing and teaches them
  // to top up rather than to look at what their agent is doing.
  const threshold = cfg.singleSpendStepUpMinor;
  if (threshold !== undefined && amountMinor >= threshold) {
    return { outcome: "step_up", reason: "single_spend_threshold", state: accrued, thresholdMinor: threshold };
  }

  if (amountMinor > accrued.availableMinor) {
    const shortfallMinor = amountMinor - accrued.availableMinor;
    let retryAtMs: number | null = null;

    if (amountMinor <= cfg.capMinor && cfg.refillMinorPerWindow > 0) {
      const msToAccrue = Math.ceil(
        (shortfallMinor * cfg.refillWindowSeconds * 1000) / cfg.refillMinorPerWindow,
      );
      retryAtMs = nowMs + msToAccrue;
    }
    // amountMinor > capMinor leaves retryAtMs null: waiting will never help,
    // and telling a caller to retry at a time that cannot work is worse than
    // telling it the spend is impossible under this policy.

    return {
      outcome: "deny",
      reason: "insufficient_allowance",
      state: accrued,
      availableMinor: accrued.availableMinor,
      shortfallMinor,
      retryAtMs,
    };
  }

  return {
    outcome: "allow",
    state: { availableMinor: accrued.availableMinor - amountMinor, updatedAtMs: accrued.updatedAtMs },
    availableAfterMinor: accrued.availableMinor - amountMinor,
  };
}

/**
 * Refund a spend that failed downstream.
 *
 * Mirrors the reserve-then-refund pattern in agentPolicy.ts: authority is
 * deducted before the money moves, and returned if it did not. Capped at
 * `capMinor` so a refund cannot overfill the bucket past its policy.
 */
export function refund(cfg: BucketConfig, state: BucketState, amountMinor: number): BucketState {
  assertConfig(cfg);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new AllowanceConfigError(`refund amountMinor must be a positive integer, got ${amountMinor}`);
  }
  return {
    availableMinor: Math.min(cfg.capMinor, state.availableMinor + amountMinor),
    updatedAtMs: state.updatedAtMs,
  };
}

/** Convenience: a cap that fully refills over `hours`. */
export function bucketRefillingOver(capMinor: number, hours: number): BucketConfig {
  return { capMinor, refillMinorPerWindow: capMinor, refillWindowSeconds: hours * 3600 };
}
