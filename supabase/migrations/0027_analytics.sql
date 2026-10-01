-- ---------------------------------------------------------------------------
-- 0027: admin analytics: product lifecycle events + server-side aggregation.
--
-- WHAT THIS IS NOT: a financial record. Volume, fees and transaction counts
-- are aggregated from ops_tx_events (the ops ledger every rail writes), never
-- from this table. analytics_events holds product lifecycle facts only
-- (signup started/completed, login, logout, KYC, wallet linked, cashback).
--
-- PRIVACY: no email, phone, name, IP, wallet address, token or document is a
-- column here. `subject` is an HMAC of the canonical identifier, computed by
-- the app with a server secret, used only to link a signup start to its
-- completion; it cannot be reversed without the secret. `metadata` is bounded
-- and written from an allowlist in the application (lib/analytics/events.ts).
--
-- IDEMPOTENT: event_id is the primary key and the app derives it from the
-- business fact (e.g. signup_completed:<user_id>), so a retried write is a
-- no-op instead of a second event.
--
-- ACCESS: RLS on, no policies; anon and authenticated get nothing. Only
-- service_role (the server) reads or writes, and the admin gate is enforced in
-- the application (requireOpsAdmin) before any of it is queried.
--
-- RETENTION: 400 days (purge_analytics_events). Financial and audit records
-- live in their own tables with their own retention and are not touched.
-- ---------------------------------------------------------------------------

create table if not exists analytics_events (
  event_id    text primary key check (length(event_id) between 8 and 160),
  event_name  text not null check (event_name in (
                'signup_started', 'signup_completed', 'login', 'logout',
                'kyc_started', 'kyc_completed', 'wallet_linked', 'cashback_claimed')),
  user_id     uuid,
  subject     text check (subject is null or subject ~ '^[0-9a-f]{64}$'),
  source      text not null default 'server' check (source in ('server')),
  route       text check (route is null or length(route) <= 120),
  metadata    jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 1024),
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_name_time_idx on analytics_events (event_name, created_at);

alter table analytics_events enable row level security;
revoke all on table analytics_events from public, anon, authenticated;
grant select, insert, delete on table analytics_events to service_role;

-- Range scans the dashboard runs on every refresh. Each index matches one
-- query below; nothing speculative.
create index if not exists users_created_at_idx on users (created_at);

-- audit_log is append-heavy and may be large in production. A plain CREATE
-- INDEX holds a SHARE lock for the whole build, blocking every audit write (and
-- so every request that audits) until it finishes; CREATE INDEX CONCURRENTLY
-- cannot run inside the migration's transaction. So: build it here only when
-- the table is small enough for the lock to be momentary, and otherwise skip
-- with a NOTICE. The operator then builds it outside a transaction:
--
--   create index concurrently if not exists audit_log_created_at_idx on audit_log (created_at);
--
-- Without the index the active-users panel is slower, not wrong
-- (probe-schema.mjs reports it as non-critical). Re-running this migration after
-- the concurrent build is a no-op.
do $$
begin
  if to_regclass('public.audit_log_created_at_idx') is not null then
    return;
  end if;
  if pg_total_relation_size('audit_log') < 256 * 1024 * 1024 then
    create index audit_log_created_at_idx on audit_log (created_at);
  else
    raise notice 'audit_log is % — skipping audit_log_created_at_idx; build it with CREATE INDEX CONCURRENTLY (see 0027)',
      pg_size_pretty(pg_total_relation_size('audit_log'));
  end if;
end $$;
-- ops_tx_events already has (created_at desc) and (rail, state, created_at desc) — 0003.

-- ── Aggregations ────────────────────────────────────────────────────────────
-- SECURITY INVOKER + EXECUTE for service_role only: they read with the
-- caller's (the server's) rights, so they cannot widen anyone's access.
-- p_unit is 'hour' or 'day'; anything else is rejected rather than coerced.

create or replace function analytics_tx_buckets(p_from timestamptz, p_to timestamptz, p_unit text, p_rail text default null)
returns table (bucket timestamptz, token text, state text, n bigint, volume_usd numeric, fee_usd numeric)
language sql stable
set search_path = public, pg_catalog
as $$
  select date_trunc(p_unit, created_at) as bucket,
         coalesce(upper(token), 'OTHER') as token,
         state,
         count(*) as n,
         coalesce(sum(amount_usd), 0) as volume_usd,
         coalesce(sum(fee_usd), 0) as fee_usd
    from ops_tx_events
   where created_at >= p_from and created_at < p_to
     and (p_rail is null or rail = p_rail)
     and p_unit in ('hour', 'day')
   group by 1, 2, 3
$$;

create or replace function analytics_rail_users(p_from timestamptz, p_to timestamptz, p_rail text default null)
returns table (rail text, users bigint, all_users bigint)
language sql stable
set search_path = public, pg_catalog
as $$
  with s as (
    select rail, user_id from ops_tx_events
     where state = 'settled' and user_id is not null
       and created_at >= p_from and created_at < p_to
       and (p_rail is null or rail = p_rail)
  )
  select rail, count(distinct user_id), (select count(distinct user_id) from s)
    from s group by rail
$$;

-- Active user = a user with at least one audited, non-administrative action.
-- Excluded: admin.* (an operator using the console is not product activity),
-- rows with no user (system/cron/anonymous actors are stored with user_id null).
create or replace function analytics_active_users(p_from timestamptz, p_to timestamptz, p_unit text)
returns table (bucket timestamptz, users bigint)
language sql stable
set search_path = public, pg_catalog
as $$
  select date_trunc(p_unit, created_at), count(distinct user_id)
    from audit_log
   where created_at >= p_from and created_at < p_to
     and user_id is not null and action not like 'admin.%'
     and p_unit in ('hour', 'day')
   group by 1
  union all
  -- bucket NULL = the distinct count over the WHOLE range (not a sum of buckets)
  select null::timestamptz, count(distinct user_id)
    from audit_log
   where created_at >= p_from and created_at < p_to
     and user_id is not null and action not like 'admin.%'
$$;

-- Signup cohort: users created in the range, and how far each has got since.
create or replace function analytics_signup_cohort(p_from timestamptz, p_to timestamptz, p_unit text)
returns table (bucket timestamptz, signups bigint, kyc_started bigint, kyc_verified bigint, wallet_linked bigint, transacted bigint)
language sql stable
set search_path = public, pg_catalog
as $$
  select date_trunc(p_unit, u.created_at),
         count(*),
         count(*) filter (where u.kyc_status in ('pending', 'verified')),
         count(*) filter (where u.kyc_status = 'verified'),
         count(*) filter (where exists (select 1 from linked_wallets w where w.user_id = u.id)),
         count(*) filter (where exists (select 1 from ops_tx_events t
                                          where t.user_id = u.id and t.state = 'settled'
                                            and t.created_at >= u.created_at))
    from users u
   where u.created_at >= p_from and u.created_at < p_to
     and p_unit in ('hour', 'day')
   group by 1
$$;

-- Top of the funnel from lifecycle events: distinct subjects that started a
-- signup in the range, and how many of those subjects completed one.
create or replace function analytics_signup_starts(p_from timestamptz, p_to timestamptz)
returns table (started bigint, completed bigint, first_event timestamptz)
language sql stable
set search_path = public, pg_catalog
as $$
  with s as (
    select distinct subject from analytics_events
     where event_name = 'signup_started' and subject is not null
       and created_at >= p_from and created_at < p_to
  )
  select (select count(*) from s),
         (select count(distinct e.subject) from analytics_events e
            join s on s.subject = e.subject
           where e.event_name = 'signup_completed' and e.created_at >= p_from),
         (select min(created_at) from analytics_events where event_name = 'signup_started')
$$;

create or replace function purge_analytics_events(p_before timestamptz)
returns bigint
language sql volatile
set search_path = public, pg_catalog
as $$
  with d as (delete from analytics_events where created_at < p_before returning 1)
  select count(*) from d
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'analytics_tx_buckets(timestamptz, timestamptz, text, text)',
    'analytics_rail_users(timestamptz, timestamptz, text)',
    'analytics_active_users(timestamptz, timestamptz, text)',
    'analytics_signup_cohort(timestamptz, timestamptz, text)',
    'analytics_signup_starts(timestamptz, timestamptz)',
    'purge_analytics_events(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
