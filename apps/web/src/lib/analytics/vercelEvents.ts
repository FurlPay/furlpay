// HOTFIX STUB (hotfix/token2049-public).
//
// The release line (docs/architecture-2026-09-29, lib/analytics/vercelEvents.ts)
// sends these events through @vercel/analytics. This hotfix is built on the
// Sep 8 production code, which does not load Vercel Web Analytics at all and
// does not have that dependency, so adding it would change the lockfile of the
// running production build for no effect. The stub keeps ScheduleCallButton's
// import identical to the release while sending nothing. The full release
// replaces this file.

type AnalyticsEvent = "scheduler_opened" | "founder_call_booked";

export function trackEvent(_name: AnalyticsEvent, _props?: Record<string, never>, _dedupeKey?: string): boolean {
  return false;
}
