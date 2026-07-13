import { api, ApiError, NetworkError } from "./api";
import { deletePendingAction, listPendingActions, markPendingActionError } from "./db";

// ---------------------------------------------------------------------------
// Outbox flush: transfers queued while offline are replayed when connectivity
// returns. Every queued action carries a stable Idempotency-Key, so a retry
// that raced a previous attempt can never double-spend (the server replays
// the original response).
// ---------------------------------------------------------------------------

let flushing = false;

export async function flushPendingActions(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const action of listPendingActions()) {
      if (action.type !== "transfer") continue;
      try {
        await api("/wallets/transfer", {
          method: "POST",
          body: JSON.parse(action.payload),
          headers: { "Idempotency-Key": action.idempotencyKey },
        });
        deletePendingAction(action.id);
        sent++;
      } catch (e) {
        if (e instanceof NetworkError) break; // still offline — stop, keep queue
        // Server rejected it (4xx/5xx): record and drop after repeated failures
        // rather than replaying a doomed payment forever.
        const message = e instanceof ApiError ? `${e.status}: ${e.message}` : String(e);
        markPendingActionError(action.id, message);
        if (action.retryCount >= 2 || (e instanceof ApiError && e.status < 500)) {
          deletePendingAction(action.id);
        }
        failed++;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}
