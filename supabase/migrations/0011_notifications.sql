-- ---------------------------------------------------------------------------
-- In-app notifications.
--
-- FurlPay already emits events over FCM, Telegram and Discord. Every one of
-- those is FIRE-AND-FORGET: if the push is dropped, the device is offline, or
-- the user simply misses it, the event is gone. There is no surface anywhere
-- that answers "what happened on my account last week". This table is that
-- record — the durable log the transient channels are notifications OF, not a
-- second copy of them.
--
-- THE EVENT MODEL IS DELIBERATELY OPEN AT ONE END AND CLOSED AT THE OTHER.
-- `type` is a closed enum because routing, iconography and (later) per-category
-- delivery preferences all switch on it, and a typo'd type would silently
-- become an uncategorised row that no preference can mute. `metadata` is jsonb
-- and open, because the payload of a trade notification has nothing in common
-- with the payload of a KYC one. New channels (email digest, SMS, webhook) read
-- these same rows; they do not need new columns.
--
-- WHAT THIS TABLE IS NOT: it is not the ledger, and it is not evidence. A
-- notification says "a deposit completed"; the ledger says what actually
-- moved. Nothing financial may be derived from this table — it is denormalised
-- display copy, written after the authoritative record, and a missing row here
-- must never imply a missing transaction there. That is why `title`/`message`
-- are stored as rendered text rather than being reconstructed from the ledger
-- at read time: the notification must keep saying what it said when it fired,
-- even if the underlying record is later corrected.
--
-- RLS: enabled with ZERO policies, matching every other table in this schema
-- (see 0001_init.sql). PostgREST with the service key bypasses RLS; the anon
-- key reads nothing. Per-user scoping is enforced in the route layer, which is
-- the only place that knows who the caller is — this deployment does not use
-- Supabase Auth, so `auth.uid()` is NULL here and a policy written against it
-- would be inert decoration that reads like a control. The ownership rule is
-- instead expressed as a NOT NULL FK plus a mandatory user_id filter on every
-- query in lib/services/notifications.ts.
-- ---------------------------------------------------------------------------

create table notifications (
  -- Application-generated (crypto.randomUUID), matching contacts/cards/bills
  -- which are also app-assigned ids rather than database defaults.
  id          text primary key,

  -- References this schema's own users table, NOT auth.users — see the RLS note
  -- above. Cascade so account deletion takes the notification history with it;
  -- an erasure request that leaves "your withdrawal failed" behind has not
  -- erased anything that matters.
  user_id     uuid not null references users (id) on delete cascade,

  -- Closed set. Grouped by the subsystem that emits them so a reader can tell
  -- at a glance which surface owns a given type.
  type        text not null check (type in (
                -- Funding
                'deposit_completed', 'deposit_failed',
                'withdrawal_completed', 'withdrawal_failed',
                -- Investing. `trade_action_required` is the one that exists
                -- because the brokerage port models indeterminate submissions:
                -- an order whose outcome the provider will not confirm is not a
                -- success and not a failure, and the user has to be told that
                -- rather than shown a guess.
                'trade_submitted', 'trade_filled', 'trade_rejected',
                'trade_action_required',
                -- Spending
                'card_transaction',
                -- Travel
                'booking_confirmed', 'booking_failed',
                -- Account
                'security_alert', 'kyc_update', 'price_alert',
                'system_announcement'
              )),

  -- Rendered at write time, not at read time. Bounded so the table cannot
  -- become blob storage, and non-empty after trimming so " " cannot become an
  -- unreadable notification.
  title       text not null check (length(btrim(title)) between 1 and 120),
  message     text not null check (length(btrim(message)) between 1 and 500),

  -- Where tapping the notification should land, as an app-relative path.
  -- CONSTRAINED TO A RELATIVE PATH ON PURPOSE: this value is interpolated into
  -- an href, and an absolute URL here would make the notification table an open
  -- redirect vector reachable by anything that can write a row. Must start with
  -- a single '/' and must not start with '//' (protocol-relative).
  link        text check (link is null or (link ~ '^/[^/]' and length(link) <= 512)),

  read_at     timestamptz,

  -- Type-specific payload: order id, tx hash, amount, symbol. Must be an
  -- OBJECT, not an array or scalar, and bounded — an unbounded blob would make
  -- every notification list query unbounded too.
  metadata    jsonb not null default '{}'::jsonb
              check (jsonb_typeof(metadata) = 'object'
                     and pg_column_size(metadata) <= 4096),

  created_at  timestamptz not null default now()
);

-- The list query: one user's notifications, newest first. Covers both the
-- unfiltered feed and keyset pagination on created_at.
create index notifications_user_created_idx
  on notifications (user_id, created_at desc);

-- The unread count, which renders in the header on every authenticated page
-- load and is therefore the hottest query on this table. PARTIAL on read_at is
-- null: the index only contains unread rows, so it stays small permanently even
-- as history grows, and the count never scans read history it does not need.
create index notifications_user_unread_idx
  on notifications (user_id)
  where read_at is null;

-- Retention. Notifications are display copy with no evidentiary value (see the
-- header), so unbounded growth buys nothing — the ledger, the audit log and the
-- order store are the records that must be kept. 180 days is well past any
-- "what happened to my deposit last month" question while keeping the hot
-- indexes small.
--
-- Not scheduled here: pg_cron is not enabled on this project, and a migration
-- that silently depends on an extension it did not create is a migration that
-- works on one environment. Called from the existing cron surface instead
-- (apps/web/src/app/api/cron). Security definer so the caller does not need
-- delete rights on the table directly.
create or replace function prune_notifications(retain_days int default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if retain_days < 30 then
    raise exception 'refusing to prune notifications newer than 30 days (got %)', retain_days;
  end if;
  delete from notifications
   where created_at < now() - make_interval(days => retain_days)
     and read_at is not null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function prune_notifications(int) is
  'Deletes READ notifications older than retain_days. Unread rows are never '
  'pruned regardless of age — a notification the user has not seen is the one '
  'thing this table exists to preserve.';

-- Service-role-only access: RLS on, zero policies. Consistent with 0001_init.
alter table notifications enable row level security;
