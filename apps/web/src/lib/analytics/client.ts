"use client";

import type { ClientEventName } from "./contract";

// ---------------------------------------------------------------------------
// Web client analytics: one small function, same contract as the extension
// and the mobile apps (contract.ts).
//
// Sparse on purpose: page views are already counted server-side (cookieless,
// middleware); this is for the handful of product moments only the browser
// sees (a search submitted, a wallet disconnected). Not every click.
//
// Identity: the session cookie rides along (same origin); the server decides
// who this is. Signed out, a random id held in sessionStorage groups one tab
// session; it is never persisted beyond the tab and the server discards it for
// signed-in requests. Fire-and-forget: failures are ignored, nothing awaits it.
// ---------------------------------------------------------------------------

const ANON_KEY = "fp.anon";

function anonId(): string | undefined {
  try {
    let id = sessionStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return undefined; // storage blocked: send without it
  }
}

export function trackClient(
  eventName: ClientEventName,
  opts: { metadata?: Record<string, string | number | boolean>; transactionId?: string } = {}
): void {
  try {
    const body = JSON.stringify({
      schemaVersion: 1,
      eventId: crypto.randomUUID().replace(/-/g, ""),
      eventName,
      platform: "web",
      timestamp: new Date().toISOString(),
      anonId: anonId(),
      route: window.location.pathname,
      ...(opts.transactionId ? { transactionId: opts.transactionId } : {}),
      metadata: opts.metadata ?? {},
    });
    void fetch("/api/analytics/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    // never let analytics break a page
  }
}
