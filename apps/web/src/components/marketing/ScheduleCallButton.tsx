"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { trackEvent } from "@/lib/analytics/vercelEvents";

// ---------------------------------------------------------------------------
// "Book 30 minutes with the founder" — Cal.com inline embed in a modal.
//
// Replaces the previous Calendly iframe. Cal.com is now the booking system of
// record: no link to the old provider is left anywhere in the app, and its
// origin has been dropped from the CSP. See bookingProvider.spec.ts.
//
// ── WHY THE EMBED SCRIPT AND NOT A PLAIN IFRAME ────────────────────────────
//
// The Calendly version was a bare <iframe> specifically to avoid loading a
// third-party script, which kept script-src tight. Cal's inline embed needs
// app.cal.com/embed/embed.js: it is the thing that injects the booking iframe,
// negotiates its height (the booker changes size between month view and the
// slot list, and a fixed-height iframe either clips the slots or leaves a gap),
// and applies the theme. So script-src now allows https://app.cal.com.
// That is a real widening of the policy and is deliberate — it is recorded here
// and in next.config.js next to the origin it authorises.
//
// ── THE "CAL.COM" MARK IN THE BOOKER IS NOT REMOVABLE FROM HERE ────────────
//
// Checked 2026-09-27: hiding Cal.com's logo / "powered by Cal.com" is an
// ACCOUNT setting ("Disable Cal.com branding"), gated on a paid Teams plan. It
// is not an embed option — there is no `hideBranding` in the `ui` config that
// does anything on a free plan, and the booker is a cross-origin iframe so no
// stylesheet here can reach inside it. If the mark needs to go, it is an
// upgrade on the Cal.com account, not a change to this file. Do not add a flag
// that appears to do it.
//
// ── WHY THE BOOTSTRAP IS REWRITTEN AND NOT PASTED ──────────────────────────
//
// Cal ships a minified IIFE that defines window.Cal as a command queue so calls
// made before embed.js loads are replayed afterwards. The queue semantics are
// load-bearing, so they are reproduced exactly below — but written out and
// typed, because a pasted one-letter-variable IIFE is unreviewable and this
// file is on the DOM-sink inventory (domSinkInventory.spec.ts) precisely so
// that a human reads whatever creates a <script> here.
// ---------------------------------------------------------------------------

const CAL_EMBED_SRC = "https://app.cal.com/embed/embed.js";
const CAL_ORIGIN = "https://app.cal.com";

/** The Cal.com event being booked: cal.com/furlpay/30min. */
const CAL_LINK = "furlpay/30min";

/** Namespace, so this embed's config cannot collide with another on the page. */
const CAL_NS = "30min";

/** The queue function Cal exposes. Arguments are command tuples. */
type CalApi = ((...args: unknown[]) => void) & {
  q?: unknown[][];
  ns?: Record<string, CalApi>;
  loaded?: boolean;
};

declare global {
  interface Window {
    Cal?: CalApi;
  }
}

/**
 * Install Cal's command queue and load embed.js once per page.
 *
 * Faithful to Cal's official bootstrap: window.Cal buffers commands in `q`
 * until embed.js loads and drains them, and an "init" call with a namespace
 * string creates a per-namespace queue under `Cal.ns[name]`. Re-entrant — a
 * second call is a no-op once `window.Cal` exists.
 */
function loadCal(): CalApi {
  const existing = window.Cal;
  if (existing) return existing;

  const cal = function (...args: unknown[]) {
    const self = window.Cal as CalApi;
    if (!self.loaded) {
      self.ns = {};
      self.q = self.q ?? [];
      // The sink this file is inventoried for: src is CAL_EMBED_SRC, a module
      // constant. No value from props, state, the URL or the network reaches it.
      const script = document.createElement("script");
      script.src = CAL_EMBED_SRC;
      script.async = true;
      document.head.appendChild(script);
      self.loaded = true;
    }

    if (args[0] === "init") {
      const namespace = args[1];
      if (typeof namespace === "string") {
        const api = function (...inner: unknown[]) {
          api.q!.push(inner);
        } as CalApi;
        api.q = api.q ?? [];
        self.ns![namespace] = self.ns![namespace] ?? api;
        self.ns![namespace].q!.push(args);
        self.q!.push(["initNamespace", namespace]);
      } else {
        self.q!.push(args);
      }
      return;
    }

    self.q!.push(args);
  } as CalApi;

  window.Cal = cal;
  cal("init", CAL_NS, { origin: CAL_ORIGIN });
  // Registered here, once per page, and NOT in the open effect: that effect
  // re-runs on every open and would stack a listener per open. The event is
  // Cal's confirmation of a new booking (bookingSuccessfulV2, which replaces
  // the deprecated bookingSuccessful); the booking uid dedupes a repeat. Only
  // the event name is sent — no booking data, times or attendee details.
  cal.ns?.[CAL_NS]?.("on", {
    action: "bookingSuccessfulV2",
    callback: (e: { detail?: { data?: { uid?: unknown } } }) => {
      const uid = e?.detail?.data?.uid;
      trackEvent("founder_call_booked", {}, typeof uid === "string" ? uid : "unknown");
    },
  });
  return cal;
}

export default function ScheduleCallButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  // Mount the booker when the modal opens. React gives us a fresh empty div
  // each time (the modal is conditionally rendered), so this re-renders the
  // embed cleanly on a second open rather than stacking two bookers.
  useEffect(() => {
    if (!open || !mountRef.current) return;

    trackEvent("scheduler_opened");
    const cal = loadCal();
    const ns = cal.ns?.[CAL_NS];
    if (!ns) return;

    ns("inline", {
      elementOrSelector: mountRef.current,
      calLink: CAL_LINK,
      config: { layout: "month_view", useSlotsViewOnSmallScreen: "true" },
    });

    // Theme the booker to the app rather than letting it render Cal's default
    // light UI inside a black modal.
    ns("ui", {
      theme: "dark",
      hideEventTypeDetails: false,
      layout: "month_view",
      cssVarsPerTheme: {
        dark: { "cal-brand": "#00E599" },
        light: { "cal-brand": "#00B87A" },
      },
    });
  }, [open]);

  return (
    <>
      {/* Default: same geometry as the form's btn-green CTA, in black.
          Callers (e.g. the landing nav) can swap the geometry via className. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "mt-6 flex w-full items-center justify-center gap-2 rounded-pill border border-white/15 bg-black py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 hover:border-white/30 sm:w-auto sm:px-8"
        }
      >
        <CalendarClock className="h-4 w-4 text-neon" />
        Schedule your call
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/85 p-6 backdrop-blur-sm"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Schedule a call with the Furlpay founder"
        >
          <div
            className="relative flex h-[min(680px,86vh)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-charcoal shadow-[0_0_120px_-30px_rgba(0,229,153,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <p className="text-[14px] font-semibold text-white">
                Book 30 minutes with the founder
              </p>
              <button
                type="button"
                onClick={close}
                aria-label="Close scheduler"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-textSecondary transition hover:border-white/30 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Cal mounts the booking iframe into this element and drives its
                height, so it scrolls internally rather than clipping slots. */}
            <div ref={mountRef} className="h-full w-full flex-1 overflow-auto bg-charcoal" />
          </div>
        </div>
      )}
    </>
  );
}
