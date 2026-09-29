import { createHash } from "crypto";
import { sbRpc, supabaseBackend } from "./supabase";

// ---------------------------------------------------------------------------
// Durable webhook event registry — the THIRD dedupe layer (migration 0022).
//
// This does NOT replace webhookGuard (KV) or business idempotency or
// markCredited. It sits alongside them so the Postgres UNIQUE(provider,
// provider_event_id) constraint is the ultimate concurrency authority, surviving
// a KV/Upstash outage that would otherwise erase the fast dedupe set. Defense in
// depth for money movement.
//
// USAGE in a financial webhook, AFTER signature verification:
//
//   const claim = await claimWebhookEvent({ provider, eventId, eventType, payloadHash });
//   if (claim.payloadMismatch) { alert + 400 — a seen id with a different body }
//   if (!claim.claimed)        { ack 200 — a duplicate/redelivery, no effects }
//   try { ...effects...; await markWebhookProcessed(provider, eventId); }
//   catch (e) { await markWebhookFailed(provider, eventId, msg); throw/5xx to retry }
//
// FAIL-CLOSED. When Supabase is not configured this THROWS rather than pretending
// the event is claimed — a money-moving webhook must 5xx (and let the provider
// retry) rather than process without a durable record. The caller decides the
// status code; it must not swallow this into a 200.
// ---------------------------------------------------------------------------

export interface WebhookClaim {
  /** True when THIS caller owns processing (fresh event, or a retry of a failed/stale one). */
  claimed: boolean;
  /** True when the event was already registered and is not re-claimable (live or processed). */
  duplicate: boolean;
  /** The stored status: received | processing | processed | failed. */
  existingStatus: string;
  /**
   * True when this id was seen before with a DIFFERENT body. Suspicious: a
   * forged replay under a known id. The caller must NOT process and should alert.
   */
  payloadMismatch: boolean;
}

interface ClaimRow {
  claimed: boolean;
  duplicate: boolean;
  existing_status: string | null;
  payload_mismatch: boolean;
}

/** SHA-256 of the raw request body. Never store the body itself, only this. */
export function webhookPayloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function assertConfigured(): void {
  if (supabaseBackend !== "supabase") {
    throw new Error(
      "webhook_events store unavailable: Supabase is not configured. A financial " +
        "webhook must fail closed (5xx) rather than process without a durable record."
    );
  }
}

/**
 * Atomically claim a webhook event for processing. The Postgres UNIQUE
 * constraint (not this code) decides the winner of a concurrent race.
 */
export async function claimWebhookEvent(input: {
  provider: string;
  eventId: string;
  eventType?: string | null;
  payloadHash: string;
}): Promise<WebhookClaim> {
  assertConfigured();
  const rows = await sbRpc<ClaimRow[]>("claim_webhook_event", {
    p_provider: input.provider,
    p_provider_event_id: input.eventId,
    p_event_type: input.eventType ?? null,
    p_payload_hash: input.payloadHash,
  });
  const row = Array.isArray(rows) ? rows[0] : (rows as unknown as ClaimRow);
  if (!row) {
    // A claim call that returns nothing is an infrastructure fault, not a
    // "go ahead" — fail closed.
    throw new Error("claim_webhook_event returned no row");
  }
  return {
    claimed: !!row.claimed,
    duplicate: !!row.duplicate,
    existingStatus: row.existing_status ?? "unknown",
    payloadMismatch: !!row.payload_mismatch,
  };
}

/** Mark a claimed event processed — redeliveries then dedupe durably. */
export async function markWebhookProcessed(provider: string, eventId: string): Promise<void> {
  assertConfigured();
  await sbRpc<void>("mark_webhook_processed", {
    p_provider: provider,
    p_provider_event_id: eventId,
  });
}

/**
 * Mark a claimed event failed and RELEASE it: the next claim (provider
 * redelivery) re-enters processing and bumps attempt_count. Pair with a 5xx so
 * the provider actually retries. Error text is truncated server-side to 500 chars.
 */
export async function markWebhookFailed(
  provider: string,
  eventId: string,
  error: string
): Promise<void> {
  assertConfigured();
  await sbRpc<void>("mark_webhook_failed", {
    p_provider: provider,
    p_provider_event_id: eventId,
    p_error: error,
  });
}
