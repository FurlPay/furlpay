import { api, ApiError, NetworkError } from "./api";
import { deletePendingAction, listPendingActions, markPendingActionError, recordNotification } from "./db";

// ---------------------------------------------------------------------------
// Outbox flush: transfers queued while offline are replayed when connectivity
// returns. Every queued action carries a stable Idempotency-Key, so a retry
// that raced a previous attempt can never double-spend (the server replays
// the original response).
// ---------------------------------------------------------------------------

// A transfer was biometric-confirmed at QUEUE time; that consent goes stale.
// Firing a forgotten payment days later — when the balance, the recipient
// relationship, or the user's intent may have changed — is worse than not
// sending it, so anything older than this is dropped with a visible notice.
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

let flushing = false;

export async function flushPendingActions(): Promise<{ sent: number; failed: number; expired: number }> {
  if (flushing) return { sent: 0, failed: 0, expired: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  let expired = 0;
  try {
    for (const action of listPendingActions()) {
      if (action.type !== "transfer") continue;
      if (Date.now() - action.createdAt > MAX_PENDING_AGE_MS) {
        deletePendingAction(action.id);
        // Surface the drop in the notification inbox — a silently vanished
        // payment is indistinguishable from a sent one.
        recordNotification({
          id: `expired_${action.id}`,
          title: "Queued transfer expired",
          body: "A transfer queued while offline was not sent within 24 hours and has been cancelled. Nothing was charged — please send it again.",
        });
        expired++;
        continue;
      }
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
  return { sent, failed, expired };
}
