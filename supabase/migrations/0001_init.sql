-- ---------------------------------------------------------------------------
-- FurlPay initial schema — Postgres replacement for the in-memory store
-- (apps/web/src/lib/store.ts). Tables mirror UserAccount exactly so the store
-- accessors can swap backends without shape changes.
--
-- Access model: the web app talks to Supabase server-side ONLY, using the
-- service-role key (PostgREST). RLS is enabled on every table with NO
-- policies, so the anon key can read nothing even if it leaks.
-- ---------------------------------------------------------------------------

create extension if not exists citext;

-- --- users -----------------------------------------------------------------
-- Identity + KYC + preferences. security/notifications are JSONB: they are
-- read/written whole by the app and never queried field-by-field.

create table users (
  id             uuid primary key,
  name           text not null,
  email          citext not null,
  phone          text,                       -- E.164
  phone_verified boolean not null default false,
  auth_provider  text check (auth_provider in ('passkey', 'google', 'apple', 'phone', 'email')),
  google_sub     text,
  apple_sub      text,
  safe_address   text not null,
  kyc_status     text not null default 'unverified'
                 check (kyc_status in ('verified', 'pending', 'unverified')),
  kyc_tier       smallint not null default 0 check (kyc_tier between 0 and 3),
  region         text not null default 'GLOBAL'
                 check (region in ('EEA', 'US', 'IN', 'GLOBAL')),
  tier           text not null default 'Standard'
                 check (tier in ('Standard', 'Pro', 'Ultra')),
  roles          text[] not null default '{user}',
  security       jsonb not null default '{}'::jsonb,
  notifications  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Verified-identifier indexes — the byPhone/byEmail/byGoogleSub/byAppleSub
-- maps. Unique so one verified identifier can never resolve to two accounts.
create unique index users_email_key      on users (email);
create unique index users_phone_key      on users (phone)      where phone is not null;
create unique index users_google_sub_key on users (google_sub) where google_sub is not null;
create unique index users_apple_sub_key  on users (apple_sub)  where apple_sub is not null;

-- --- balances / holdings ------------------------------------------------------

create table token_balances (
  user_id   uuid not null references users (id) on delete cascade,
  token     text not null,
  chain     text not null,
  amount    numeric(38, 18) not null default 0,
  usd_value numeric(20, 2)  not null default 0,
  primary key (user_id, token, chain)
);

create table fiat_balances (
  user_id       uuid not null references users (id) on delete cascade,
  currency      text not null,               -- USD, EUR, GBP, INR
  amount        numeric(20, 2) not null default 0,
  usd_value     numeric(20, 2) not null default 0,
  local_details jsonb,                        -- iban / routing / account / swift
  primary key (user_id, currency)
);

create table holdings (
  user_id      uuid not null references users (id) on delete cascade,
  symbol       text not null,
  name         text not null,
  shares       numeric(20, 8) not null default 0,
  price        numeric(20, 2) not null default 0,
  change_pct   numeric(8, 4)  not null default 0,
  market_value numeric(20, 2) not null default 0,
  cost_basis   numeric(20, 2) not null default 0,
  primary key (user_id, symbol)
);

-- --- cards / bills -----------------------------------------------------------

create table cards (
  id                  text primary key,
  user_id             uuid not null references users (id) on delete cascade,
  kind                text not null check (kind in ('virtual', 'physical')),
  label               text not null,
  last4               text not null,
  network             text not null check (network in ('Visa', 'Mastercard')),
  frozen              boolean not null default false,
  gradient            jsonb not null default '[]'::jsonb,
  limits              jsonb not null default '{}'::jsonb,  -- perPurchase / daily / dailySpent
  channels            jsonb not null default '{}'::jsonb,  -- online / offline / atm
  settlement_currency text not null default 'USD'
);
create index cards_user_idx on cards (user_id);

create table bills (
  id          text primary key,
  user_id     uuid not null references users (id) on delete cascade,
  provider    text not null,
  category    text not null
              check (category in ('utility', 'credit-card', 'mortgage', 'loan', 'telecom')),
  balance_due numeric(20, 2) not null default 0,
  due_date    date not null,
  autopay     boolean not null default false
);
create index bills_user_idx on bills (user_id);

-- --- transactions --------------------------------------------------------------

create table transactions (
  id         text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  category   text not null
             check (category in ('card', 'transfer', 'swap', 'invest', 'bill', 'ramp', 'yield')),
  direction  text not null check (direction in ('in', 'out')),
  title      text not null,
  subtitle   text not null default '',
  amount_usd numeric(20, 2) not null,
  token      text,
  chain      text,
  card_id    text,
  ts         timestamptz not null default now(),
  status     text not null check (status in ('settled', 'pending', 'escrow', 'declined'))
);
-- Feed query: newest-first per user.
create index transactions_user_ts_idx on transactions (user_id, ts desc);

-- --- housekeeping ---------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- Service-role-only access: RLS on, zero policies. PostgREST with the service
-- key bypasses RLS; the anon key gets nothing.
alter table users          enable row level security;
alter table token_balances enable row level security;
alter table fiat_balances  enable row level security;
alter table holdings       enable row level security;
alter table cards          enable row level security;
alter table bills          enable row level security;
alter table transactions   enable row level security;
