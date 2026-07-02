"use client";

import Link from "next/link";

// Offline fallback, served by the service worker when a page that isn't in
// the cache is requested with no connection. Brand green-on-black.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-oled px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-neonSoft">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="#00E599" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1.5 8.5a15 15 0 0 1 21 0M5 12.5a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0" opacity="0.35" />
          <circle cx="12" cy="19.5" r="1.4" fill="#00E599" stroke="none" />
          <path d="M3 3l18 18" stroke="#00E599" />
        </svg>
      </div>

      <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-white">
        You&apos;re offline
      </h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-textSecondary">
        This page isn&apos;t saved for offline use. Your dashboard still works —
        it shows your last-synced balances until you&apos;re back online.
      </p>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
        <button
          onClick={() => window.location.reload()}
          className="btn-green w-full py-3.5 text-[15px]"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="w-full rounded-pill border border-white/15 py-3.5 text-[15px] font-semibold text-white"
        >
          Open dashboard
        </Link>
      </div>

      <p className="mt-8 text-[11px] text-textMuted">
        Payments and trades need a connection — nothing is queued while offline.
      </p>
    </div>
  );
}
