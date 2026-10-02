import { track } from "@vercel/analytics";

// The ONLY custom events this app sends to Vercel Web Analytics.
//
// Rules (docs/analytics/VERCEL_ANALYTICS_AUDIT.md). Product-lifecycle facts
// (signup, login, KYC, cashback) are NOT sent here: they are recorded
// server-side, idempotently, in lib/analytics/events.ts (analytics_events).
//
//   - an event names a completed outcome or a deliberate intent, never "a
//     component rendered";
//   - an outcome event fires on the provider's confirmation, not on a click
//     or on a success page loading;
//   - properties are closed enums — never free text, ids, emails, wallet
//     addresses, amounts tied to a person, or tokens. Pro allows 2 per event;
//   - no identify(): the script only writes localStorage when a user/group id
//     is set, so never setting one keeps analytics storage-free on the device.
//
// Deliberately absent: payment_completed / checkout events. Production money
// movement is a fail-closed simulation, so a "payment" event would count
// transactions that did not happen.

type Schema = {
  /** The founder-call scheduler modal was opened. Intent; denominator for booking rate. */
  scheduler_opened: Record<string, never>;
  /** Cal.com confirmed a new booking (embed event bookingSuccessfulV2). */
  founder_call_booked: Record<string, never>;
};

export type AnalyticsEvent = keyof Schema;

const MAX_PROPS = 2;
const seen = new Set<string>();

/**
 * Send one schema event. `dedupeKey` suppresses repeats for the life of the
 * page (in memory only — nothing is written to the device). Never throws:
 * analytics must not break the flow it observes.
 */
export function trackEvent<E extends AnalyticsEvent>(name: E, props?: Schema[E], dedupeKey?: string): boolean {
  try {
    if (dedupeKey) {
      const k = `${name}:${dedupeKey}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
    const entries: [string, unknown][] = Object.entries(props ?? {});
    if (entries.length > MAX_PROPS) return false;
    for (const [, v] of entries) {
      if (!(v === null || typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && v.length <= 64))) {
        return false;
      }
    }
    track(name, entries.length ? (props as Record<string, string | number | boolean | null>) : undefined);
    return true;
  } catch {
    return false;
  }
}

/** Test hook. */
export function resetTrackedEventsForTest(): void {
  seen.clear();
}
