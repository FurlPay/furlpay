// Webhook idempotency + version handling (Stripe-style best practice):
//  - dedup by event id so redelivered events are processed at most once
//  - mark an event processed only AFTER its handler succeeds; a failed handler
//    releases the id so the provider's redelivery gets retried (effectively-
//    once) instead of being swallowed as a duplicate (at-most-once, lost).
//  - tolerate/echo an API version header without failing on unknown versions
// In production the processed-set lives in Redis/Postgres with the same
// tryBegin/markProcessed/markFailed semantics (INSERT ... ON CONFLICT).

type EventStatus = "processing" | "processed";

const MAX_EVENTS = 10_000;

const g = globalThis as unknown as { __webhookEvents?: Map<string, EventStatus> };
const events = (): Map<string, EventStatus> => (g.__webhookEvents ??= new Map());

export const CURRENT_WEBHOOK_VERSION = "2026-07-01.furl";

/**
 * Claim an event id for processing. Returns false when the event was already
 * processed (redelivery of a success) or is being processed right now
 * (concurrent redelivery) — the caller should ack without re-running effects.
 */
export function tryBegin(eventId: string): boolean {
  const store = events();
  if (store.has(eventId)) return false;
  store.set(eventId, "processing");
  bound(store);
  return true;
}

/** The handler succeeded — redeliveries of this id are dups from now on. */
export function markProcessed(eventId: string): void {
  events().set(eventId, "processed");
}

/**
 * The handler failed — release the id so the provider's redelivery is
 * processed again. Pair with returning a 5xx so the provider actually retries.
 */
export function markFailed(eventId: string): void {
  events().delete(eventId);
}

function bound(store: Map<string, EventStatus>): void {
  // Bound memory: evict oldest entries (Map preserves insertion order).
  while (store.size > MAX_EVENTS) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

/**
 * Resolve a webhook endpoint secret. The sandbox fallback is public (it lives
 * in this repo), so verifying against it in production would let anyone forge
 * signed events — return null there and have the route 503 instead.
 */
export function endpointSecret(envValue: string | undefined, sandboxFallback: string): string | null {
  if (envValue && envValue !== sandboxFallback) return envValue;
  if (process.env.NODE_ENV === "production") return null;
  return sandboxFallback;
}

export function resolveVersion(header: string | null): string {
  // Accept any version; default to current. (Unknown versions are non-fatal.)
  return header || CURRENT_WEBHOOK_VERSION;
}
