// Webhook idempotency + version handling (Stripe-style best practice):
//  - dedup by event id so redelivered events are processed at most once
//  - tolerate/echo an API version header without failing on unknown versions
// In production the processed-set lives in Redis/Aurora; here it's in-memory.

const globalForWebhooks = globalThis as unknown as { __processedEvents?: Set<string> };
const processed: Set<string> =
  globalForWebhooks.__processedEvents ?? (globalForWebhooks.__processedEvents = new Set());

export const CURRENT_WEBHOOK_VERSION = "2026-07-01.furl";

/** Returns true the first time an event id is seen, false on any redelivery. */
export function markProcessed(eventId: string): boolean {
  if (processed.has(eventId)) return false;
  processed.add(eventId);
  // Bound memory in the demo.
  if (processed.size > 5000) {
    const first = processed.values().next().value;
    if (first) processed.delete(first);
  }
  return true;
}

export function resolveVersion(header: string | null): string {
  // Accept any version; default to current. (Unknown versions are non-fatal.)
  return header || CURRENT_WEBHOOK_VERSION;
}
