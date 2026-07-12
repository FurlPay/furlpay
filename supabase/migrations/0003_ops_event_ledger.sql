-- ---------------------------------------------------------------------------
-- Ops event ledger
--
-- Redis remains the bounded hot feed for dashboards. These tables are the
-- durable append-only record for real money-rail lifecycle and security events.
-- Service-role code can insert, but update/delete are blocked by triggers.
-- ---------------------------------------------------------------------------

create table ops_tx_events (
  id           text primary key,
  rail         text not null check (rail in ('x402', 'mpp', 'lifi', 'cctp', 'transfers')),
  state        text not null check (state in ('prepared', 'settled', 'pending', 'failed', 'rejected')),
  substate     text,
  amount_usd   numeric(20, 2),
  fee_usd      numeric(20, 2),
  token        text,
  source_chain text,
  dest_chain   text,
  payer        text,
  recipient    text,
  tx_hash      text,
  user_id      uuid,
  created_at   timestamptz not null default now()
);

create index ops_tx_events_created_idx on ops_tx_events (created_at desc);
create index ops_tx_events_rail_state_idx on ops_tx_events (rail, state, created_at desc);
create index ops_tx_events_user_idx on ops_tx_events (user_id, created_at desc);
create index ops_tx_events_hash_idx on ops_tx_events (tx_hash) where tx_hash is not null;

create table ops_security_events (
  id           text primary key,
  kind         text not null,
  rail         text not null check (rail in ('x402', 'mpp', 'lifi', 'cctp', 'transfers')),
  severity     text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  detail       text not null,
  actor        text,
  acknowledged boolean not null default false,
  created_at   timestamptz not null default now()
);

create index ops_security_events_created_idx on ops_security_events (created_at desc);
create index ops_security_events_kind_idx on ops_security_events (kind, created_at desc);
create index ops_security_events_severity_idx on ops_security_events (severity, created_at desc);

create or replace function block_ops_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops event ledger is append-only';
end $$;

create trigger ops_tx_events_no_update
  before update or delete on ops_tx_events
  for each row execute function block_ops_event_mutation();

-- Security events stay append-only except for the ack flag: an update may
-- flip `acknowledged` and nothing else; deletes are always blocked.
create or replace function block_ops_security_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ops event ledger is append-only';
  end if;
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.rail is distinct from old.rail
     or new.severity is distinct from old.severity
     or new.detail is distinct from old.detail
     or new.actor is distinct from old.actor
     or new.created_at is distinct from old.created_at then
    raise exception 'ops event ledger is append-only (only acknowledged may change)';
  end if;
  return new;
end $$;

create trigger ops_security_events_no_update
  before update or delete on ops_security_events
  for each row execute function block_ops_security_mutation();

alter table ops_tx_events       enable row level security;
alter table ops_security_events enable row level security;
