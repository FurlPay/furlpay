import { api, ApiError, NetworkError } from "./api";
import {
  deletePendingAction,
  listDueActions,
  markActionSending,
  markActionFailed,
  rescheduleAction,
  recoverStuckActions,
  recordNotification,
  type PendingAction,
} from "./db";

// ---------------------------------------------------------------------------
// Outbox flush.
//
// Writes queued while offline — or interrupted mid-flight — are replayed when
// connectivity returns. Every queued action carries a STABLE Idempotency-Key
// minted once at queue time, so a retry that raced a previous attempt can never
// double-spend: the server replays the original response instead.
//
// Three properties the competitor teardowns list as missing in both apps:
//
//  1. CRASH RECOVERY. A row is marked `sending` before the request leaves, so
//     an app killed mid-POST leaves evidence. On the next flush those rows are
//     re-queued rather than failed — the request may already have landed, and
//     the idempotency key makes replaying it safe. Failing them instead would
//     strand a payment that actually succeeded.
//
//  2. BACKOFF. Retries are spaced exponentially with jitter. Without it, every
//     client with anything queued retries on every connectivity flap, which is
//     precisely when a struggling server can least afford it.
//
//  3. TERMINAL FAILURES ARE VISIBLE. A rejected action is kept in `failed`
//     state and announced, not silently deleted. A payment that vanishes
//     without a word is indistinguishable from one that went through.
// ---------------------------------------------------------------------------

// A transfer is biometric-confirmed at QUEUE time, and that consent goes stale.
// Firing a forgotten payment days later — when the balance, the recipient
// relationship, or the user's intent may have changed — is worse than not
// sending it, so anything older than this is dropped with a visible notice.
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

/** A row still `sending` after this long belongs to a process that died. */
const STALE_SENDING_MS = 90 * 1000;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

/**
 * Exponential backoff with full jitter.
 *
 * The jitter is not decoration: without it every client that queued during the
 * same outage retries at the same instants, and the recovering server gets a
 * synchronised stampede at 5s, 10s, 20s… Randomising across the window spreads
 * the same load flat.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.floor(random() * ceiling);
}

/** A 4xx will fail identically forever; only 5xx and transport errors retry. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  if (e instanceof ApiError) return e.status >= 500 || e.status === 429;
  return false;
}

export interface FlushResult {
  sent: number;
  failed: number;
  expired: number;
  deferred: number;
  recovered: number;
}

let flushing = false;

export async function flushPendingActions(now: number = Date.now()): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, expired: 0, deferred: 0, recovered: 0 };
  if (flushing) return result;
  flushing = true;

  try {
    // Before anything else, reclaim rows a previous run died holding.
    result.recovered = recoverStuckActions(STALE_SENDING_MS, now);

    for (const action of listDueActions(now)) {
      if (now - action.createdAt > MAX_PENDING_AGE_MS) {
        expire(action);
        result.expired++;
        continue;
      }

      // Written BEFORE the request leaves. If the app dies on the next line,
      // this is the only record that the request may have gone out.
      markActionSending(action.id, now);

      try {
        await api(action.endpoint, {
          method: "POST",
          body: JSON.parse(action.payload),
          headers: { "Idempotency-Key": action.idempotencyKey },
        });
        deletePendingAction(action.id);
        result.sent++;
      } catch (e) {
        const correlationId = e instanceof ApiError ? (e.correlationId ?? null) : null;
        const message = describe(e);

        if (e instanceof NetworkError) {
          // Still offline. Put it back untouched — this is not a failed
          // attempt, it never left — and stop, since the rest will fare no
          // better this pass.
          rescheduleAction(action.id, now, message, correlationId);
          result.deferred++;
          break;
        }

        const attempt = action.retryCount + 1;
        if (isRetryable(e) && attempt < MAX_ATTEMPTS) {
          rescheduleAction(action.id, now + backoffMs(attempt), message, correlationId);
          result.deferred++;
          continue;
        }

        markActionFailed(action.id, message, correlationId);
        announceFailure(action, message, correlationId);
        result.failed++;
      }
    }
  } finally {
    flushing = false;
  }

  return result;
}

function expire(action: PendingAction): void {
  deletePendingAction(action.id);
  // A silently vanished payment is indistinguishable from a sent one.
  recordNotification({
    id: `expired_${action.id}`,
    title: `${action.label} expired`,
    body: `A ${action.label.toLowerCase()} queued while offline was not sent within 24 hours and has been cancelled. Nothing was charged — please try again.`,
  });
}

function announceFailure(action: PendingAction, message: string, correlationId: string | null): void {
  // The reference code is what turns "it didn't work" into a support ticket
  // someone can actually resolve.
  const reference = correlationId ? ` Reference ${correlationId}.` : "";
  recordNotification({
    id: `failed_${action.id}`,
    title: `${action.label} could not be sent`,
    body: `${message}${reference} Nothing was charged.`,
  });
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.data as { detail?: string } | null)?.detail;
    return detail ?? e.message;
  }
  if (e instanceof NetworkError) return "No connection.";
  return (e as Error)?.message ?? "Something went wrong.";
}
