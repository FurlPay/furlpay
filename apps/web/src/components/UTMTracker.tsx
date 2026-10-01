"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

const SESSION_KEY = "fp_utm_session";
const FIRST_TOUCH_KEY = "fp_utm_first";

/**
 * Invisible component that captures UTM parameters from the URL and persists
 * them in sessionStorage (last-touch) and localStorage (first-touch).
 * Must be wrapped in <Suspense> because it uses useSearchParams().
 */
export default function UTMTracker() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const utmData: Record<string, string> = {};
    let hasUtm = false;

    for (const param of UTM_PARAMS) {
      const value = searchParams.get(param);
      if (value) {
        utmData[param] = value.toLowerCase().trim();
        hasUtm = true;
      }
    }

    if (!hasUtm) return;

    // Last-touch: always overwrite for the current session
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(utmData));
    } catch { /* storage full or unavailable */ }

    // First-touch: set only if never set before
    try {
      if (!localStorage.getItem(FIRST_TOUCH_KEY)) {
        localStorage.setItem(
          FIRST_TOUCH_KEY,
          JSON.stringify({
            ...utmData,
            timestamp: new Date().toISOString(),
            landingPage: window.location.pathname,
          })
        );
      }
    } catch { /* storage full or unavailable */ }
  }, [searchParams]);

  return null;
}
