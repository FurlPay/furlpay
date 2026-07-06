"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// First-party cookie-consent banner wired to Google Consent Mode v2.
//
// The consent *default* (everything denied) is set by an inline script in the
// root layout, before gtag.js loads, so GA never sets analytics/ad cookies
// until the visitor opts in. This component only renders the choice UI and,
// on a decision, sends `gtag('consent','update', …)` and persists it.
//
// No third-party consent SDK — one fewer external script on a payments/privacy
// brand, and the whole flow is auditable in this repo.

const STORAGE_KEY = "furlpay-consent-v1";

type Choice = "granted" | "denied";
type Gtag = (...args: unknown[]) => void;

function applyConsent(choice: Choice) {
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag !== "function") return;
  const value = choice === "granted" ? "granted" : "denied";
  gtag("consent", "update", {
    analytics_storage: value,
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  });
}

export default function ConsentManager() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage blocked (private mode / cookies off) — show the banner.
    }
    if (stored === "granted" || stored === "denied") {
      // Re-assert the stored choice on every load so Consent Mode reflects it
      // even though the default script starts from denied.
      applyConsent(stored);
      setVisible(false);
    } else {
      setVisible(true);
    }
  }, []);

  function decide(choice: Choice) {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Persisting failed — still honour the choice for this session.
    }
    applyConsent(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-2xl border border-white/10 bg-oled/95 p-5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:inset-x-6 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-textSecondary">
          We use analytics cookies to understand how the site is used and improve it. They
          load only if you accept. See our{" "}
          <Link href="/legal/cookies" className="text-neon underline-offset-2 hover:underline">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => decide("denied")}
            className="btn-outline px-4 py-2 text-[13px]"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide("granted")}
            className="btn-green px-4 py-2 text-[13px]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
