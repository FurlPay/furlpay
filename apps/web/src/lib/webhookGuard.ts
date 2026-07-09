// Webhook idempotency + version handling (Stripe-style best practice):
//  - dedup by event id so redelivered events are processed at most once
//  - mark an event processed only AFTER its handler succeeds; a failed handler
//    releases the id so the provider's redelivery gets retried (effectively-
//    once) instead of being swallowed as a duplicate (at-most-once, lost).
//  - tolerate/echo an API version header without failing on unknown versions
//
// The processed-set lives in the durable KV layer (Upstash Redis in prod,
// bounded memory in dev) under `wh:dedup:{eventId}` with a 24h TTL, so a
// redelivery landing on a DIFFERENT serverless instance still dedupes.

import { kvSetNx, kvSet, kvDel } from "./kv";

const KEY = (eventId: string) => `wh:dedup:${eventId}`;
const TTL_SECONDS = 86_400; // 24h — outlives every provider's retry window

export const CURRENT_WEBHOOK_VERSION = "2026-07-01.furl";

/**
 * Atomically claim an event id for processing. Returns false when the event
 * was already processed (redelivery of a success) or is being processed right
 * now (concurrent redelivery) — the caller should ack without re-running
 * effects.
 */
export async function tryBegin(eventId: string): Promise<boolean> {
  return kvSetNx(KEY(eventId), "processing", TTL_SECONDS);
}

/** The handler succeeded — redeliveries of this id are dups from now on. */
export async function markProcessed(eventId: string): Promise<void> {
  await kvSet(KEY(eventId), "processed", TTL_SECONDS);
}

/**
 * The handler failed — release the id so the provider's redelivery is
 * processed again. Pair with returning a 5xx so the provider actually retries.
 */
export async function markFailed(eventId: string): Promise<void> {
  await kvDel(KEY(eventId));
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
