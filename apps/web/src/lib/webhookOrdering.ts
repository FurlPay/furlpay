import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Webhook ORDERING, which is a different problem from webhook idempotency.
//
// webhookGuard.ts already solves "the same event twice": claim the id, process,
// mark. It cannot solve "two different events, in the wrong order", because
// each id is genuinely new and each claim genuinely succeeds. Providers deliver
// at-least-once and make NO ordering guarantee — retries, parallel delivery
// workers and network reordering all put a later event on the wire ahead of an
// earlier one routinely.
//
// The failure that costs money: `deposit.reversed` arrives, is applied, and
// then a delayed `deposit.settled` for the same deposit arrives and credits the
// account. Both were valid events. Both were processed exactly once. The
// balance is wrong.
//
// TWO GUARDS, because they catch different things:
//
//   staleEvent()      — a per-RESOURCE high-water mark on the provider's own
//                       occurredAt. An event older than the newest one already
//                       applied to that resource is dropped. This is the
//                       general case and needs nothing from the caller but a
//                       stable resource key and a timestamp.
//
//   transitionAllowed() — a state machine for the cases where "older" is not
//                       decidable from a timestamp, most importantly KYC. A
//                       verified user must not be silently walked back to
//                       unverified by a redelivered older inquiry event; that
//                       transition needs a human, not a retry.
//
// FAIL-OPEN IS DELIBERATE for staleEvent when KV is unavailable. Idempotency
// (webhookGuard) is the control that must fail closed, and it does. Ordering is
// a refinement on top: dropping every event during a KV outage would turn a
// cache blip into lost deposits, which is worse than the reordering it
// prevents. The outage is logged at warn so it is visible.
// ---------------------------------------------------------------------------

const KEY = (resource: string) => `wh:seq:${resource}`;
/** Long enough to outlive any provider's retry window several times over. */
const TTL_SECONDS = 30 * 24 * 3600;

export interface OrderedEvent {
  /** Stable id for the THING being changed — a deposit id, a user id, a
   *  payment id. NOT the event id: two events about one deposit must compare. */
  resource: string;
  /** When the provider says it happened. Milliseconds since epoch. */
  occurredAtMs: number;
}

/**
 * True when this event is older than one already applied to the same resource,
 * and must therefore be dropped rather than applied.
 *
 * Equal timestamps are NOT stale: providers commonly stamp a burst of related
 * events with the same millisecond, and dropping the second would lose a real
 * change. Idempotency already stops a true duplicate.
 */
export async function staleEvent(event: OrderedEvent): Promise<boolean> {
  if (!Number.isFinite(event.occurredAtMs)) return false;
  try {
    const last = await kvGet<number>(KEY(event.resource));
    if (typeof last === "number" && event.occurredAtMs < last) {
      log.warn("dropping out-of-order webhook", {
        resource: event.resource,
        occurredAtMs: event.occurredAtMs,
        lastAppliedMs: last,
      });
      return true;
    }
    return false;
  } catch (e) {
    log.warn("ordering check unavailable — processing anyway", {
      resource: event.resource,
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Record that this event has been applied, so a later-arriving earlier event is
 * recognised as stale.
 *
 * Call AFTER the handler succeeds, alongside markProcessed. Recording before
 * would make a failed handler's event look applied, and the provider's retry —
 * carrying the same timestamp — would still pass (equal is not stale), but any
 * genuinely earlier event in between would be wrongly dropped.
 */
export async function recordApplied(event: OrderedEvent): Promise<void> {
  if (!Number.isFinite(event.occurredAtMs)) return;
  try {
    const last = await kvGet<number>(KEY(event.resource));
    if (typeof last === "number" && last >= event.occurredAtMs) return;
    await kvSet(KEY(event.resource), event.occurredAtMs, TTL_SECONDS);
  } catch (e) {
    log.warn("could not record webhook ordering mark", {
      resource: event.resource,
      error: (e as Error).message,
    });
  }
}

/**
 * Parse whatever timestamp a provider sent. Seconds, milliseconds or ISO.
 *
 * Returns NaN for anything unusable, which staleEvent treats as "cannot order"
 * and lets through: an unorderable event is not the same as an old one.
 *
 * ZERO AND NEGATIVE ARE UNUSABLE, not "the epoch". `Number("")` is 0 and
 * `Number(" ")` is 0, so an empty or whitespace timestamp field would otherwise
 * parse as 1 Jan 1970 — a real number, ordered against, and permanently older
 * than everything. No provider means that; every one of them means "I did not
 * send you a timestamp".
 */
export function occurredAtMs(raw: unknown): number {
  const scale = (n: number): number => (n > 1e12 ? n : n * 1000);

  if (typeof raw === "number") {
    // Providers are inconsistent about the unit; anything below ~1e12 is
    // seconds. Guessing wrong by 1000x would make every event look ancient.
    return Number.isFinite(raw) && raw > 0 ? scale(raw) : Number.NaN;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return Number.NaN;

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) return scale(numeric);
  }

  return Number.NaN;
}

// ── KYC state machine ──────────────────────────────────────────────────────

export type KycState = "unverified" | "pending" | "verified";

/**
 * May a webhook move a user from `from` to `to`?
 *
 * The transition that must never happen automatically is verified →
 * unverified. A user who has passed identity verification, been granted a
 * higher tier cap and possibly transacted against it should not be demoted
 * because a redelivered older `inquiry.failed` turned up an hour later. Real
 * revocations exist, but they are a compliance decision with an audit trail,
 * not a retry.
 *
 * Everything else is permitted: verification legitimately moves forward, and a
 * pending user failing is the normal unhappy path.
 */
export function kycTransitionAllowed(from: KycState, to: KycState): boolean {
  if (from === to) return true;
  if (from === "verified" && to !== "verified") return false;
  return true;
}
