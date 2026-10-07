-- ===========================================================================
-- 0032 — Onchain ingestion read model (Allium Beam webhooks + Realtime API
-- backfill/reconciliation). docs/ALLIUM_INTEGRATION.md has the full design.
--
-- Numbered 0032 because 0031 is taken on security/full-audit-2026-10-06.
--
-- WHAT THIS IS: an ANALYTICS read model of blockchain activity that touches
-- addresses FurlPay tracks (verified linked wallets, treasury addresses). It
-- OBSERVES the chain. It never posts to the financial ledger, never changes a
-- balance, a payment, a settlement or a withdrawal. A disagreement with the
-- ledger is flagged (reconciliation_required), never written back.
--
-- IDENTITY: event_key = "<chain>:<tx_hash>:<log_index>" (lowercased) for token
-- transfers, the same identity as Allium's own unique_id (transaction hash +
-- log index). Delivery is at-least-once, so every write goes through
-- onchain_ingest(), which is idempotent on event_key.
--
-- REORGS: Allium corrects reorged data by replacing it (guides/reorgs). A
-- redelivery of the same event_key with a DIFFERENT block_hash is a reorg
-- replacement: the old version is preserved in onchain_event_revisions and the
-- row is updated. A row the provider no longer returns is marked 'reorged' by
-- reconciliation. Nothing is ever deleted.
--
-- ACCESS: service_role only. RLS on, no policies, all privileges revoked from
-- anon/authenticated — the browser never reads these tables; the public
-- dashboard reads redacted aggregates through the Next.js server.
-- ===========================================================================

create table if not exists onchain_events (
  id                 bigserial primary key,
  event_key          text not null unique check (event_key = lower(event_key) and length(event_key) between 10 and 300),
  source             text not null check (source in ('allium_beam', 'allium_realtime_api', 'reconcile', 'node_rpc')),
  chain              text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  tx_hash            text not null check (length(tx_hash) between 8 and 128),
  block_number       bigint check (block_number >= 0),
  block_hash         text,
  block_timestamp    timestamptz not null,
  log_index          integer,
  from_address       text,
  to_address         text,
  asset_address      text,
  asset_symbol       text,
  asset_decimals     integer check (asset_decimals between 0 and 255),
  -- Exact integer base units (uint256 fits in 78 digits) and the exact decimal
  -- amount from the provider's *_str field. Never floats.
  amount_raw         numeric(78, 0) check (amount_raw >= 0),
  amount             numeric check (amount >= 0),
  -- Provider-reported USD value (Allium usd_amount). Display/analytics only.
  amount_usd         numeric(30, 8) check (amount_usd >= 0),
  activity_type      text not null default 'transfer',
  -- Relative to the tracked address: 'in', 'out' or 'self'.
  direction          text not null check (direction in ('in', 'out', 'self')),
  tracked_address    text not null,
  scope              text not null check (scope in ('user', 'treasury', 'watch')),
  user_id            uuid references users (id) on delete set null,
  confirmation_state text not null check (confirmation_state in ('observed', 'confirmed', 'finalized', 'reorged')),
  revision           integer not null default 1,
  provider_event_id  text,
  -- Ledger correlation (ops_tx_events.id) and a flag when the chain and the
  -- ledger disagree. Set by reconciliation; never acted on automatically.
  ledger_ref              text,
  reconciliation_required boolean not null default false,
  reconciliation_note     text,
  -- AML: the OFAC SDN screen of the counterparty at ingest (packages/compliance
  -- screenWallet). A FLAG for operators: this read model never freezes or
  -- moves anything.
  risk_action        text not null default 'allow' check (risk_action in ('allow', 'review', 'block')),
  risk_flags         jsonb not null default '[]'::jsonb,
  -- True when the reorg was PROVEN against a finalized canonical block (the
  -- transaction is absent from the chain a FurlPay-configured node serves at
  -- a finalized height). Such an event can never be reinstated by a later
  -- delivery of the same (orphaned) block: finality is final.
  reorg_final        boolean not null default false,
  metadata           jsonb not null default '{}'::jsonb,
  observed_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists onchain_events_chain_tx_idx     on onchain_events (chain, tx_hash);
create index if not exists onchain_events_chain_block_idx  on onchain_events (chain, block_number);
create index if not exists onchain_events_from_idx         on onchain_events (from_address, block_timestamp desc);
create index if not exists onchain_events_to_idx           on onchain_events (to_address, block_timestamp desc);
create index if not exists onchain_events_asset_idx        on onchain_events (asset_symbol, block_timestamp desc);
create index if not exists onchain_events_activity_idx     on onchain_events (activity_type, block_timestamp desc);
create index if not exists onchain_events_state_idx        on onchain_events (confirmation_state, block_timestamp desc);
create index if not exists onchain_events_ts_idx           on onchain_events (block_timestamp desc, id desc);
create index if not exists onchain_events_id_idx           on onchain_events (id desc);
create index if not exists onchain_events_user_idx         on onchain_events (user_id, block_timestamp desc) where user_id is not null;
create index if not exists onchain_events_recon_idx        on onchain_events (reconciliation_required) where reconciliation_required;

-- Append-only audit trail: every state change or reorg replacement keeps the
-- version it replaced.
create table if not exists onchain_event_revisions (
  id          bigserial primary key,
  event_key   text not null,
  revision    integer not null,
  change      text not null check (change in ('promoted', 'reorg_replaced', 'reorged', 'reinstated', 'ledger_flagged', 'source_conflict')),
  previous    jsonb not null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists onchain_event_revisions_key_idx on onchain_event_revisions (event_key, revision);

create or replace function onchain_revisions_append_only() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'onchain_event_revisions is append-only';
end $$;
drop trigger if exists onchain_event_revisions_no_update on onchain_event_revisions;
create trigger onchain_event_revisions_no_update
  before update or delete on onchain_event_revisions
  for each row execute function onchain_revisions_append_only();

-- Webhook replay protection: a signed delivery's nonce is claimed once.
create table if not exists onchain_webhook_nonces (
  nonce       text primary key check (nonce ~ '^[0-9a-f-]{36}$'),
  received_at timestamptz not null default now()
);
create index if not exists onchain_webhook_nonces_received_idx on onchain_webhook_nonces (received_at);

-- Deliveries that authenticated but could not be used (unknown shape, unknown
-- chain, out-of-range values). Kept for inspection and replay; never retried
-- automatically, so a bad record cannot loop.
create table if not exists onchain_dead_letters (
  id           bigserial primary key,
  source       text not null,
  reason       text not null,
  payload_hash text not null,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (source, payload_hash)
);
create index if not exists onchain_dead_letters_open_idx on onchain_dead_letters (received_at desc) where resolved_at is null;

-- Backfill / reconciliation progress per (chain, address).
create table if not exists onchain_ingest_checkpoints (
  chain        text not null,
  address      text not null,
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  events_seen  bigint not null default 0,
  primary key (chain, address)
);

create table if not exists onchain_reconciliation_runs (
  id              bigserial primary key,
  kind            text not null check (kind in ('backfill', 'reconcile')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  addresses       integer not null default 0,
  provider_events integer not null default 0,
  inserted        integer not null default 0,
  duplicates      integer not null default 0,
  reorg_replaced  integer not null default 0,
  marked_reorged  integer not null default 0,
  ledger_flagged  integer not null default 0,
  errors          jsonb not null default '[]'::jsonb
);
create index if not exists onchain_reconciliation_runs_started_idx on onchain_reconciliation_runs (started_at desc);

-- Observability, maintained INSIDE onchain_ingest (same transaction as the
-- writes it counts): per UTC hour and source, how many events arrived, what
-- happened to them, and ingest lag = observed_at - block_timestamp of new rows.
create table if not exists onchain_ingest_metrics (
  bucket        timestamptz not null,
  source        text not null,
  received      bigint not null default 0,
  inserted      bigint not null default 0,
  duplicates    bigint not null default 0,
  promoted      bigint not null default 0,
  reorg_replaced bigint not null default 0,
  reinstated    bigint not null default 0,
  conflicts     bigint not null default 0,
  lag_ms_sum    numeric not null default 0,
  lag_ms_max    bigint not null default 0,
  lag_n         bigint not null default 0,
  primary key (bucket, source)
);

-- Per-upstream freshness, shared by every server instance: when a source last
-- succeeded, last failed (and why), and the newest data time it delivered.
create table if not exists onchain_source_status (
  source         text primary key check (source ~ '^[a-z0-9_:.-]{2,64}$'),
  last_success_at timestamptz,
  last_error_at  timestamptz,
  last_error     text,
  last_data_at   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Direct-to-node scanning (lib/onchain/nodeIndexer.ts): per chain, the
-- newest FINALIZED block whose Transfer logs have been fully scanned for the
-- tracked addresses. Everything above it is re-scanned every run (idempotent),
-- so the unfinalized tip is always re-read from the node. chain_id (EVM) or
-- genesis_hash (Solana has no chain id; lib/onchain/solanaNodeIndexer.ts) pins
-- the endpoint: a URL that starts answering for another chain is refused.
-- For Solana, last_block is a slot and last_block_hash that slot's blockhash.
create table if not exists onchain_node_cursors (
  chain            text primary key check (chain ~ '^[a-z0-9_-]{2,32}$'),
  chain_id         bigint check (chain_id > 0),
  genesis_hash     text check (genesis_hash is null or length(genesis_hash) between 32 and 64),
  last_block       bigint not null check (last_block >= 0),
  last_block_hash  text not null,
  updated_at       timestamptz not null default now(),
  check (chain_id is not null or genesis_hash is not null)
);

-- Upgrade path for a database that applied the FIRST version of this file
-- (committed at 2e5f3657 or 461ff1bb, before direct-to-node ingestion). There
-- `create table if not exists` above skipped the existing tables, so bring
-- them to this version explicitly. Every statement is a no-op on a database
-- created from this version (idempotent; verified by
-- scripts/db/verify-onchain-upgrade.mjs).
-- (2e5f3657 also predates the OFAC screen columns added in 461ff1bb.)
alter table onchain_events add column if not exists risk_action text not null default 'allow';
alter table onchain_events add column if not exists risk_flags jsonb not null default '[]'::jsonb;
alter table onchain_events drop constraint if exists onchain_events_risk_action_check;
alter table onchain_events add constraint onchain_events_risk_action_check check (risk_action in ('allow', 'review', 'block'));
alter table onchain_events add column if not exists reorg_final boolean not null default false;
alter table onchain_ingest_metrics add column if not exists conflicts bigint not null default 0;
alter table onchain_events drop constraint if exists onchain_events_source_check;
alter table onchain_events add constraint onchain_events_source_check
  check (source in ('allium_beam', 'allium_realtime_api', 'reconcile', 'node_rpc'));
alter table onchain_event_revisions drop constraint if exists onchain_event_revisions_change_check;
alter table onchain_event_revisions add constraint onchain_event_revisions_change_check
  check (change in ('promoted', 'reorg_replaced', 'reorged', 'reinstated', 'ledger_flagged', 'source_conflict'));
alter table onchain_node_cursors add column if not exists genesis_hash text;
alter table onchain_node_cursors alter column chain_id drop not null;
-- The functions below gained a parameter; the old signatures would otherwise
-- remain as overloads and make every existing call ambiguous.
drop function if exists onchain_mark_reorged(text, text);
drop function if exists onchain_node_cursor_advance(text, bigint, bigint, bigint, text);

-- Entity labels. Only provider-verified labels are stored; no row = unknown.
create table if not exists onchain_entity_labels (
  chain        text not null,
  address      text not null,
  entity_name  text,
  entity_type  text,
  labels       jsonb not null default '[]'::jsonb,
  source       text not null,
  updated_at   timestamptz not null default now(),
  primary key (chain, address)
);

-- Hourly rollup the dashboard reads instead of raw rows. Rebuilt per touched
-- hour by onchain_refresh_hourly (delete + insert in one transaction), so a
-- reorg or a late event corrects the hour exactly; reorged rows are excluded.
-- Buckets are UTC hours regardless of the session TimeZone (3-argument
-- date_trunc): in a half-hour zone the 2-argument form shifts every bucket.
create table if not exists onchain_hourly (
  bucket        timestamptz not null,
  chain         text not null,
  asset_symbol  text not null,
  activity_type text not null,
  direction     text not null,
  scope         text not null,
  n             bigint not null,
  volume_usd    numeric(30, 8) not null,
  primary key (bucket, chain, asset_symbol, activity_type, direction, scope)
);
create index if not exists onchain_hourly_bucket_idx on onchain_hourly (bucket desc);

create or replace function onchain_refresh_hourly(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  f timestamptz := date_trunc('hour', p_from, 'UTC');
  t timestamptz := date_trunc('hour', p_to, 'UTC') + interval '1 hour';
begin
  if t - f > interval '120 days' then
    raise exception 'onchain_refresh_hourly window too large';
  end if;
  -- Two concurrent ingests touching the same hour would each delete-then-
  -- insert it and collide on the primary key (found by the load test). A
  -- transaction-scoped advisory lock serializes rebuilds; under READ
  -- COMMITTED the waiter's statements then see the first transaction's
  -- committed events, so the rebuilt hour includes both.
  perform pg_advisory_xact_lock(hashtext('onchain_hourly_refresh'));
  delete from onchain_hourly where bucket >= f and bucket < t;
  insert into onchain_hourly (bucket, chain, asset_symbol, activity_type, direction, scope, n, volume_usd)
  select date_trunc('hour', block_timestamp, 'UTC'), chain, coalesce(upper(asset_symbol), 'OTHER'), activity_type, direction, scope,
         count(*), coalesce(sum(amount_usd), 0)
    from onchain_events
   where block_timestamp >= f and block_timestamp < t
     and confirmation_state <> 'reorged'
   group by 1, 2, 3, 4, 5, 6;
end $$;

create or replace function onchain_state_rank(s text) returns integer
language sql immutable set search_path = public, pg_catalog as $$
  select case s when 'observed' then 1 when 'confirmed' then 2 when 'finalized' then 3 else 0 end
$$;

-- The ONE write path. Idempotent on event_key; atomic per call.
--   new key                          -> inserted
--   same key, same block, same/lower -> duplicate (no change)
--   same key, same block, higher     -> promoted (observed -> confirmed -> finalized; never backwards)
--   same key, different block_hash   -> reorg_replaced (old version kept in revisions)
--   same key, row was 'reorged'      -> reinstated
--   irreconcilable (see below)       -> conflicts: flagged reconciliation_required, never overwritten
-- Then rebuilds the hourly rollup for exactly the hours touched.
create or replace function onchain_ingest(p_events jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  e jsonb;
  cur onchain_events%rowtype;
  k text;
  new_state text;
  v_inserted int := 0; v_dup int := 0; v_promoted int := 0; v_reorg int := 0; v_reinstated int := 0; v_conflict int := 0;
  v_conflict_note text;
  t_min timestamptz; t_max timestamptz; ts timestamptz;
  v_blocked text[] := '{}';
  v_lag_sum numeric := 0; v_lag_max bigint := 0; v_lag_n int := 0; v_lag bigint;
  v_source text;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception 'onchain_ingest expects an array of at most 500 events';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    k := lower(e->>'event_key');
    new_state := e->>'confirmation_state';
    ts := (e->>'block_timestamp')::timestamptz;
    v_source := coalesce(v_source, e->>'source');

    insert into onchain_events (event_key, source, chain, tx_hash, block_number, block_hash, block_timestamp, log_index,
      from_address, to_address, asset_address, asset_symbol, asset_decimals, amount_raw, amount, amount_usd,
      activity_type, direction, tracked_address, scope, user_id, confirmation_state, provider_event_id, metadata,
      risk_action, risk_flags)
    values (k, e->>'source', e->>'chain', e->>'tx_hash', (e->>'block_number')::bigint, e->>'block_hash', ts,
      (e->>'log_index')::int, e->>'from_address', e->>'to_address', e->>'asset_address', e->>'asset_symbol',
      (e->>'asset_decimals')::int, (e->>'amount_raw')::numeric, (e->>'amount')::numeric, (e->>'amount_usd')::numeric,
      coalesce(e->>'activity_type', 'transfer'), e->>'direction', e->>'tracked_address', e->>'scope',
      nullif(e->>'user_id', '')::uuid, new_state, e->>'provider_event_id', coalesce(e->'metadata', '{}'::jsonb),
      coalesce(e->>'risk_action', 'allow'), coalesce(e->'risk_flags', '[]'::jsonb))
    on conflict (event_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
      -- The caller raises one security event per NEWLY inserted blocked event;
      -- a redelivery is not new, so it can never raise a second one.
      if coalesce(e->>'risk_action', 'allow') = 'block' then v_blocked := v_blocked || k; end if;
      v_lag := greatest(0, (extract(epoch from (now() - ts)) * 1000)::bigint);
      v_lag_sum := v_lag_sum + v_lag; v_lag_max := greatest(v_lag_max, v_lag); v_lag_n := v_lag_n + 1;
      t_min := least(coalesce(t_min, ts), ts); t_max := greatest(coalesce(t_max, ts), ts);
      continue;
    end if;

    select * into cur from onchain_events where event_key = k for update;

    -- Two sources (or two deliveries) that cannot both be true. Nothing is
    -- overwritten: the row is flagged for an operator, once.
    --   * a finalized event delivered in a different block (a lagging source
    --     still serving an orphaned fork, or bad data): finality is final;
    --   * an event proven orphaned at a finalized height delivered again;
    --   * the same event in the same block with a different exact amount.
    v_conflict_note := case
      when cur.confirmation_state = 'finalized' and (e->>'block_hash') is not null and cur.block_hash is not null
           and (e->>'block_hash') <> cur.block_hash
        then format('%s delivered block %s for a finalized event in block %s', e->>'source', left(e->>'block_hash', 18), left(cur.block_hash, 18))
      -- (a delivery in a DIFFERENT block is a legitimate re-inclusion and is
      -- handled as reorg_replaced below; one with no block hash cannot be told
      -- apart from the orphan, so it is a conflict too)
      when cur.confirmation_state = 'reorged' and cur.reorg_final
           and ((e->>'block_hash') is null or (e->>'block_hash') = cur.block_hash)
        then format('%s delivered an event proven absent from the finalized chain', e->>'source')
      when (e->>'amount_raw') is not null and cur.amount_raw is not null and (e->>'amount_raw')::numeric <> cur.amount_raw
           and (e->>'block_hash') is not distinct from cur.block_hash
        then format('%s reports amount_raw %s; stored %s (%s)', e->>'source', e->>'amount_raw', cur.amount_raw, cur.source)
    end;
    if v_conflict_note is not null then
      if not cur.reconciliation_required then
        insert into onchain_event_revisions (event_key, revision, change, previous, reason)
          values (k, cur.revision, 'source_conflict', to_jsonb(cur), left(v_conflict_note, 300));
        update onchain_events set reconciliation_required = true, reconciliation_note = left(v_conflict_note, 300),
          revision = cur.revision + 1, updated_at = now() where event_key = k;
      end if;
      v_conflict := v_conflict + 1;
      continue;
    end if;

    if cur.confirmation_state = 'reorged' and (e->>'block_hash') is not distinct from cur.block_hash then
      insert into onchain_event_revisions (event_key, revision, change, previous, reason)
        values (k, cur.revision, 'reinstated', to_jsonb(cur), 'redelivered after being marked reorged');
      update onchain_events set confirmation_state = new_state, revision = cur.revision + 1, updated_at = now() where event_key = k;
      v_reinstated := v_reinstated + 1;
    elsif (e->>'block_hash') is not null and cur.block_hash is not null and (e->>'block_hash') <> cur.block_hash then
      insert into onchain_event_revisions (event_key, revision, change, previous, reason)
        values (k, cur.revision, 'reorg_replaced', to_jsonb(cur), 'same event identity delivered in a different block');
      update onchain_events set
        block_number = (e->>'block_number')::bigint, block_hash = e->>'block_hash', block_timestamp = ts,
        from_address = e->>'from_address', to_address = e->>'to_address', amount_raw = (e->>'amount_raw')::numeric,
        amount = (e->>'amount')::numeric, amount_usd = (e->>'amount_usd')::numeric, confirmation_state = new_state,
        reorg_final = false, revision = cur.revision + 1, updated_at = now()
       where event_key = k;
      v_reorg := v_reorg + 1;
      t_min := least(coalesce(t_min, cur.block_timestamp), cur.block_timestamp); t_max := greatest(coalesce(t_max, cur.block_timestamp), cur.block_timestamp);
    elsif onchain_state_rank(new_state) > onchain_state_rank(cur.confirmation_state) then
      insert into onchain_event_revisions (event_key, revision, change, previous, reason)
        values (k, cur.revision, 'promoted', to_jsonb(cur), cur.confirmation_state || ' -> ' || new_state);
      update onchain_events set confirmation_state = new_state, revision = cur.revision + 1,
        block_hash = coalesce(cur.block_hash, e->>'block_hash'), updated_at = now() where event_key = k;
      v_promoted := v_promoted + 1;
    else
      v_dup := v_dup + 1;
      continue;
    end if;
    t_min := least(coalesce(t_min, ts), ts); t_max := greatest(coalesce(t_max, ts), ts);
  end loop;

  if t_min is not null then
    perform onchain_refresh_hourly(t_min, t_max);
  end if;

  if jsonb_array_length(p_events) > 0 then
    insert into onchain_ingest_metrics as m (bucket, source, received, inserted, duplicates, promoted, reorg_replaced, reinstated, conflicts, lag_ms_sum, lag_ms_max, lag_n)
    values (date_trunc('hour', now(), 'UTC'), coalesce(v_source, 'unknown'), jsonb_array_length(p_events), v_inserted, v_dup, v_promoted, v_reorg, v_reinstated, v_conflict, v_lag_sum, v_lag_max, v_lag_n)
    on conflict (bucket, source) do update set
      received = m.received + excluded.received, inserted = m.inserted + excluded.inserted,
      duplicates = m.duplicates + excluded.duplicates, promoted = m.promoted + excluded.promoted,
      reorg_replaced = m.reorg_replaced + excluded.reorg_replaced, reinstated = m.reinstated + excluded.reinstated,
      conflicts = m.conflicts + excluded.conflicts,
      lag_ms_sum = m.lag_ms_sum + excluded.lag_ms_sum, lag_ms_max = greatest(m.lag_ms_max, excluded.lag_ms_max),
      lag_n = m.lag_n + excluded.lag_n;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_dup, 'promoted', v_promoted,
                            'reorg_replaced', v_reorg, 'reinstated', v_reinstated, 'conflicts', v_conflict, 'blocked_keys', to_jsonb(v_blocked));
end $$;

-- Freshness bookkeeping for an upstream source (webhook, reconciliation,
-- market data, saved queries). p_ok=false records the error.
create or replace function onchain_touch_source(p_source text, p_ok boolean, p_error text default null, p_data_at timestamptz default null)
returns void
language sql
set search_path = public, pg_catalog
as $$
  insert into onchain_source_status as s (source, last_success_at, last_error_at, last_error, last_data_at, updated_at)
  values (p_source, case when p_ok then now() end, case when not p_ok then now() end, case when not p_ok then left(p_error, 300) end, p_data_at, now())
  on conflict (source) do update set
    last_success_at = case when p_ok then now() else s.last_success_at end,
    last_error_at = case when not p_ok then now() else s.last_error_at end,
    last_error = case when not p_ok then left(p_error, 300) else s.last_error end,
    last_data_at = greatest(s.last_data_at, p_data_at),
    updated_at = now()
$$;

-- Reconciliation: the provider no longer returns an event inside its finality
-- window. Mark it (never delete) and rebuild its hour.
-- p_final: the caller PROVED the event is absent from a finalized canonical
-- block (lib/onchain/nodeIndexer.ts). Without it this is the provider-based
-- judgement (absent from a fully paginated Allium window), which a later
-- delivery of the same block may overturn ('reinstated').
create or replace function onchain_mark_reorged(p_event_key text, p_reason text, p_final boolean default false)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare cur onchain_events%rowtype;
begin
  select * into cur from onchain_events where event_key = lower(p_event_key) for update;
  if not found then return false; end if;
  if cur.confirmation_state = 'reorged' then
    -- Upgrade a provider judgement to a proof; never downgrade.
    if p_final and not cur.reorg_final then
      update onchain_events set reorg_final = true, updated_at = now() where event_key = cur.event_key;
      return true;
    end if;
    return false;
  end if;
  insert into onchain_event_revisions (event_key, revision, change, previous, reason)
    values (cur.event_key, cur.revision, 'reorged', to_jsonb(cur), left(p_reason, 300));
  update onchain_events set confirmation_state = 'reorged', reorg_final = coalesce(p_final, false), revision = cur.revision + 1, updated_at = now()
   where event_key = cur.event_key;
  perform onchain_refresh_hourly(cur.block_timestamp, cur.block_timestamp);
  return true;
end $$;

-- Reconciliation: chain and ledger disagree. Flag only.
create or replace function onchain_flag_ledger(p_event_key text, p_ledger_ref text, p_note text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare cur onchain_events%rowtype;
begin
  select * into cur from onchain_events where event_key = lower(p_event_key) for update;
  if not found then return false; end if;
  if cur.reconciliation_required and cur.ledger_ref is not distinct from p_ledger_ref then return false; end if;
  insert into onchain_event_revisions (event_key, revision, change, previous, reason)
    values (cur.event_key, cur.revision, 'ledger_flagged', to_jsonb(cur), left(p_note, 300));
  update onchain_events set ledger_ref = p_ledger_ref, reconciliation_required = true,
    reconciliation_note = left(p_note, 300), revision = cur.revision + 1, updated_at = now()
   where event_key = cur.event_key;
  return true;
end $$;

-- Replay protection: true the first time a nonce is seen.
create or replace function onchain_claim_nonce(p_nonce text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  insert into onchain_webhook_nonces (nonce) values (lower(p_nonce)) on conflict do nothing;
  if not found then return false; end if;
  -- Opportunistic pruning: nonces only matter inside the 5-minute window.
  if random() < 0.01 then
    delete from onchain_webhook_nonces where received_at < now() - interval '1 day';
  end if;
  return true;
end $$;

-- Compare-and-set cursor advance. Concurrent scanners both ingest (that is
-- idempotent) but only the one that read the current cursor moves it; the
-- cursor never moves backwards and never changes chain_id / genesis_hash.
create or replace function onchain_node_cursor_advance(p_chain text, p_chain_id bigint, p_expected bigint, p_next bigint, p_hash text, p_genesis text default null)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare cur onchain_node_cursors%rowtype;
begin
  if p_next is null or p_next < 0 or p_hash is null then raise exception 'invalid cursor'; end if;
  if p_chain_id is null and p_genesis is null then raise exception 'cursor needs a chain id or a genesis hash'; end if;
  select * into cur from onchain_node_cursors where chain = p_chain for update;
  if not found then
    if p_expected is not null then return false; end if;
    insert into onchain_node_cursors (chain, chain_id, genesis_hash, last_block, last_block_hash) values (p_chain, p_chain_id, p_genesis, p_next, p_hash)
      on conflict (chain) do nothing;
    return found;
  end if;
  if cur.chain_id is distinct from p_chain_id then
    raise exception 'chain % is pinned to chain id %, endpoint answered %', p_chain, cur.chain_id, p_chain_id;
  end if;
  if cur.genesis_hash is distinct from p_genesis then
    raise exception 'chain % is pinned to genesis %, endpoint answered %', p_chain, cur.genesis_hash, p_genesis;
  end if;
  if p_expected is distinct from cur.last_block or p_next < cur.last_block then return false; end if;
  update onchain_node_cursors set last_block = p_next, last_block_hash = p_hash, updated_at = now() where chain = p_chain;
  return true;
end $$;

-- Health for the dashboard's live/stale state.
create or replace function onchain_health()
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'events_total', (select count(*) from onchain_events),
    'last_observed_at', (select max(observed_at) from onchain_events),
    'last_block_timestamp', (select max(block_timestamp) from onchain_events where confirmation_state <> 'reorged'),
    'dead_letters_open', (select count(*) from onchain_dead_letters where resolved_at is null),
    'dead_letters_24h', (select count(*) from onchain_dead_letters where received_at > now() - interval '24 hours'),
    'reconciliation_required', (select count(*) from onchain_events where reconciliation_required),
    'reorged_total', (select count(*) from onchain_events where confirmation_state = 'reorged'),
    'last_run', (select to_jsonb(r) from onchain_reconciliation_runs r order by started_at desc limit 1),
    'metrics_1h', (select coalesce(jsonb_object_agg(source, jsonb_build_object(
        'received', received, 'inserted', inserted, 'duplicates', duplicates, 'reorg_replaced', reorg_replaced, 'conflicts', conflicts,
        'lag_ms_avg', case when lag_n > 0 then round(lag_ms_sum / lag_n) end, 'lag_ms_max', lag_ms_max)), '{}'::jsonb)
      from (select source, sum(received) received, sum(inserted) inserted, sum(duplicates) duplicates, sum(reorg_replaced) reorg_replaced, sum(conflicts) conflicts,
                   sum(lag_ms_sum) lag_ms_sum, max(lag_ms_max) lag_ms_max, sum(lag_n) lag_n
              from onchain_ingest_metrics where bucket >= date_trunc('hour', now(), 'UTC') - interval '1 hour' group by source) x),
    'sources', (select coalesce(jsonb_object_agg(source, to_jsonb(s) - 'source'), '{}'::jsonb) from onchain_source_status s),
    'node_cursors', (select coalesce(jsonb_object_agg(chain, jsonb_build_object('last_block', last_block, 'updated_at', updated_at)), '{}'::jsonb) from onchain_node_cursors)
  )
$$;

-- ── Access: service_role only ───────────────────────────────────────────────
-- Spelled out per table (rlsCoverage.spec reads these statically).
alter table onchain_events enable row level security;
alter table onchain_event_revisions enable row level security;
alter table onchain_webhook_nonces enable row level security;
alter table onchain_dead_letters enable row level security;
alter table onchain_ingest_checkpoints enable row level security;
alter table onchain_reconciliation_runs enable row level security;
alter table onchain_entity_labels enable row level security;
alter table onchain_hourly enable row level security;
alter table onchain_ingest_metrics enable row level security;
alter table onchain_source_status enable row level security;
alter table onchain_node_cursors enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onchain_events', 'onchain_event_revisions', 'onchain_webhook_nonces', 'onchain_dead_letters',
                           'onchain_ingest_checkpoints', 'onchain_reconciliation_runs', 'onchain_entity_labels', 'onchain_hourly',
                           'onchain_ingest_metrics', 'onchain_source_status', 'onchain_node_cursors'] loop
    execute format('revoke all on table %I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table %I to service_role', t);
  end loop;
  grant usage, select on all sequences in schema public to service_role;
end $$;
grant delete on table onchain_hourly, onchain_webhook_nonces to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'onchain_refresh_hourly(timestamptz, timestamptz)', 'onchain_state_rank(text)', 'onchain_ingest(jsonb)',
    'onchain_mark_reorged(text, text, boolean)', 'onchain_flag_ledger(text, text, text)', 'onchain_claim_nonce(text)', 'onchain_health()',
    'onchain_touch_source(text, boolean, text, timestamptz)',
    'onchain_node_cursor_advance(text, bigint, bigint, bigint, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
