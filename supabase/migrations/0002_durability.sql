-- ---------------------------------------------------------------------------
-- Durability pass — tables for state that today lives outside the user store:
--
--   trips      apps/web/src/lib/travel/store.ts     (in-memory demo trips)
--   deposits   apps/web/src/lib/services/deposits.ts (Redis, 24h TTL — this is
--              the durable ledger its TTL comment defers to)
--   audit_log  append-only compliance trail for money/identity mutations
--
-- Plus transfer_tokens(): the atomic balance-move primitive. Concurrency
-- hazards it closes: overdraft (guarded UPDATE + CHECK constraint), double
-- spend (row locks), and deadlock between opposite transfers (rows always
-- locked in user_id order).
--
-- Access model unchanged from 0001: service-role only; RLS on, zero policies.
-- ---------------------------------------------------------------------------

-- --- trips (Duffel / Travala bookings) ---------------------------------------
-- Mirrors the Trip interface. user_id is nullable: the demo funnel books
-- without an account; live bookings always set it.

create table trips (
  id             text primary key,
  user_id        uuid references users (id) on delete cascade,
  name           text not null,
  city           text not null,
  image          text not null default '',    -- tailwind gradient token
  check_in       date not null,
  check_out      date not null,
  nights         smallint not null check (nights > 0),
  guests         smallint not null check (guests > 0),
  amount_usd     numeric(20, 2) not null check (amount_usd >= 0),
  source         text not null check (source in ('travala', 'legacy')),
  method         text not null,               -- human label of the payment method
  status         text not null default 'confirmed'
                 check (status in ('confirmed', 'pending', 'cancelled')),
  tx_hash        text,
  card_last4     text,
  cashback_usd   numeric(20, 2) not null default 0,
  refund_status  text,
  ticket         jsonb,                        -- TicketCnft receipt (mint address etc.)
  created_at     timestamptz not null default now()
);
create index trips_user_idx on trips (user_id, created_at desc);

-- --- deposits (on-chain, durable ledger) --------------------------------------
-- Redis keeps the hot 24h window (deposit:{txHash}); this table is the
-- permanent record. tx_hash as primary key = idempotent webhook upserts, and
-- `credited` is the durable single-credit guard behind the Redis NX fast path.

create table deposits (
  tx_hash                text primary key,
  order_id               text not null unique,  -- FP{timestamp}{rand} human reference
  user_id                uuid references users (id) on delete set null,
  token                  text not null,
  chain                  text not null,
  amount                 numeric(38, 18) not null check (amount > 0),
  from_address           text not null,
  to_address             text not null,
  status                 text not null default 'pending'
                         check (status in ('pending', 'processing', 'success')),
  confirmations          integer not null default 0,
  required_confirmations integer not null,
  credited               boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index deposits_user_idx   on deposits (user_id, created_at desc);
create index deposits_recent_idx on deposits (updated_at desc);

create trigger deposits_updated_at
  before update on deposits
  for each row execute function set_updated_at();

-- --- audit log ------------------------------------------------------------------
-- Append-only. user_id is deliberately NOT a foreign key: the trail must
-- outlive account deletion (GDPR erasure removes the user row, not the
-- evidence that actions happened).

create table audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  action     text not null,                    -- e.g. 'transfer', 'kyc.approve', 'card.freeze'
  details    jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on audit_log (user_id, created_at desc);

-- --- atomic transfer -------------------------------------------------------------
-- Moves p_amount of (token, chain) between users and writes both ledger rows
-- in ONE transaction. Row locks are taken in user_id order so two opposite
-- transfers (A→B and B→A) queue instead of deadlocking.

create or replace function transfer_tokens(
  p_from       uuid,
  p_to         uuid,
  p_token      text,
  p_chain      text,
  p_amount     numeric,
  p_amount_usd numeric default null,  -- ledger display value; defaults to p_amount (stablecoins)
  p_title      text default null
) returns void
language plpgsql
as $$
declare
  v_usd numeric := coalesce(p_amount_usd, p_amount);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'transfer amount must be positive';
  end if;
  if p_from = p_to then
    raise exception 'cannot transfer to self';
  end if;

  -- Receiver row must exist before locking so both rows lock in one
  -- deterministic pass.
  insert into token_balances (user_id, token, chain, amount)
  values (p_to, p_token, p_chain, 0)
  on conflict (user_id, token, chain) do nothing;

  perform 1
    from token_balances
   where token = p_token and chain = p_chain and user_id in (p_from, p_to)
   order by user_id
     for update;

  update token_balances
     set amount = amount - p_amount
   where user_id = p_from and token = p_token and chain = p_chain
     and amount >= p_amount;                   -- overdraft guard
  if not found then
    raise exception 'insufficient % balance on %', p_token, p_chain;
  end if;

  update token_balances
     set amount = amount + p_amount
   where user_id = p_to and token = p_token and chain = p_chain;

  insert into transactions (id, user_id, category, direction, title, subtitle, amount_usd, token, chain, status)
  values
    ('tx_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
     p_from, 'transfer', 'out', coalesce(p_title, 'Sent ' || p_token),
     p_token || ' · ' || p_chain, v_usd, p_token, p_chain, 'settled'),
    ('tx_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
     p_to, 'transfer', 'in', coalesce(p_title, 'Received ' || p_token),
     p_token || ' · ' || p_chain, v_usd, p_token, p_chain, 'settled');

  insert into audit_log (user_id, action, details)
  values (p_from, 'transfer',
          jsonb_build_object('to', p_to, 'token', p_token, 'chain', p_chain, 'amount', p_amount));
end $$;

-- Service-role-only access, same as 0001: RLS on, zero policies.
alter table trips     enable row level security;
alter table deposits  enable row level security;
alter table audit_log enable row level security;
