-- ---------------------------------------------------------------------------
-- 0036 — Ethereum USDC index (finalized-only, compact, aggregate-first)
--
-- Design: docs/onchain/ETHEREUM-USDC-INDEXER-DESIGN.md. Sizing measured in
-- docs/onchain/ETHEREUM-USDC-STORAGE.md (PostgreSQL 18, real mainnet events).
--
--   usdc_index_streams   one row per (chain, contract); config, not per-event
--   usdc_index_state     live finalized cursor (compare-and-set), heads, state
--                        machine, materialised dashboard windows
--   usdc_transfers       compact raw events, RETAINED for a rolling window
--                        (USDC_INDEX_RETENTION_DAYS, default 30); identity
--                        (stream, block_number, log_index)
--   usdc_hourly          exact counts/sums per hour, top-10 transfers, sender/
--                        receiver HLL sketches (p=12) while within retention
--   usdc_daily           the same per UTC day, HLL p=14, kept forever
--   usdc_totals          all-time exact counts/sums + p=14 sketches (O(1) ALL)
--   usdc_ranges          append-only audit of every committed block range
--                        (events, sha256 digest of its canonical events,
--                        providers); a pruned range can be re-derived from the
--                        chain and checked against its digest
--   usdc_backfill_units  claimable historical units (lease + attempts)
--   usdc_index_issues    integrity issues
--
-- Raw on-chain events are the source of truth; every aggregate is derived and
-- rebuildable. Unique senders/receivers are HyperLogLog sketches built in the
-- application and merged here register-wise (max) — no PostgreSQL extension.
-- Distinct counts are never summed across buckets.
--
-- ACCESS: service_role only (RLS on, no policies). IDEMPOTENT throughout.
-- ---------------------------------------------------------------------------

create table if not exists usdc_index_streams (
  stream        smallint primary key,
  chain         text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  chain_id      bigint not null check (chain_id > 0),
  contract      bytea not null check (length(contract) = 20),
  symbol        text not null,
  decimals      smallint not null check (decimals between 0 and 36),
  deploy_block  bigint not null check (deploy_block >= 0),
  unique (chain_id, contract)
);
-- Ethereum mainnet native USDC; deploy block = first block with contract code
-- (binary search on archive state, docs/onchain/ETHEREUM-USDC-MEASUREMENT.md).
insert into usdc_index_streams (stream, chain, chain_id, contract, symbol, decimals, deploy_block)
values (1, 'ethereum', 1, '\xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'USDC', 6, 6082465)
on conflict (stream) do nothing;

create table if not exists usdc_index_state (
  stream                smallint primary key references usdc_index_streams (stream),
  state                 text not null default 'BACKFILLING'
                        check (state in ('BACKFILLING', 'CATCHING_UP', 'LIVE', 'DEGRADED', 'PAUSED', 'ERROR')),
  live_from_block       bigint not null,
  live_from_time        timestamptz not null,      -- block time of the anchor; windows starting before it need history
  cursor_block          bigint not null,
  cursor_hash           bytea not null check (length(cursor_hash) = 32),
  cursor_time           timestamptz not null,
  backfill_through      bigint not null,           -- contiguous history from deploy_block - 1
  head_block            bigint,
  head_time             timestamptz,
  finalized_block       bigint,
  finalized_time        timestamptz,
  supply_raw            numeric(78,0),
  supply_block          bigint,
  windows               jsonb not null default '{}'::jsonb,
  windows_at            timestamptz,
  rpc                   jsonb not null default '{}'::jsonb,
  last_success          timestamptz,
  last_error            text,
  updated_at            timestamptz not null default now()
);

create table if not exists usdc_transfers (
  stream        smallint not null,
  block_number  bigint not null,
  log_index     integer not null check (log_index >= 0),
  block_time    timestamptz not null,
  tx_index      integer not null check (tx_index >= 0),
  tx_hash       bytea not null check (length(tx_hash) = 32),
  sender        bytea not null check (length(sender) = 20),
  recipient     bytea not null check (length(recipient) = 20),
  amount_raw    bigint not null check (amount_raw >= 0),   -- USDC supply < 2^63 base units; larger is refused, not truncated
  kind          smallint not null check (kind in (0, 1, 2)), -- 0 transfer, 1 mint (from 0x0), 2 burn (to 0x0)
  primary key (stream, block_number, log_index)
);
-- Address lookups (both directions), newest first within an address.
create index if not exists usdc_transfers_sender on usdc_transfers (stream, sender, block_number);
create index if not exists usdc_transfers_recipient on usdc_transfers (stream, recipient, block_number);

create table if not exists usdc_hourly (
  stream        smallint not null,
  hour          timestamptz not null check (date_trunc('hour', hour, 'UTC') = hour),
  transfers     bigint not null default 0,
  transfer_raw  numeric(78,0) not null default 0,
  mints         bigint not null default 0,
  mint_raw      numeric(78,0) not null default 0,
  burns         bigint not null default 0,
  burn_raw      numeric(78,0) not null default 0,
  zero_value    bigint not null default 0,
  first_block   bigint not null,
  last_block    bigint not null,
  top           jsonb not null default '[]'::jsonb,       -- [[amount_raw, block, log_index, tx, from, to, kind], ...] ≤ 10, amount desc
  senders_hll   bytea check (senders_hll is null or length(senders_hll) = 4096),
  receivers_hll bytea check (receivers_hll is null or length(receivers_hll) = 4096),
  primary key (stream, hour)
);

create table if not exists usdc_daily (
  stream        smallint not null,
  day           date not null,
  transfers     bigint not null default 0,
  transfer_raw  numeric(78,0) not null default 0,
  mints         bigint not null default 0,
  mint_raw      numeric(78,0) not null default 0,
  burns         bigint not null default 0,
  burn_raw      numeric(78,0) not null default 0,
  zero_value    bigint not null default 0,
  first_block   bigint not null,
  last_block    bigint not null,
  top           jsonb not null default '[]'::jsonb,
  senders_hll   bytea check (senders_hll is null or length(senders_hll) = 16384),
  receivers_hll bytea check (receivers_hll is null or length(receivers_hll) = 16384),
  primary key (stream, day)
);

create table if not exists usdc_totals (
  stream        smallint primary key,
  events        bigint not null default 0,
  transfers     bigint not null default 0,
  transfer_raw  numeric(78,0) not null default 0,
  mints         bigint not null default 0,
  mint_raw      numeric(78,0) not null default 0,
  burns         bigint not null default 0,
  burn_raw      numeric(78,0) not null default 0,
  zero_value    bigint not null default 0,
  tx_count      bigint not null default 0,
  senders_hll   bytea check (senders_hll is null or length(senders_hll) = 16384),
  receivers_hll bytea check (receivers_hll is null or length(receivers_hll) = 16384),
  updated_at    timestamptz not null default now()
);

create table if not exists usdc_ranges (
  stream        smallint not null,
  from_block    bigint not null,
  to_block      bigint not null check (to_block >= from_block),
  to_hash       bytea,
  kind          text not null check (kind in ('live', 'backfill')),
  events        integer not null check (events >= 0),
  tx_count      integer not null check (tx_count >= 0),
  raw_stored    boolean not null,
  digest        bytea not null check (length(digest) = 32),
  providers     jsonb not null default '{}'::jsonb,
  committed_at  timestamptz not null default now(),
  primary key (stream, from_block)
);
create unique index if not exists usdc_ranges_to on usdc_ranges (stream, to_block);

create table if not exists usdc_backfill_units (
  stream        smallint not null,
  from_block    bigint not null,
  to_block      bigint not null check (to_block >= from_block),
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  last_error    text,
  primary key (stream, from_block)
);
create index if not exists usdc_backfill_units_open on usdc_backfill_units (stream, status, from_block) where status <> 'done';

create table if not exists usdc_index_issues (
  id          bigserial primary key,
  stream      smallint not null,
  kind        text not null,
  block       bigint,
  detail      text not null,
  created_at  timestamptz not null default now()
);

alter table usdc_index_streams enable row level security;
alter table usdc_index_state enable row level security;
alter table usdc_transfers enable row level security;
alter table usdc_hourly enable row level security;
alter table usdc_daily enable row level security;
alter table usdc_totals enable row level security;
alter table usdc_ranges enable row level security;
alter table usdc_backfill_units enable row level security;
alter table usdc_index_issues enable row level security;

-- Register-wise max of two HyperLogLog sketches of equal size (the sketch of the union).
create or replace function usdc_hll_merge(a bytea, b bytea)
returns bytea
language plpgsql immutable
set search_path = public, pg_catalog
as $$
begin
  if a is null then return b; end if;
  if b is null then return a; end if;
  if length(a) <> length(b) then raise exception 'hll sketch sizes differ: % vs %', length(a), length(b); end if;
  return (select decode(string_agg(lpad(to_hex(greatest(get_byte(a, i), get_byte(b, i))), 2, '0'), '' order by i), 'hex')
            from generate_series(0, length(a) - 1) i);
end $$;

-- Top-10 by amount of two top lists.
create or replace function usdc_top_merge(a jsonb, b jsonb)
returns jsonb
language sql immutable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(x order by (x->>0)::numeric desc, (x->>1)::bigint, (x->>2)::int), '[]'::jsonb)
    from (select x from jsonb_array_elements(coalesce(a, '[]'::jsonb) || coalesce(b, '[]'::jsonb)) x
           order by (x->>0)::numeric desc, (x->>1)::bigint, (x->>2)::int limit 10) t
$$;

create or replace function usdc_index_issue(p_stream smallint, p_kind text, p_block bigint, p_detail text)
returns void
language sql
set search_path = public, pg_catalog
as $$ insert into usdc_index_issues (stream, kind, block, detail) values (p_stream, p_kind, p_block, left(p_detail, 500)) $$;

-- First run: pin the live cursor at a finalized block and plan the history
-- before it as claimable units. Returns false if already anchored.
create or replace function usdc_index_anchor(p_stream smallint, p_block bigint, p_hash text, p_time timestamptz, p_unit integer)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare s usdc_index_streams%rowtype; f bigint;
begin
  select * into s from usdc_index_streams where stream = p_stream;
  if not found then raise exception 'unknown stream %', p_stream; end if;
  if p_block < s.deploy_block then raise exception 'anchor % precedes deployment %', p_block, s.deploy_block; end if;
  insert into usdc_index_state (stream, live_from_block, live_from_time, cursor_block, cursor_hash, cursor_time, backfill_through)
  values (p_stream, p_block + 1, p_time, p_block, decode(substr(p_hash, 3), 'hex'), p_time, s.deploy_block - 1)
  on conflict (stream) do nothing;
  if not found then return false; end if;
  f := s.deploy_block;
  while f <= p_block loop
    insert into usdc_backfill_units (stream, from_block, to_block) values (p_stream, f, least(p_block, f + p_unit - 1)) on conflict do nothing;
    f := f + p_unit;
  end loop;
  insert into usdc_totals (stream) values (p_stream) on conflict do nothing;
  return true;
end $$;

-- Claim the lowest open backfill unit (lease: a claim older than p_lease returns to the pool).
create or replace function usdc_backfill_claim(p_stream smallint, p_lease interval)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare u usdc_backfill_units%rowtype;
begin
  select * into u from usdc_backfill_units
   where stream = p_stream and (status = 'pending' or (status = 'claimed' and claimed_at < now() - p_lease) or (status = 'failed' and attempts < 20))
   order by from_block
   for update skip locked
   limit 1;
  if not found then return null; end if;
  update usdc_backfill_units set status = 'claimed', claimed_at = now(), attempts = attempts + 1 where stream = p_stream and from_block = u.from_block;
  return jsonb_build_object('from', u.from_block, 'to', u.to_block, 'attempt', u.attempts + 1);
end $$;

create or replace function usdc_backfill_fail(p_stream smallint, p_from bigint, p_error text)
returns void
language sql
set search_path = public, pg_catalog
as $$ update usdc_backfill_units set status = 'failed', last_error = left(p_error, 300) where stream = p_stream and from_block = p_from and status <> 'done' $$;

-- Atomic commit of one block range: events (if within retention), hourly and
-- daily aggregates, totals, the audit row, and either the live cursor
-- (compare-and-set + parent hash) or the backfill unit. All or nothing.
--   p_events: [[block, log_index, tx_index, "tx hex", "from hex", "to hex", "amount", kind, unix_time], ...]
--   p_hours / p_days: [{bucket, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, zero_value,
--                       first_block, last_block, top, senders_hll, receivers_hll}]  (sketches hex or null)
--   p_totals: {events, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, zero_value, tx_count,
--              senders_hll, receivers_hll}
create or replace function usdc_index_commit(p_stream smallint, p_kind text, p_from bigint, p_to bigint,
  p_expected bigint, p_parent_hash text, p_to_hash text, p_to_time timestamptz,
  p_events jsonb, p_hours jsonb, p_days jsonb, p_totals jsonb, p_digest text, p_providers jsonb, p_raw_stored boolean)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  st usdc_index_state%rowtype;
  u usdc_backfill_units%rowtype;
  h jsonb;
  n_in integer := jsonb_array_length(coalesce(p_events, '[]'::jsonb));
  n_ins integer;
  v_events bigint := (p_totals->>'events')::bigint;
  chk record;
  nxt bigint;
begin
  if p_kind not in ('live', 'backfill') then raise exception 'bad kind %', p_kind; end if;
  -- One committer at a time per stream: aggregate rows are read-modify-write.
  perform pg_advisory_xact_lock(hashtext('usdc_index'), p_stream);
  select * into st from usdc_index_state where stream = p_stream for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_anchored'); end if;

  if p_kind = 'live' then
    if st.cursor_block is distinct from p_expected then
      return jsonb_build_object('ok', false, 'reason', 'stale_cursor', 'cursor', st.cursor_block);
    end if;
    if p_from <> st.cursor_block + 1 or p_to < p_from then
      perform usdc_index_issue(p_stream, 'block_gap', p_from, format('range %s..%s does not continue cursor %s', p_from, p_to, st.cursor_block));
      return jsonb_build_object('ok', false, 'reason', 'block_gap');
    end if;
    if decode(substr(p_parent_hash, 3), 'hex') is distinct from st.cursor_hash then
      perform usdc_index_issue(p_stream, 'reorg_inconsistency', st.cursor_block, format('finalized block %s now has parent hash %s', st.cursor_block, left(p_parent_hash, 18)));
      return jsonb_build_object('ok', false, 'reason', 'parent_hash_mismatch');
    end if;
  else
    select * into u from usdc_backfill_units where stream = p_stream and from_block = p_from for update;
    if not found or u.to_block <> p_to then return jsonb_build_object('ok', false, 'reason', 'unknown_unit'); end if;
    if u.status = 'done' then return jsonb_build_object('ok', false, 'reason', 'already_committed'); end if;
    if p_to >= st.live_from_block then return jsonb_build_object('ok', false, 'reason', 'overlaps_live'); end if;
  end if;

  -- The range's totals must equal its events (when stored) and its hours and days.
  select coalesce(sum((x->>'transfers')::bigint + (x->>'mints')::bigint + (x->>'burns')::bigint), 0) n,
         coalesce(sum((x->>'transfer_raw')::numeric), 0) tr, coalesce(sum((x->>'mint_raw')::numeric), 0) mr, coalesce(sum((x->>'burn_raw')::numeric), 0) br
    into chk from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) x;
  if chk.n <> v_events or chk.tr <> (p_totals->>'transfer_raw')::numeric or chk.mr <> (p_totals->>'mint_raw')::numeric or chk.br <> (p_totals->>'burn_raw')::numeric then
    perform usdc_index_issue(p_stream, 'aggregate_mismatch', p_to, format('hours %s/%s vs totals %s', chk.n, chk.tr, p_totals));
    raise exception 'usdc_index_commit: hourly aggregates do not equal range totals';
  end if;
  select coalesce(sum((x->>'transfers')::bigint + (x->>'mints')::bigint + (x->>'burns')::bigint), 0) n into chk from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) x;
  if chk.n <> v_events then raise exception 'usdc_index_commit: daily aggregates do not equal range totals'; end if;
  if p_raw_stored and n_in <> v_events then raise exception 'usdc_index_commit: % events supplied, totals say %', n_in, v_events; end if;

  if p_raw_stored and n_in > 0 then
    insert into usdc_transfers (stream, block_number, log_index, block_time, tx_index, tx_hash, sender, recipient, amount_raw, kind)
    select p_stream, (e->>0)::bigint, (e->>1)::int, to_timestamp((e->>8)::bigint), (e->>2)::int,
           decode(e->>3, 'hex'), decode(e->>4, 'hex'), decode(e->>5, 'hex'), (e->>6)::bigint, (e->>7)::smallint
      from jsonb_array_elements(p_events) e
     where (e->>0)::bigint between p_from and p_to
    on conflict do nothing;
    get diagnostics n_ins = row_count;
    if n_ins <> n_in then raise exception 'usdc_index_commit: % of % events inserted (duplicate or out-of-range rows)', n_ins, n_in; end if;
  end if;

  for h in select * from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) loop
    insert into usdc_hourly as t (stream, hour, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, zero_value, first_block, last_block, top, senders_hll, receivers_hll)
    values (p_stream, (h->>'bucket')::timestamptz, (h->>'transfers')::bigint, (h->>'transfer_raw')::numeric, (h->>'mints')::bigint, (h->>'mint_raw')::numeric,
            (h->>'burns')::bigint, (h->>'burn_raw')::numeric, (h->>'zero_value')::bigint, (h->>'first_block')::bigint, (h->>'last_block')::bigint,
            coalesce(h->'top', '[]'::jsonb), decode(nullif(h->>'senders_hll', ''), 'hex'), decode(nullif(h->>'receivers_hll', ''), 'hex'))
    on conflict (stream, hour) do update set
      transfers = t.transfers + excluded.transfers, transfer_raw = t.transfer_raw + excluded.transfer_raw,
      mints = t.mints + excluded.mints, mint_raw = t.mint_raw + excluded.mint_raw,
      burns = t.burns + excluded.burns, burn_raw = t.burn_raw + excluded.burn_raw,
      zero_value = t.zero_value + excluded.zero_value,
      first_block = least(t.first_block, excluded.first_block), last_block = greatest(t.last_block, excluded.last_block),
      top = usdc_top_merge(t.top, excluded.top),
      senders_hll = usdc_hll_merge(t.senders_hll, excluded.senders_hll),
      receivers_hll = usdc_hll_merge(t.receivers_hll, excluded.receivers_hll);
  end loop;
  for h in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    insert into usdc_daily as t (stream, day, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, zero_value, first_block, last_block, top, senders_hll, receivers_hll)
    values (p_stream, (h->>'bucket')::date, (h->>'transfers')::bigint, (h->>'transfer_raw')::numeric, (h->>'mints')::bigint, (h->>'mint_raw')::numeric,
            (h->>'burns')::bigint, (h->>'burn_raw')::numeric, (h->>'zero_value')::bigint, (h->>'first_block')::bigint, (h->>'last_block')::bigint,
            coalesce(h->'top', '[]'::jsonb), decode(nullif(h->>'senders_hll', ''), 'hex'), decode(nullif(h->>'receivers_hll', ''), 'hex'))
    on conflict (stream, day) do update set
      transfers = t.transfers + excluded.transfers, transfer_raw = t.transfer_raw + excluded.transfer_raw,
      mints = t.mints + excluded.mints, mint_raw = t.mint_raw + excluded.mint_raw,
      burns = t.burns + excluded.burns, burn_raw = t.burn_raw + excluded.burn_raw,
      zero_value = t.zero_value + excluded.zero_value,
      first_block = least(t.first_block, excluded.first_block), last_block = greatest(t.last_block, excluded.last_block),
      top = usdc_top_merge(t.top, excluded.top),
      senders_hll = usdc_hll_merge(t.senders_hll, excluded.senders_hll),
      receivers_hll = usdc_hll_merge(t.receivers_hll, excluded.receivers_hll);
  end loop;

  update usdc_totals set
    events = events + v_events,
    transfers = transfers + (p_totals->>'transfers')::bigint, transfer_raw = transfer_raw + (p_totals->>'transfer_raw')::numeric,
    mints = mints + (p_totals->>'mints')::bigint, mint_raw = mint_raw + (p_totals->>'mint_raw')::numeric,
    burns = burns + (p_totals->>'burns')::bigint, burn_raw = burn_raw + (p_totals->>'burn_raw')::numeric,
    zero_value = zero_value + (p_totals->>'zero_value')::bigint, tx_count = tx_count + (p_totals->>'tx_count')::bigint,
    senders_hll = usdc_hll_merge(senders_hll, decode(nullif(p_totals->>'senders_hll', ''), 'hex')),
    receivers_hll = usdc_hll_merge(receivers_hll, decode(nullif(p_totals->>'receivers_hll', ''), 'hex')),
    updated_at = now()
   where stream = p_stream;

  insert into usdc_ranges (stream, from_block, to_block, to_hash, kind, events, tx_count, raw_stored, digest, providers)
  values (p_stream, p_from, p_to, decode(nullif(substr(coalesce(p_to_hash, ''), 3), ''), 'hex'), p_kind, v_events, (p_totals->>'tx_count')::int,
          p_raw_stored, decode(p_digest, 'hex'), coalesce(p_providers, '{}'::jsonb));

  if p_kind = 'live' then
    update usdc_index_state set cursor_block = p_to, cursor_hash = decode(substr(p_to_hash, 3), 'hex'), cursor_time = p_to_time,
      last_success = now(), last_error = null, updated_at = now()
     where stream = p_stream;
  else
    update usdc_backfill_units set status = 'done', last_error = null where stream = p_stream and from_block = p_from;
    -- Advance the contiguous history pointer over every finished unit.
    nxt := st.backfill_through;
    loop
      select to_block into u.to_block from usdc_backfill_units where stream = p_stream and from_block = nxt + 1 and status = 'done';
      exit when not found;
      nxt := u.to_block;
    end loop;
    update usdc_index_state set backfill_through = nxt, updated_at = now() where stream = p_stream;
  end if;
  return jsonb_build_object('ok', true, 'events', v_events);
end $$;

-- Heads, supply, state, provider health and the materialised dashboard windows.
create or replace function usdc_index_touch(p_stream smallint, p_state text, p_head bigint, p_head_time timestamptz,
  p_finalized bigint, p_finalized_time timestamptz, p_supply numeric, p_supply_block bigint, p_windows jsonb,
  p_rpc jsonb, p_error text)
returns void
language sql
set search_path = public, pg_catalog
as $$
  update usdc_index_state set
    state = coalesce(p_state, state),
    head_block = coalesce(p_head, head_block), head_time = coalesce(p_head_time, head_time),
    finalized_block = greatest(coalesce(p_finalized, finalized_block), finalized_block),
    finalized_time = coalesce(p_finalized_time, finalized_time),
    supply_raw = coalesce(p_supply, supply_raw), supply_block = coalesce(p_supply_block, supply_block),
    windows = coalesce(p_windows, windows), windows_at = case when p_windows is null then windows_at else now() end,
    rpc = coalesce(p_rpc, rpc),
    last_error = p_error,
    updated_at = now()
  where stream = p_stream
$$;

-- Rolling retention: raw events and hourly sketches older than the window go;
-- counts, sums, top lists, daily sketches and the audit rows stay.
create or replace function usdc_index_prune(p_stream smallint, p_before timestamptz, p_limit integer)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare n_ev integer; n_h integer; cut bigint;
begin
  select max(last_block) into cut from usdc_hourly where stream = p_stream and hour < date_trunc('hour', p_before, 'UTC');
  if cut is null then return jsonb_build_object('events', 0, 'hour_sketches', 0); end if;
  delete from usdc_transfers t using (
    select block_number, log_index from usdc_transfers where stream = p_stream and block_number <= cut order by block_number limit p_limit
  ) d where t.stream = p_stream and t.block_number = d.block_number and t.log_index = d.log_index;
  get diagnostics n_ev = row_count;
  update usdc_hourly set senders_hll = null, receivers_hll = null
   where stream = p_stream and hour < date_trunc('hour', p_before, 'UTC') and senders_hll is not null;
  get diagnostics n_h = row_count;
  return jsonb_build_object('events', n_ev, 'hour_sketches', n_h, 'through_block', cut);
end $$;

-- Exact 1-hour (or shorter) window straight from the retained events.
create or replace function usdc_window_exact(p_stream smallint, p_since timestamptz, p_until timestamptz)
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with b as (select coalesce(min(first_block), 0) lo from usdc_hourly where stream = p_stream and hour >= date_trunc('hour', p_since, 'UTC')),
  e as (select t.* from usdc_transfers t, b where t.stream = p_stream and t.block_number >= b.lo and t.block_time > p_since and t.block_time <= p_until)
  select jsonb_build_object(
    'events', count(*),
    'transfers', count(*) filter (where kind = 0), 'transfer_raw', coalesce(sum(amount_raw) filter (where kind = 0), 0)::text,
    'mints', count(*) filter (where kind = 1), 'mint_raw', coalesce(sum(amount_raw) filter (where kind = 1), 0)::text,
    'burns', count(*) filter (where kind = 2), 'burn_raw', coalesce(sum(amount_raw) filter (where kind = 2), 0)::text,
    'tx_count', count(distinct tx_hash),
    'senders', count(distinct sender) filter (where kind <> 1), 'receivers', count(distinct recipient) filter (where kind <> 2),
    'first_block', min(block_number), 'last_block', max(block_number))
  from e
$$;

-- Live feed / largest within a short window, from retained events only.
create or replace function usdc_recent(p_stream smallint, p_since timestamptz, p_sort text, p_limit integer)
returns table (block_number bigint, log_index integer, block_time timestamptz, tx_hash text, sender text, recipient text, amount_raw text, kind smallint)
language sql stable
set search_path = public, pg_catalog
as $$
  with b as (select coalesce(min(first_block), 0) lo from usdc_hourly where stream = p_stream and hour >= date_trunc('hour', p_since, 'UTC'))
  select t.block_number, t.log_index, t.block_time, '0x' || encode(t.tx_hash, 'hex'), '0x' || encode(t.sender, 'hex'), '0x' || encode(t.recipient, 'hex'), t.amount_raw::text, t.kind
    from usdc_transfers t, b
   where t.stream = p_stream and t.block_number >= b.lo and t.block_time > p_since
   order by case when p_sort = 'largest' then t.amount_raw end desc nulls last, t.block_number desc, t.log_index desc
   limit least(greatest(p_limit, 1), 100)
$$;

-- Address activity within retention (both directions), newest first.
create or replace function usdc_address(p_stream smallint, p_address text, p_limit integer)
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with a as (select decode(substr(p_address, 3), 'hex') x),
  e as (
    (select t.*, 'out' dir from usdc_transfers t, a where t.stream = p_stream and t.sender = a.x)
    union all
    (select t.*, 'in' dir from usdc_transfers t, a where t.stream = p_stream and t.recipient = a.x and t.sender <> a.x)
  )
  select jsonb_build_object(
    'in_count', count(*) filter (where dir = 'in'), 'in_raw', coalesce(sum(amount_raw) filter (where dir = 'in'), 0)::text,
    'out_count', count(*) filter (where dir = 'out'), 'out_raw', coalesce(sum(amount_raw) filter (where dir = 'out'), 0)::text,
    'first_block', min(block_number), 'last_block', max(block_number),
    'recent', coalesce((select jsonb_agg(r) from (
        select block_number, log_index, block_time, '0x' || encode(tx_hash, 'hex') tx, '0x' || encode(sender, 'hex') "from",
               '0x' || encode(recipient, 'hex') "to", amount_raw::text amount_raw, kind, dir
          from e order by block_number desc, log_index desc limit least(greatest(p_limit, 1), 100)) r), '[]'::jsonb))
  from e
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'usdc_hll_merge(bytea, bytea)',
    'usdc_top_merge(jsonb, jsonb)',
    'usdc_index_issue(smallint, text, bigint, text)',
    'usdc_index_anchor(smallint, bigint, text, timestamptz, integer)',
    'usdc_backfill_claim(smallint, interval)',
    'usdc_backfill_fail(smallint, bigint, text)',
    'usdc_index_commit(smallint, text, bigint, bigint, bigint, text, text, timestamptz, jsonb, jsonb, jsonb, jsonb, text, jsonb, boolean)',
    'usdc_index_touch(smallint, text, bigint, timestamptz, bigint, timestamptz, numeric, bigint, jsonb, jsonb, text)',
    'usdc_index_prune(smallint, timestamptz, integer)',
    'usdc_window_exact(smallint, timestamptz, timestamptz)',
    'usdc_recent(smallint, timestamptz, text, integer)',
    'usdc_address(smallint, text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- The audit trail is append-only.
create or replace function usdc_ranges_immutable() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin raise exception 'usdc_ranges is append-only'; end $$;
drop trigger if exists usdc_ranges_immutable on usdc_ranges;
create trigger usdc_ranges_immutable before update or delete on usdc_ranges
  for each row execute function usdc_ranges_immutable();
