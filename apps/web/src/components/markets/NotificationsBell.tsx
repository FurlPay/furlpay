"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useSession } from "@/components/auth/SessionProvider";

// ---------------------------------------------------------------------------
// The bell beside the avatar.
//
// There is NO in-app notification feed in this codebase. What exists is push
// subscription (/api/push/subscribe) and the per-category preferences on the
// profile record — machinery for SENDING notifications to a device, with no
// endpoint that lists what was sent. Inventing a stack of "NVDA is up 4%" cards
// to fill the panel would put fabricated events on a money surface.
//
// So the bell is real and its panel is an honest empty state that routes to the
// preferences that DO exist. No unread badge either: a red dot over an empty
// list is a lie told in one pixel.
// ---------------------------------------------------------------------------

export default function NotificationsBell({ className }: { className?: string }) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
      >
        <Bell className="h-[17px] w-[17px]" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="mkt-pop mkt-pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-[min(280px,calc(100vw-24px))] p-4"
        >
          <p className="text-[13px] font-bold text-white">Notifications</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
            {status === "authenticated"
              ? "You have no notifications yet. Price and transaction alerts are delivered to your devices."
              : "Sign in to receive price and transaction alerts."}
          </p>
          <Link
            href={status === "authenticated" ? "/profile" : "/login?next=/markets"}
            onClick={() => setOpen(false)}
            className="mt-3 inline-block text-[12px] font-semibold text-mkt-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
          >
            {status === "authenticated" ? "Notification settings →" : "Sign in →"}
          </Link>
        </div>
      )}
    </div>
  );
}
