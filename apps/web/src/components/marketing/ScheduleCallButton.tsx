"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, X } from "lucide-react";

// Calendly inline embed, themed to the app (oled/charcoal + neon) via URL
// params so the widget renders dark natively — no Calendly landing chrome,
// no GDPR banner, no external widget.js (a plain iframe keeps CSP tight).
const CALENDLY_URL =
  "https://calendly.com/founder-furlpay/30min" +
  "?hide_landing_page_details=1&hide_gdpr_banner=1&embed_type=Inline" +
  "&background_color=08080a&text_color=ffffff&primary_color=00e599";

export default function ScheduleCallButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

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
            className="relative flex h-[min(600px,82vh)] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-charcoal shadow-[0_0_120px_-30px_rgba(0,229,153,0.35)]"
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
            <iframe
              src={CALENDLY_URL}
              title="Schedule a call — Calendly"
              className="h-full w-full flex-1 bg-charcoal"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </>
  );
}
