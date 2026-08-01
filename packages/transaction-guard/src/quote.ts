// ---------------------------------------------------------------------------
// Quote freshness.
//
// Aggregator calldata is priced at build time. It embeds a rate and usually a
// minimum-received floor the router enforces on-chain, so signing it several
// minutes later asks that router to honour a market that has moved — a revert
// on slippage at best, and at worst an execution at a price the user was never
// shown.
//
// WHO OWNS THE EXPIRY. Some quote APIs return one; many do not. LI.FI's classic
// /v1/quote, for instance, returns no expiry field at all — so a wallet reading
// only what the aggregator sends has no freshness guarantee whatsoever and
// usually does not realise it.
//
// Hence `assertFresh` treats a MISSING expiry as stale rather than eternal. The
// absence of a freshness guarantee is not a freshness guarantee, and the
// failure mode of the opposite default is a signature over an hours-old price.
// ---------------------------------------------------------------------------

import { GuardRejection } from "./rejection.js";

export interface Expirable {
  /** ISO-8601 timestamp, or epoch milliseconds. */
  expiresAt?: string | number | null;
}

/** Milliseconds until a quote expires; negative when already expired. */
export function timeUntilExpiry(quote: Expirable, now = Date.now()): number | null {
  const expires = parseExpiry(quote.expiresAt);
  return expires === null ? null : expires - now;
}

/** True when the quote carries a readable expiry that has not passed. */
export function isFresh(quote: Expirable, now = Date.now()): boolean {
  const remaining = timeUntilExpiry(quote, now);
  return remaining !== null && remaining > 0;
}

/**
 * True when a quote is close enough to expiry that it should be re-quoted
 * rather than presented for signing.
 *
 * A quote with four seconds left is technically fresh and practically useless:
 * the user still has to read a confirmation and approve on a device. Refusing
 * it early is kinder than letting it expire mid-approval.
 */
export function isExpiringSoon(quote: Expirable, withinMs = 15_000, now = Date.now()): boolean {
  const remaining = timeUntilExpiry(quote, now);
  return remaining !== null && remaining > 0 && remaining <= withinMs;
}

/**
 * Throws unless the quote is fresh.
 *
 * @throws GuardRejection with reason `no_expiry` or `expired`.
 */
export function assertFresh(quote: Expirable, now = Date.now()): void {
  const expires = parseExpiry(quote.expiresAt);
  if (expires === null) {
    throw new GuardRejection(
      "no_expiry",
      "This quote didn't come with an expiry, so its price can't be trusted. Get a fresh one."
    );
  }
  if (now >= expires) {
    throw new GuardRejection("expired", "That quote expired. Get a fresh price and try again.");
  }
}

function parseExpiry(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
