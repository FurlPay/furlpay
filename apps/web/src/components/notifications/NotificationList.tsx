"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CreditCard,
  Plane,
  ShieldAlert,
  TrendingUp,
  UserCheck,
} from "lucide-react";

// The notification feed.
//
// STATE MODEL. Four distinct states, and conflating any two of them would lie
// to the user:
//
//   loading      we have not asked yet
//   unavailable  the notification store is not configured on this deployment
//   empty        we asked, and there is genuinely nothing
//   populated    we asked, and here it is
//
// `unavailable` exists because an unreachable database renders exactly like an
// empty inbox, and "we cannot tell you what happened on your account" is not
// the same message as "nothing happened on your account". On a financial
// product that difference matters.
//
// OPTIMISTIC UI. Marking read is optimistic; nothing else is. Read state is
// display-only, idempotent server-side, and costless to get wrong for a moment
// — the row un-bolds instantly and reverts if the request fails. Pagination is
// NOT optimistic, because inventing rows is exactly the thing this codebase
// refuses to do anywhere else.

interface Notification {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  attention: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface Page {
  notifications: Notification[];
  nextCursor: string | null;
  unreadCount: number;
  available: boolean;
}

type Status = "loading" | "unavailable" | "error" | "ready";

const ICONS: Record<string, typeof Bell> = {
  deposit_completed: ArrowDownLeft,
  deposit_failed: AlertTriangle,
  withdrawal_completed: ArrowUpRight,
  withdrawal_failed: AlertTriangle,
  trade_submitted: TrendingUp,
  trade_filled: TrendingUp,
  trade_rejected: AlertTriangle,
  trade_action_required: AlertTriangle,
  card_transaction: CreditCard,
  booking_confirmed: Plane,
  booking_failed: AlertTriangle,
  security_alert: ShieldAlert,
  kyc_update: UserCheck,
  price_alert: TrendingUp,
  system_announcement: Bell,
};

/** Day buckets. Grouping by "Today"/"Yesterday"/date is what makes a long feed
 *  scannable; an undifferentiated list of timestamps is not. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function NotificationList() {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (before?: string) => {
    const qs = new URLSearchParams({ limit: "20" });
    if (before) qs.set("before", before);
    const res = await fetch(`/api/notifications?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return (await res.json()) as Page;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((page) => {
        if (cancelled) return;
        if (!page.available) {
          setStatus("unavailable");
          return;
        }
        setItems(page.notifications);
        setCursor(page.nextCursor);
        setUnread(page.unreadCount);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await load(cursor);
      setItems((prev) => [...prev, ...page.notifications]);
      setCursor(page.nextCursor);
    } catch {
      // Keep what is already on screen; the button stays available to retry.
    } finally {
      setLoadingMore(false);
    }
  }

  async function markOne(id: string) {
    const target = items.find((n) => n.id === id);
    if (!target || target.read) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
      setUnread((u) => u + 1);
    }
  }

  async function markAll() {
    const previously = items.filter((n) => !n.read).map((n) => n.id);
    if (previously.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      const revert = new Set(previously);
      setItems((prev) => prev.map((n) => (revert.has(n.id) ? { ...n, read: false } : n)));
      setUnread(previously.length);
    }
  }

  return (
    <div className="px-5 pt-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Notifications</h1>
          {status === "ready" && (
            <p className="mt-0.5 text-[13px] text-textSecondary">
              {unread > 0 ? `${unread} unread` : "You're all caught up"}
            </p>
          )}
        </div>
        {status === "ready" && unread > 0 && (
          <button
            onClick={markAll}
            className="tap rounded-full border border-white/[0.1] px-3.5 py-1.5 text-[12.5px] font-semibold text-textSecondary transition-colors hover:border-white/25 hover:text-textPrimary"
          >
            Mark all read
          </button>
        )}
      </header>

      {status === "loading" && (
        <div className="mt-6 space-y-2.5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      )}

      {status === "unavailable" && (
        <Notice
          title="Notification history is unavailable"
          body="This deployment has no notification store configured, so there is no history to show. This is not the same as having no notifications — we simply cannot tell you either way."
        />
      )}

      {status === "error" && (
        <Notice
          title="Could not load notifications"
          body="Something went wrong fetching your history. Your notifications are safe; this page just could not reach them."
        />
      )}

      {status === "ready" && items.length === 0 && (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03]">
            <Bell className="h-7 w-7 text-textMuted" />
          </div>
          <p className="mt-4 text-[15px] font-semibold">No notifications yet</p>
          <p className="mt-1 max-w-[36ch] text-[13.5px] leading-relaxed text-textSecondary">
            Deposits, trades, card activity and security alerts will appear here as they happen.
          </p>
        </div>
      )}

      {status === "ready" && items.length > 0 && <Feed items={items} onRead={markOne} />}

      {status === "ready" && cursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="tap mt-4 w-full rounded-2xl border border-white/[0.08] py-3 text-[13.5px] font-semibold text-textSecondary transition-colors hover:border-white/20 hover:text-textPrimary disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}

function Feed({ items, onRead }: { items: Notification[]; onRead: (id: string) => void }) {
  // Group into day buckets in render order; the feed already arrives sorted
  // newest-first from the keyset query, so a single pass preserves it.
  const groups: { label: string; rows: Notification[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(n);
    else groups.push({ label, rows: [n] });
  }

  return (
    <div className="mt-5 space-y-6">
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-textMuted">
            {g.label}
          </h2>
          <ul className="mt-2.5 space-y-2">
            {g.rows.map((n) => (
              <Row key={n.id} n={n} onRead={onRead} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const Icon = ICONS[n.type] ?? Bell;

  const inner = (
    <>
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
          n.attention
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-white/[0.08] bg-white/[0.04] text-textSecondary"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={`text-[14.5px] ${n.read ? "font-medium" : "font-bold"}`}>{n.title}</span>
          <time
            dateTime={n.createdAt}
            className="shrink-0 text-[11.5px] tabular-nums text-textMuted"
          >
            {timeLabel(n.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 block text-[13.5px] leading-relaxed text-textSecondary">
          {n.message}
        </span>
      </span>
      {!n.read && (
        <span
          aria-label="Unread"
          className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
        />
      )}
    </>
  );

  const shell = `flex w-full gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
    n.read
      ? "border-white/[0.05] bg-transparent"
      : "border-white/[0.09] bg-white/[0.03]"
  } hover:border-white/20`;

  // A notification with a destination is a link; one without is a button that
  // only marks read. Rendering a non-navigating <a> would be a lie to a screen
  // reader and to anyone middle-clicking it.
  return (
    <li>
      {n.link ? (
        <Link href={n.link} onClick={() => onRead(n.id)} className={shell}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={() => onRead(n.id)} className={shell}>
          {inner}
        </button>
      )}
    </li>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <p className="text-[14.5px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-[54ch] text-[13.5px] leading-relaxed text-textSecondary">{body}</p>
    </div>
  );
}
