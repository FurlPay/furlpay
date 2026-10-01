import { log } from "./log";
import { raiseFinancialAlert } from "./ops/financialAlerts";
import { supabaseBackend } from "./supabase";
import {
  claimWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
  webhookPayloadHash,
} from "./webhookEvents";

// ---------------------------------------------------------------------------
// withDurableWebhook — one reusable wrapper that adds the durable Postgres
// dedupe layer (migration 0022) to a financial webhook, WITHOUT touching the
// route's provider-specific signature verification.
//
// It is deliberately called AFTER the route has verified the provider signature
// and extracted the event id — signature semantics differ per provider and must
// stay in the route. Everything below the signature is identical across
// providers, so it lives here once instead of being copy-pasted nine times.
//
// ORDERING (the safety-critical part): claim BEFORE the financial effect, mark
// processed AFTER it succeeds. A handler that throws marks the event FAILED and
// rethrows, so the route's existing error handling returns a retryable 5xx and
// the durable row is released for the provider's redelivery. The event is never
// marked processed before the money moves.
//
// FAIL CLOSED: if the durable store is unavailable, claimWebhookEvent throws and
// this returns the caller's `onUnavailable` (a 5xx) WITHOUT running the handler —
// no financial effect without a durable record.
//
// This does NOT replace webhookGuard (KV), business idempotency, markCredited or
// ledger constraints. It is one more independent layer.
// ---------------------------------------------------------------------------

export interface DurableWebhookOptions<T> {
  provider: string;
  /** The provider's own event id — the dedupe key. */
  eventId: string;
  eventType?: string | null;
  /** The EXACT verified raw body; hashed to detect a same-id/different-body replay. */
  rawBody: string;
  /** The financial effect. Runs at most once per (provider, eventId). */
  handler: () => Promise<T>;
  /** Build the response for a duplicate/redelivery (no effect re-run). */
  onDuplicate: (existingStatus: string) => T;
  /** Build the response for a same-id/different-body replay (no effect). */
  onMismatch: () => T;
  /** Build the response when the durable store is unavailable (must be a 5xx). */
  onUnavailable: (error: Error) => T;
}

export async function withDurableWebhook<T>(opts: DurableWebhookOptions<T>): Promise<T> {
  // The durable layer engages ONLY where the Postgres store actually exists
  // (production/staging Supabase). In dev/test the table is not provisioned, so
  // this bypasses to the handler and the existing KV dedupe + business
  // idempotency + markCredited + ledger constraints remain the protection — the
  // same set that protected these routes before 0022. This is NOT the "DB down"
  // case: a configured store that then errors DOES fail closed below.
  if (supabaseBackend !== "supabase") {
    return opts.handler();
  }

  const payloadHash = webhookPayloadHash(opts.rawBody);

  let claim;
  try {
    claim = await claimWebhookEvent({
      provider: opts.provider,
      eventId: opts.eventId,
      eventType: opts.eventType ?? null,
      payloadHash,
    });
  } catch (e) {
    // Durable store unavailable → fail closed. No financial effect.
    log.error("durable webhook claim failed; failing closed", {
      provider: opts.provider,
      eventId: opts.eventId,
      error: (e as Error).message.slice(0, 200),
    });
    return opts.onUnavailable(e as Error);
  }

  // Same id seen before with a DIFFERENT body — a forged replay. Never process.
  if (claim.payloadMismatch) {
    log.error("webhook payload mismatch: same event id, different body", {
      provider: opts.provider,
      eventId: opts.eventId,
      existingStatus: claim.existingStatus,
    });
    void raiseFinancialAlert("webhook_payload_mismatch", { provider: opts.provider, eventId: opts.eventId });
    return opts.onMismatch();
  }

  // A live or already-processed duplicate. Acknowledge without re-running effects.
  if (!claim.claimed) {
    return opts.onDuplicate(claim.existingStatus);
  }

  // We own it. Run the handler.
  let result: T;
  try {
    result = await opts.handler();
  } catch (e) {
    // The handler failed: release for retry; the route's error path returns a
    // retryable 5xx. Financial effects are keyed (migration 0025), so a retry
    // that reaches an effect already committed is a no-op, not a second effect.
    await markWebhookFailed(opts.provider, opts.eventId, (e as Error).message).catch((err: Error) => {
      log.error("durable webhook: could not mark failed", { provider: opts.provider, eventId: opts.eventId, error: err.message });
    });
    throw e;
  }

  // The handler SUCCEEDED. A failure to record that is an acknowledgement
  // problem, not a processing failure, and it must not be turned into one.
  // The old code marked the event FAILED here and returned 5xx, which invited
  // the provider to redeliver and 0022 to re-claim — re-running an effect that
  // had already happened (audit P0-1). Now: log (paging alert), and return the
  // handler's success. Money effects already marked the row processed inside
  // their own transaction; for anything else, a later redelivery re-runs an
  // idempotent handler.
  try {
    await markWebhookProcessed(opts.provider, opts.eventId);
  } catch (e) {
    log.error("durable webhook: ack failed after successful handler", {
      provider: opts.provider,
      eventId: opts.eventId,
      error: (e as Error).message.slice(0, 200),
    });
    void raiseFinancialAlert("webhook_ack_failed", { provider: opts.provider, eventId: opts.eventId });
  }
  return result;
}
