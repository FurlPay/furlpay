"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { sanitizeAnalyticsUrl } from "@/lib/analytics/sanitize";

// Vercel Web Analytics (enabled on the project, included with Pro, billed per
// event). Cookieless, and it writes nothing to the device unless identify() is
// used — which this app never does (lib/analytics/events.ts). That is why it
// sits outside the GA cookie-consent banner (ConsentManager).
//
// Every pageview and custom event passes through beforeSend before the script
// builds its request; sanitizeAnalyticsUrl reduces the URL to origin + a
// minimised path, or drops the event. Full audit:
// docs/analytics/VERCEL_ANALYTICS_AUDIT.md.
export function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = sanitizeAnalyticsUrl(event?.url);
  return url ? { ...event, url } : null;
}

export default function VercelAnalytics() {
  // Production builds only. Outside them the package injects its DEBUG script
  // from https://va.vercel-scripts.com, which the CSP (correctly) does not
  // allow; every `next dev` page, the e2e suite included, then logged a CSP
  // violation. A production build loads /_vercel/insights/script.js from our
  // own origin, which 'self' already covers, so this changes nothing in
  // production and does not loosen the CSP anywhere. A dev server has no
  // analytics to collect.
  if (process.env.NODE_ENV !== "production") return null;
  return <Analytics beforeSend={beforeSend} />;
}
