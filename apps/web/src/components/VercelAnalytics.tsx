"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

// Vercel Web Analytics (enabled on the project, included with Pro). Cookieless:
// it sets no cookie and stores nothing on the device, so it sits outside the
// GA cookie-consent banner (ConsentManager), which governs cookies.
//
// Only the PATH is reported. Query strings can carry one-time secrets on this
// site — /auth/handoff?code=…, OAuth callbacks, payment-return URLs — and
// analytics has no use for them. Fragments are dropped for the same reason.
export function stripQuery(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  return { ...event, url: `${url.origin}${url.pathname}` };
}

export default function VercelAnalytics() {
  return <Analytics beforeSend={stripQuery} />;
}
