import { randomUUID } from "crypto";
import { kvListPush, kvIncrBy, kvPfAdd } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Analytics event tracking. Best-effort: never fails the caller.
// Events feed the /api/ops/analytics/* endpoints and the admin dashboard.
// No PII: user IDs only (never emails, IPs, passwords, totpSecret).
// ---------------------------------------------------------------------------

const EVENTS_KEY = "ops:analytics:events";
const MAX_EVENTS = 10_000;
const COUNTER_TTL = 60 * 60 * 24 * 90; // 90 days

export interface AnalyticsEvent {
  id: string;
  event: string;
  userId?: string;
  sessionId?: string;
  ts: string;
  properties: Record<string, unknown>;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  country?: string;
  device?: string;
}

export async function trackAnalyticsEvent(
  e: Omit<AnalyticsEvent, "id" | "ts">
): Promise<void> {
  const evt: AnalyticsEvent = {
    ...e,
    id: `evt_${randomUUID()}`,
    ts: new Date().toISOString(),
  };
  const date = evt.ts.slice(0, 10);

  try {
    await kvListPush(EVENTS_KEY, JSON.stringify(evt), MAX_EVENTS);
    await kvIncrBy(`ops:analytics:event:${e.event}:${date}`, 1, COUNTER_TTL);

    if (e.utm?.source) {
      await kvIncrBy(
        `ops:analytics:utm:${e.utm.source}:${e.event}:${date}`,
        1,
        COUNTER_TTL
      );
    }

    if (e.country) {
      await kvIncrBy(`ops:analytics:geo:${e.country}:${date}`, 1, COUNTER_TTL);
    }

    if (e.userId) {
      await kvPfAdd(`ops:analytics:dau:${date}`, e.userId);
    }
  } catch {
    /* analytics is best-effort — never fail the caller */
  }
}

/** Lightweight page-view tracker for middleware (no DB call). */
export async function trackPageView(
  userId: string,
  path: string,
  country: string
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  try {
    await kvPfAdd(`ops:analytics:dau:${date}`, userId);
    await kvIncrBy(`ops:analytics:pageview:${date}`, 1, COUNTER_TTL);
    if (country && country !== "XX") {
      await kvIncrBy(`ops:analytics:geo:${country}:${date}`, 1, COUNTER_TTL);
    }
  } catch {
    /* best-effort */
  }
}
