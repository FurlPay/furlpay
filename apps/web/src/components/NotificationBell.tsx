"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

// The header bell and its unread badge.
//
// WHAT THIS REPLACED: a button with no handler and a red dot hardcoded into the
// markup, so every user saw a permanent "you have unread notifications"
// indicator for a feature that did not exist. A badge that is always lit is
// worse than no badge — it trains people to ignore the one signal the app has
// for telling them something actually needs attention.
//
// So the dot renders only when the server says there is something unread, and
// never renders at all when the notification backend is unconfigured. An
// unreachable database means "we do not know", and "we do not know" must not
// look like "you are all caught up" OR like "you have mail".

export default function NotificationBell({ className }: { className?: string }) {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        // limit=1 because only the count is wanted here; the server computes it
        // from a partial index rather than from the page it returns.
        const res = await fetch("/api/notifications?limit=1", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { unreadCount?: number; available?: boolean };
        setUnread(data.available === false ? null : (data.unreadCount ?? 0));
      } catch {
        // Aborted, offline, or a failed request: leave the badge in its
        // unknown state rather than asserting zero.
      }
    }

    load();
    // Refresh when the tab regains focus. No polling interval: a badge is not
    // worth a request every thirty seconds on a phone, and anything genuinely
    // urgent arrives by push.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const hasUnread = unread !== null && unread > 0;
  const label = hasUnread
    ? `Notifications, ${unread} unread`
    : "Notifications";

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className={
        className ??
        "tap relative flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]"
      }
    >
      <Bell className="h-5 w-5 text-textSecondary" />
      {hasUnread && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 flex min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[17px] text-white ring-2 ring-black"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
