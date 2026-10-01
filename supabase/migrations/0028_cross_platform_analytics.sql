-- ---------------------------------------------------------------------------
-- 0028: cross-platform analytics (web, chrome_extension, android, ios, api).
--
-- Extends analytics_events (0027) for CLIENT-reported events alongside the
-- server-recorded lifecycle facts. The two are kept distinguishable forever:
--
--   source = 'server'  recorded by the backend at the point the fact happened
--                      (signup, login, KYC decision, cashback paid). Authoritative
--                      for product lifecycle.
--   source = 'client'  reported by a client through POST /api/analytics/events.
--                      INFORMATIONAL ONLY: a modified APK, extension or script
--                      can send anything the schema allows. Never used to credit
--                      money, approve KYC, settle a payment or grant a reward —
--                      and financial completion events cannot be client-sourced
--                      at all (the CHECK below).
--
-- IDENTITY MODEL — four different things, never conflated:
--   user_id          the authenticated FurlPay user, DERIVED BY THE SERVER from
--                    the session; a client cannot set it.
--   anon_id          a random per-browser-session / per-install id for traffic
--                    before sign-in. Not linked to user_id by the server.
--   session_id       one app run / browser session (client-generated, random).
--   installation_id  one app install / extension install (client-generated,
--                    random, app-scoped; never IMEI, serial or phone number).
--
-- Clients never reach this table: the API validates, rate-limits and inserts
-- with the service role. RLS stays on with no policies (0027).
-- ---------------------------------------------------------------------------

-- Every constraint this migration adds is dropped first, so a partially
-- applied or manually re-run 0028 converges instead of failing on "already exists".
alter table analytics_events drop constraint if exists analytics_events_event_name_check;
alter table analytics_events drop constraint if exists analytics_events_source_check;
alter table analytics_events drop constraint if exists analytics_events_platform_check;
alter table analytics_events drop constraint if exists analytics_events_actor_check;
alter table analytics_events drop constraint if exists analytics_events_actor_identity_check;
alter table analytics_events drop constraint if exists analytics_events_version_check;
alter table analytics_events drop constraint if exists analytics_events_screen_check;
alter table analytics_events drop constraint if exists analytics_events_txref_check;

alter table analytics_events
  add column if not exists platform        text not null default 'api',
  add column if not exists actor_type      text not null default 'user',
  add column if not exists schema_version  smallint not null default 1,
  add column if not exists app_version     text,
  add column if not exists build_number    text,
  add column if not exists os_version      text,
  add column if not exists anon_id         uuid,
  add column if not exists session_id      uuid,
  add column if not exists installation_id uuid,
  add column if not exists screen          text,
  add column if not exists transaction_ref text,
  add column if not exists client_ts       timestamptz;

-- Rows from 0027 are server events; one without a user (signup_started, before
-- the account exists) is an anonymous actor.
-- Only the rows the column default made inconsistent are touched, so a re-run
-- never reclassifies 'system' rows.
update analytics_events set actor_type = 'anonymous' where actor_type = 'user' and user_id is null;

alter table analytics_events
  add constraint analytics_events_source_check check (source in ('server', 'client')),
  add constraint analytics_events_platform_check check (platform in ('web', 'chrome_extension', 'android', 'ios', 'api')),
  add constraint analytics_events_actor_check check (actor_type in ('anonymous', 'user', 'system')),
  add constraint analytics_events_actor_identity_check check (
    (actor_type = 'user' and user_id is not null) or
    (actor_type = 'anonymous' and user_id is null) or
    (actor_type = 'system' and user_id is null)),
  add constraint analytics_events_version_check check (
    (app_version is null or app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}([-+][0-9A-Za-z.]{1,20})?$') and
    (build_number is null or build_number ~ '^[0-9A-Za-z.]{1,20}$') and
    (os_version is null or length(os_version) <= 40)),
  add constraint analytics_events_screen_check check (screen is null or screen ~ '^[A-Za-z0-9_./-]{1,64}$'),
  add constraint analytics_events_txref_check check (transaction_ref is null or length(transaction_ref) <= 80),
  add constraint analytics_events_event_name_check check (
    -- server-recorded lifecycle facts (0027)
    (source = 'server' and event_name in (
      'signup_started', 'signup_completed', 'login', 'logout',
      'kyc_started', 'kyc_completed', 'wallet_linked', 'cashback_claimed'))
    or
    -- client-reported behaviour. No completion of money movement, no KYC
    -- outcome, no settlement: those exist only as ledger / provider facts.
    (source = 'client' and event_name in (
      'app_opened', 'page_viewed', 'screen_viewed',
      'signup_started_client', 'login_started',
      'wallet_connected', 'wallet_disconnected',
      'transaction_viewed', 'transaction_requested', 'transaction_approved', 'transaction_rejected', 'transaction_submitted',
      'payment_started', 'swap_started', 'deposit_started', 'withdrawal_started',
      'travel_search', 'travel_booking_started',
      'extension_installed', 'extension_started', 'extension_connected', 'extension_disconnected',
      'error_occurred')));

create index if not exists analytics_events_platform_time_idx on analytics_events (platform, created_at);

-- One row per app installation / extension install, for "where is this user
-- active" and version adoption. Deliberately thin: no hardware ids, no model
-- strings, no IP. Revocable by the user or an admin.
create table if not exists user_devices (
  installation_id uuid primary key,
  user_id         uuid not null references users (id) on delete cascade,
  platform        text not null check (platform in ('web', 'chrome_extension', 'android', 'ios')),
  app_version     text check (app_version is null or app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}([-+][0-9A-Za-z.]{1,20})?$'),
  build_number    text check (build_number is null or build_number ~ '^[0-9A-Za-z.]{1,20}$'),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists user_devices_user_idx on user_devices (user_id, last_seen_at desc);

alter table user_devices enable row level security;
revoke all on table user_devices from public, anon, authenticated;
grant select, insert, update on table user_devices to service_role;

-- Upsert keyed on installation_id, but an installation id can never MOVE to a
-- different user: a client replaying someone else's installation id updates
-- nothing (the WHERE on the conflict branch), so it cannot hijack or relabel
-- another account's device row.
create or replace function analytics_touch_device(p_installation uuid, p_user uuid, p_platform text, p_version text, p_build text)
returns boolean
language sql volatile
set search_path = public, pg_catalog
as $$
  with up as (
    insert into user_devices as d (installation_id, user_id, platform, app_version, build_number)
    values (p_installation, p_user, p_platform, p_version, p_build)
    on conflict (installation_id) do update
       set last_seen_at = now(),
           app_version = coalesce(excluded.app_version, d.app_version),
           build_number = coalesce(excluded.build_number, d.build_number)
     where d.user_id = excluded.user_id and d.platform = excluded.platform and d.revoked_at is null
    returning 1
  )
  select exists (select 1 from up)
$$;

-- Platform breakdown. users = distinct AUTHENTICATED users per platform (a
-- person on web and Android counts once in each row and once in all_users);
-- anonymous = distinct anon ids per platform, never added to users.
create or replace function analytics_platforms(p_from timestamptz, p_to timestamptz)
returns table (platform text, users bigint, anonymous bigint, events bigint, errors bigint, all_users bigint)
language sql stable
set search_path = public, pg_catalog
as $$
  with e as (
    select platform, user_id, anon_id, event_name from analytics_events
     where created_at >= p_from and created_at < p_to
  )
  select platform,
         count(distinct user_id),
         count(distinct anon_id),
         count(*),
         count(*) filter (where event_name = 'error_occurred'),
         (select count(distinct user_id) from e)
    from e group by platform
$$;

-- Version adoption: distinct users (or installs, when signed out) per version.
create or replace function analytics_versions(p_from timestamptz, p_to timestamptz)
returns table (platform text, app_version text, users bigint, installs bigint)
language sql stable
set search_path = public, pg_catalog
as $$
  select platform, coalesce(app_version, 'unknown'),
         count(distinct user_id), count(distinct installation_id)
    from analytics_events
   where created_at >= p_from and created_at < p_to and platform <> 'api'
   group by 1, 2
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'analytics_touch_device(uuid, uuid, text, text, text)',
    'analytics_platforms(timestamptz, timestamptz)',
    'analytics_versions(timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
