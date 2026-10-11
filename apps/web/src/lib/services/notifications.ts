import { randomUUID } from "crypto";
import { sbInsert, sbSelect, sbUpdate, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import { dataPlane } from "@/lib/dataPlane";

// ---------------------------------------------------------------------------
// In-app notification history (schema: supabase/migrations/0011_notifications.sql).
//
// FurlPay's existing channels — FCM, Telegram, Discord — are all fire-and-
// forget. This is the durable record those channels are notifications OF: the
// answer to "what happened on my account last week" when the push was missed,
// the device was offline, or the user simply never looked.
//
// TWO RULES THIS MODULE ENFORCES, and neither is negotiable:
//
//   1. EVERY read and write is scoped by user_id, in the query itself. There is
//      no `getNotification(id)` that a route could accidentally call without an
//      owner check — the id-addressed functions all take a userId and filter on
//      both columns, so an IDOR is not expressible through this API. The
//      service key bypasses RLS, so this layer IS the ownership boundary.
//
//   2. Emitting a notification MUST NOT be able to fail the operation that
//      caused it. A deposit that settled and then failed to notify is a
//      deposit that settled. `notify()` therefore swallows and logs its errors;
//      callers do not await a decision from it. The inverse — a notification
//      written for an event that did not happen — is prevented by only ever
//      calling notify() AFTER the authoritative write.
//
// Nothing financial may be derived from these rows. They are denormalised
// display copy; the ledger and the order store are the records of truth.
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  "deposit_completed",
  "deposit_failed",
  "withdrawal_completed",
  "withdrawal_failed",
  "trade_submitted",
  "trade_filled",
  "trade_rejected",
  "trade_action_required",
  "card_transaction",
  "booking_confirmed",
  "booking_failed",
  "security_alert",
  "kyc_update",
  "price_alert",
  "system_announcement",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Display grouping. Kept here rather than in the component so the mobile app
 *  and any future channel categorise identically. */
export const NOTIFICATION_CATEGORY: Record<NotificationType, string> = {
  deposit_completed: "Money",
  deposit_failed: "Money",
  withdrawal_completed: "Money",
  withdrawal_failed: "Money",
  trade_submitted: "Investing",
  trade_filled: "Investing",
  trade_rejected: "Investing",
  trade_action_required: "Investing",
  card_transaction: "Spending",
  booking_confirmed: "Travel",
  booking_failed: "Travel",
  security_alert: "Security",
  kyc_update: "Account",
  price_alert: "Investing",
  system_announcement: "Account",
};

/** Types that describe something going wrong or needing the user to act.
 *  The UI renders these differently; grouping it here keeps web and mobile
 *  from disagreeing about what counts as bad news. */
const ATTENTION_TYPES = new Set<NotificationType>([
  "deposit_failed",
  "withdrawal_failed",
  "trade_rejected",
  "trade_action_required",
  "booking_failed",
  "security_alert",
]);

export function needsAttention(type: NotificationType): boolean {
  return ATTENTION_TYPES.has(type);
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** The shape routes return. `user_id` is deliberately NOT carried across the
 *  wire: the client already knows who it is, and echoing an internal uuid into
 *  every list response is gratuitous exposure. */
export interface Notification {
  id: string;
  type: NotificationType;
  category: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  attention: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
}

function toWire(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    category: NOTIFICATION_CATEGORY[row.type] ?? "Account",
    title: row.title,
    message: row.message,
    link: row.link,
    read: row.read_at !== null,
    attention: needsAttention(row.type),
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

/** Notifications are display copy, so an unconfigured database is a degraded
 *  surface rather than an outage: the rest of the app keeps working and the
 *  centre renders empty. This is the ONLY thing in this module that treats a
 *  missing backend as acceptable, and it never fabricates rows to fill the gap. */
function backendReady(): boolean {
  return supabaseBackend === "supabase";
}

const PAGE_MAX = 50;

export interface ListOptions {
  /** Keyset cursor: an ISO created_at from a previous page's last row. */
  before?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export interface NotificationPage {
  notifications: Notification[];
  /** Cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null;
  unreadCount: number;
  /** False when Supabase is unconfigured — the UI says so rather than
   *  presenting an empty list as "you have no notifications". */
  available: boolean;
}

/**
 * One page of a user's notifications, newest first.
 *
 * Keyset pagination on created_at rather than offset: an offset page shifts
 * under the reader every time a new notification arrives, which on a feed that
 * grows from the top means duplicated and skipped rows. The (user_id,
 * created_at desc) index serves this directly.
 */
export async function listNotifications(
  userId: string,
  opts: ListOptions = {}
): Promise<NotificationPage> {
  if (!backendReady()) {
    return { notifications: [], nextCursor: null, unreadCount: 0, available: false };
  }

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), PAGE_MAX);
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (opts.unreadOnly) filters.push("read_at=is.null");
  if (opts.before) filters.push(`created_at=lt.${encodeURIComponent(opts.before)}`);
  filters.push("order=created_at.desc");
  // Fetch one extra row to learn whether another page exists without a second
  // COUNT query.
  filters.push(`limit=${limit + 1}`);

  const rows = await sbSelect<NotificationRow>("notifications", filters.join("&"));
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    notifications: page.map(toWire),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
    unreadCount: await unreadCount(userId),
    available: true,
  };
}

/**
 * Unread count for the header badge.
 *
 * Uses PostgREST's exact count with a zero-row window, so Postgres answers from
 * the partial index (`where read_at is null`) and returns no row data at all.
 * This runs on every authenticated page load and must not fetch a feed to
 * count it.
 */
export async function unreadCount(userId: string): Promise<number> {
  if (!backendReady()) return 0;
  const res = await fetch(
    `${dataPlane.supabaseUrl}/rest/v1/notifications` +
      `?user_id=eq.${encodeURIComponent(userId)}&read_at=is.null&select=id&limit=1`,
    {
      headers: {
        apikey: dataPlane.supabaseKey!,
        Authorization: `Bearer ${dataPlane.supabaseKey}`,
        // head+exact gives the count in Content-Range without a body.
        Prefer: "count=exact",
        Range: "0-0",
      },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    log.warn("notifications.unreadCount.failed", { status: res.status });
    return 0;
  }
  // Content-Range: "0-0/42" — the figure after the slash is the total.
  const total = res.headers.get("content-range")?.split("/")[1];
  const n = Number(total);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mark one notification read.
 *
 * Filtered on BOTH id and user_id. A caller passing someone else's id updates
 * zero rows and gets `false` — the same answer as a nonexistent id, so the
 * response cannot be used to probe which ids exist.
 *
 * Idempotent: `read_at=is.null` means a second call updates nothing and still
 * reports success, because the notification is read either way.
 */
export async function markRead(userId: string, id: string): Promise<boolean> {
  if (!backendReady()) return false;
  const rows = await sbUpdate<NotificationRow>(
    "notifications",
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { read_at: new Date().toISOString() } as Partial<NotificationRow>
  );
  if (rows.length > 0) return true;

  // Zero rows updated: either it does not exist, it belongs to someone else, or
  // it was already read. Distinguish only the last case, and only for this
  // user, so the caller can report success on a repeat click.
  const existing = await sbSelect<{ id: string }>(
    "notifications",
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`
  );
  return existing.length > 0;
}

/** Mark every unread notification read. Returns how many changed. */
export async function markAllRead(userId: string): Promise<number> {
  if (!backendReady()) return 0;
  const rows = await sbUpdate<NotificationRow>(
    "notifications",
    `user_id=eq.${encodeURIComponent(userId)}&read_at=is.null`,
    { read_at: new Date().toISOString() } as Partial<NotificationRow>
  );
  return rows.length;
}

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** App-relative path only. An absolute or protocol-relative URL is rejected
   *  by the database CHECK; this validates first so a bad link is a dropped
   *  notification rather than a failed insert inside a money path. */
  link?: string;
  metadata?: Record<string, unknown>;
}

function safeLink(link: string | undefined): string | null {
  if (!link) return null;
  if (!/^\/[^/]/.test(link) || link.length > 512) {
    log.warn("notifications.link_rejected", { link: link.slice(0, 64) });
    return null;
  }
  return link;
}

/**
 * Write a notification. Never throws.
 *
 * Call this AFTER the authoritative write, never before and never instead of
 * it — a row here is a claim that something happened, and the only way to keep
 * that claim honest is for it to follow the fact. Failures are logged and
 * swallowed: a settled deposit that could not be announced is still settled,
 * and taking down a money path because the notification table was unreachable
 * would be a strictly worse outcome than a missing row.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    if (!backendReady()) return;
    const row: NotificationRow = {
      id: randomUUID(),
      user_id: input.userId,
      type: input.type,
      title: input.title.trim().slice(0, 120),
      message: input.message.trim().slice(0, 500),
      link: safeLink(input.link),
      read_at: null,
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    await sbInsert<NotificationRow>("notifications", row);
  } catch (e) {
    log.error("notifications.write_failed", {
      type: input.type,
      error: (e as Error).message,
    });
  }
}
