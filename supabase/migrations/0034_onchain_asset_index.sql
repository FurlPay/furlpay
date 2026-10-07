-- ---------------------------------------------------------------------------
-- 0034 — Network-wide asset index (USDC first), tracked wallets, indexer
-- health and integrity issues. Depends on 0032 (onchain_* tables).
--
-- WHAT IS STORED
--   onchain_asset_cursors        per (chain, asset): newest FINALIZED block whose
--                                every Transfer log is aggregated; its hash and
--                                the asset's supply there.
--   onchain_asset_commits        one row per committed block range: exact totals
--                                and the supply at its last block (provenance:
--                                provider, committed_at). Contiguous by
--                                construction: from_block = previous to_block + 1.
--   onchain_asset_minutes        per-minute aggregates (UTC, by block time).
--   onchain_supply_snapshots     exact supply at a block/slot (EVM commits and
--                                Solana getTokenSupply).
--   onchain_integrity_issues     detected problems, deduplicated, never deleted.
--   onchain_indexer_status       per (indexer, chain, asset) heads/lag/errors.
--   onchain_tracked_wallets /    operator-managed, chain-agnostic wallets: one
--   onchain_tracked_addresses    wallet, any number of (chain, address).
--   onchain_solana_token_accounts token accounts ever seen for a tracked owner,
--                                so a since-closed account is still scanned.
--   onchain_wallet_balances      latest token-account balance per (chain, account).
--
-- FINALIZED ONLY: the asset index never aggregates an unfinalized block, so a
-- reorg cannot have to be subtracted later. The unfinalized tip is served live
-- from the node (lib/onchain/usdcNetwork.ts), not stored.
--
-- WHY NO UNIQUE-ADDRESS HISTORY: distinct counts do not add across buckets;
-- storing every address per bucket is unbounded. Unique senders/recipients are
-- exact for the live window only, and the API says so.
--
-- ACCESS: service_role only (RLS on, no policies), like 0032.
-- IDEMPOTENT: if not exists / create or replace / on conflict throughout.
-- ---------------------------------------------------------------------------

create table if not exists onchain_asset_cursors (
  chain            text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  asset            text not null check (asset ~ '^[a-z0-9._-]{2,32}$'),
  contract         text not null,
  chain_id         bigint not null check (chain_id > 0),
  started_block    bigint not null check (started_block >= 0),
  last_block       bigint not null check (last_block >= started_block),
  last_block_hash  text not null,
  last_block_time  timestamptz not null,
  last_supply_raw  numeric(78,0) check (last_supply_raw >= 0),
  updated_at       timestamptz not null default now(),
  primary key (chain, asset)
);

create table if not exists onchain_asset_commits (
  chain         text not null,
  asset         text not null,
  from_block    bigint not null,
  to_block      bigint not null check (to_block >= from_block),
  to_hash       text not null,
  to_time       timestamptz not null,
  transfers     bigint not null check (transfers >= 0),
  transfer_raw  numeric(78,0) not null check (transfer_raw >= 0),
  mints         bigint not null check (mints >= 0),
  mint_raw      numeric(78,0) not null check (mint_raw >= 0),
  burns         bigint not null check (burns >= 0),
  burn_raw      numeric(78,0) not null check (burn_raw >= 0),
  supply_raw    numeric(78,0) check (supply_raw >= 0),
  -- prev supply + mint - burn = supply? null when there is no previous supply.
  reconciled    boolean,
  provider      text not null,
  duration_ms   integer,
  committed_at  timestamptz not null default now(),
  primary key (chain, asset, from_block)
);
create unique index if not exists onchain_asset_commits_to on onchain_asset_commits (chain, asset, to_block);
create index if not exists onchain_asset_commits_time on onchain_asset_commits (asset, to_time desc);

create table if not exists onchain_asset_minutes (
  chain         text not null,
  asset         text not null,
  bucket        timestamptz not null check (bucket = date_trunc('minute', bucket)),
  transfers     bigint not null default 0 check (transfers >= 0),
  transfer_raw  numeric(78,0) not null default 0 check (transfer_raw >= 0),
  mints         bigint not null default 0 check (mints >= 0),
  mint_raw      numeric(78,0) not null default 0 check (mint_raw >= 0),
  burns         bigint not null default 0 check (burns >= 0),
  burn_raw      numeric(78,0) not null default 0 check (burn_raw >= 0),
  first_block   bigint not null,
  last_block    bigint not null,
  primary key (chain, asset, bucket)
);
create index if not exists onchain_asset_minutes_asset_bucket on onchain_asset_minutes (asset, bucket);

create table if not exists onchain_supply_snapshots (
  chain        text not null,
  asset        text not null,
  block        bigint not null check (block >= 0),
  block_time   timestamptz not null,
  supply_raw   numeric(78,0) not null check (supply_raw >= 0),
  decimals     smallint not null check (decimals between 0 and 36),
  commitment   text not null check (commitment in ('finalized', 'confirmed')),
  provider     text not null,
  observed_at  timestamptz not null default now(),
  primary key (chain, asset, block)
);
create index if not exists onchain_supply_snapshots_time on onchain_supply_snapshots (asset, block_time);

create table if not exists onchain_integrity_issues (
  id           bigserial primary key,
  chain        text not null,
  asset        text not null default '',
  kind         text not null check (kind in (
                 'block_gap', 'checkpoint_regression', 'reorg_inconsistency', 'negative_supply',
                 'impossible_value', 'supply_mismatch', 'provider_disagreement', 'duplicate_event',
                 'indexer_lag', 'rpc_failure')),
  block        bigint,
  detail       text not null,
  occurrences  integer not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_at  timestamptz
);
-- One OPEN issue per (chain, asset, kind, block); repeats bump occurrences.
create unique index if not exists onchain_integrity_issues_open
  on onchain_integrity_issues (chain, asset, kind, coalesce(block, -1)) where resolved_at is null;

create table if not exists onchain_indexer_status (
  indexer          text not null check (indexer in ('asset', 'wallet')),
  chain            text not null,
  asset            text not null default '',
  head_block       bigint,
  head_time        timestamptz,
  finalized_block  bigint,
  indexed_block    bigint,
  indexed_time     timestamptz,
  last_ok_at       timestamptz,
  last_error_at    timestamptz,
  last_error       text,
  last_duration_ms integer,
  detail           jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  primary key (indexer, chain, asset)
);

create table if not exists onchain_tracked_wallets (
  id          uuid primary key default gen_random_uuid(),
  label       text not null check (length(label) between 1 and 80),
  scope       text not null check (scope in ('treasury', 'watch')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists onchain_tracked_addresses (
  wallet_id   uuid not null references onchain_tracked_wallets (id) on delete cascade,
  chain       text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  -- EVM stored lowercased; Solana base58 (case-sensitive) as-is.
  address     text not null check (address ~ '^0x[0-9a-f]{40}$' or address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at  timestamptz not null default now(),
  primary key (chain, address)
);
create index if not exists onchain_tracked_addresses_wallet on onchain_tracked_addresses (wallet_id);

create table if not exists onchain_solana_token_accounts (
  account        text primary key check (account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  owner          text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  mint           text not null,
  program        text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  -- Set when the owner's token-account list stopped returning it (closed or
  -- transferred). Still scanned for 7 days so its last transfers are not lost.
  gone_at        timestamptz
);
create index if not exists onchain_solana_token_accounts_owner on onchain_solana_token_accounts (owner);

create table if not exists onchain_wallet_balances (
  chain        text not null,
  account      text not null,
  owner        text not null,
  asset        text not null,
  amount_raw   numeric(78,0) not null check (amount_raw >= 0),
  decimals     smallint not null,
  at_block     bigint not null,
  observed_at  timestamptz not null default now(),
  primary key (chain, account)
);

-- ── Functions ───────────────────────────────────────────────────────────────

create or replace function onchain_record_issue(p_chain text, p_asset text, p_kind text, p_block bigint, p_detail text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  insert into onchain_integrity_issues (chain, asset, kind, block, detail)
  values (p_chain, coalesce(p_asset, ''), p_kind, p_block, left(p_detail, 500))
  on conflict (chain, asset, kind, coalesce(block, -1)) where resolved_at is null
  do update set occurrences = onchain_integrity_issues.occurrences + 1, last_seen = now(), detail = excluded.detail;
end $$;

-- First anchor: no history is implied; the cursor starts at a finalized block.
create or replace function onchain_asset_anchor(p_chain text, p_asset text, p_contract text, p_chain_id bigint,
  p_block bigint, p_hash text, p_time timestamptz, p_supply_raw numeric, p_decimals smallint, p_provider text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_supply_raw is not null and p_supply_raw < 0 then
    perform onchain_record_issue(p_chain, p_asset, 'negative_supply', p_block, format('anchor supply %s', p_supply_raw));
    return false;
  end if;
  insert into onchain_asset_cursors (chain, asset, contract, chain_id, started_block, last_block, last_block_hash, last_block_time, last_supply_raw)
  values (p_chain, p_asset, lower(p_contract), p_chain_id, p_block, p_block, p_hash, p_time, p_supply_raw)
  on conflict (chain, asset) do nothing;
  if not found then return false; end if;
  if p_supply_raw is not null then
    insert into onchain_supply_snapshots (chain, asset, block, block_time, supply_raw, decimals, commitment, provider)
    values (p_chain, p_asset, p_block, p_time, p_supply_raw, p_decimals, 'finalized', p_provider)
    on conflict do nothing;
  end if;
  return true;
end $$;

-- Atomic commit of one contiguous finalized range. Compare-and-set on the
-- cursor guarantees a block range is aggregated exactly once even with
-- concurrent workers; contiguity and the parent hash guarantee no gap and no
-- silent fork. Supply is reconciled exactly: prev + minted - burned = supply.
-- Returns {ok, reason?, reconciled?}.
create or replace function onchain_asset_commit(p_chain text, p_asset text, p_chain_id bigint, p_expected bigint,
  p_from bigint, p_to bigint, p_parent_hash text, p_to_hash text, p_to_time timestamptz,
  p_totals jsonb, p_buckets jsonb, p_supply_raw numeric, p_decimals smallint, p_provider text, p_duration_ms integer)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  cur onchain_asset_cursors%rowtype;
  b jsonb;
  v_transfers bigint := coalesce((p_totals->>'transfers')::bigint, -1);
  v_transfer_raw numeric := coalesce((p_totals->>'transfer_raw')::numeric, -1);
  v_mints bigint := coalesce((p_totals->>'mints')::bigint, -1);
  v_mint_raw numeric := coalesce((p_totals->>'mint_raw')::numeric, -1);
  v_burns bigint := coalesce((p_totals->>'burns')::bigint, -1);
  v_burn_raw numeric := coalesce((p_totals->>'burn_raw')::numeric, -1);
  v_reconciled boolean := null;
  v_expected numeric;
begin
  select * into cur from onchain_asset_cursors where chain = p_chain and asset = p_asset for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_cursor'); end if;
  if cur.chain_id <> p_chain_id then
    perform onchain_record_issue(p_chain, p_asset, 'provider_disagreement', p_to, format('endpoint answered chain id %s, cursor pinned to %s', p_chain_id, cur.chain_id));
    return jsonb_build_object('ok', false, 'reason', 'chain_id_mismatch');
  end if;
  -- Another worker committed first: benign, nothing written.
  if cur.last_block is distinct from p_expected then
    if p_expected > cur.last_block then
      perform onchain_record_issue(p_chain, p_asset, 'checkpoint_regression', p_expected, format('worker expected cursor %s but it is %s', p_expected, cur.last_block));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'stale_cursor', 'cursor', cur.last_block);
  end if;
  if p_from <> cur.last_block + 1 or p_to < p_from then
    perform onchain_record_issue(p_chain, p_asset, 'block_gap', p_from, format('range %s..%s does not continue cursor %s', p_from, p_to, cur.last_block));
    return jsonb_build_object('ok', false, 'reason', 'block_gap');
  end if;
  if p_parent_hash is distinct from cur.last_block_hash then
    perform onchain_record_issue(p_chain, p_asset, 'reorg_inconsistency', cur.last_block,
      format('finalized block %s now has hash %s; cursor recorded %s', cur.last_block, left(coalesce(p_parent_hash, 'null'), 18), left(cur.last_block_hash, 18)));
    return jsonb_build_object('ok', false, 'reason', 'parent_hash_mismatch');
  end if;
  if v_transfers < 0 or v_transfer_raw < 0 or v_mints < 0 or v_mint_raw < 0 or v_burns < 0 or v_burn_raw < 0
     or (v_mints = 0 and v_mint_raw <> 0) or (v_burns = 0 and v_burn_raw <> 0) then
    perform onchain_record_issue(p_chain, p_asset, 'impossible_value', p_to, format('totals %s', p_totals));
    return jsonb_build_object('ok', false, 'reason', 'impossible_value');
  end if;
  if p_supply_raw is not null and p_supply_raw < 0 then
    perform onchain_record_issue(p_chain, p_asset, 'negative_supply', p_to, format('supply %s', p_supply_raw));
    return jsonb_build_object('ok', false, 'reason', 'negative_supply');
  end if;

  -- Exact reconciliation: supply only moves by mint and burn.
  if p_supply_raw is not null and cur.last_supply_raw is not null then
    v_expected := cur.last_supply_raw + v_mint_raw - v_burn_raw;
    v_reconciled := (v_expected = p_supply_raw);
    if not v_reconciled then
      perform onchain_record_issue(p_chain, p_asset, 'supply_mismatch', p_to,
        format('supply at %s is %s; block %s supply %s + minted %s - burned %s = %s', p_to, p_supply_raw, cur.last_block, cur.last_supply_raw, v_mint_raw, v_burn_raw, v_expected));
    end if;
  end if;

  for b in select * from jsonb_array_elements(coalesce(p_buckets, '[]'::jsonb)) loop
    insert into onchain_asset_minutes as m (chain, asset, bucket, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, first_block, last_block)
    values (p_chain, p_asset, (b->>'bucket')::timestamptz, (b->>'transfers')::bigint, (b->>'transfer_raw')::numeric,
            (b->>'mints')::bigint, (b->>'mint_raw')::numeric, (b->>'burns')::bigint, (b->>'burn_raw')::numeric,
            (b->>'first_block')::bigint, (b->>'last_block')::bigint)
    on conflict (chain, asset, bucket) do update set
      transfers = m.transfers + excluded.transfers, transfer_raw = m.transfer_raw + excluded.transfer_raw,
      mints = m.mints + excluded.mints, mint_raw = m.mint_raw + excluded.mint_raw,
      burns = m.burns + excluded.burns, burn_raw = m.burn_raw + excluded.burn_raw,
      first_block = least(m.first_block, excluded.first_block), last_block = greatest(m.last_block, excluded.last_block);
  end loop;

  insert into onchain_asset_commits (chain, asset, from_block, to_block, to_hash, to_time, transfers, transfer_raw, mints, mint_raw, burns, burn_raw, supply_raw, reconciled, provider, duration_ms)
  values (p_chain, p_asset, p_from, p_to, p_to_hash, p_to_time, v_transfers, v_transfer_raw, v_mints, v_mint_raw, v_burns, v_burn_raw, p_supply_raw, v_reconciled, p_provider, p_duration_ms);
  if p_supply_raw is not null then
    insert into onchain_supply_snapshots (chain, asset, block, block_time, supply_raw, decimals, commitment, provider)
    values (p_chain, p_asset, p_to, p_to_time, p_supply_raw, p_decimals, 'finalized', p_provider)
    on conflict do nothing;
  end if;
  update onchain_asset_cursors set last_block = p_to, last_block_hash = p_to_hash, last_block_time = p_to_time,
    last_supply_raw = coalesce(p_supply_raw, last_supply_raw), updated_at = now()
   where chain = p_chain and asset = p_asset;
  return jsonb_build_object('ok', true, 'reconciled', v_reconciled);
end $$;

-- Server-side series: minute rows rolled up to hour/day; never raw events.
create or replace function onchain_asset_series(p_asset text, p_from timestamptz, p_to timestamptz, p_bucket text)
returns table (bucket timestamptz, chain text, transfers bigint, transfer_raw numeric, mints bigint, mint_raw numeric, burns bigint, burn_raw numeric)
language sql
stable
set search_path = public, pg_catalog
as $$
  select date_trunc(case when p_bucket in ('minute', 'hour', 'day') then p_bucket else 'hour' end, m.bucket, 'UTC') as bucket, m.chain,
         sum(m.transfers)::bigint, sum(m.transfer_raw), sum(m.mints)::bigint, sum(m.mint_raw), sum(m.burns)::bigint, sum(m.burn_raw)
    from onchain_asset_minutes m
   where m.asset = p_asset and m.bucket >= p_from and m.bucket < p_to
   group by 1, 2
   order by 1, 2
$$;

-- Supply per chain at the end of each bucket (last snapshot in it).
create or replace function onchain_supply_series(p_asset text, p_from timestamptz, p_to timestamptz, p_bucket text)
returns table (bucket timestamptz, chain text, block bigint, supply_raw numeric, decimals smallint)
language sql
stable
set search_path = public, pg_catalog
as $$
  select distinct on (1, s.chain)
         date_trunc(case when p_bucket in ('minute', 'hour', 'day') then p_bucket else 'hour' end, s.block_time, 'UTC'), s.chain, s.block, s.supply_raw, s.decimals
    from onchain_supply_snapshots s
   where s.asset = p_asset and s.block_time >= p_from and s.block_time < p_to
   order by 1, s.chain, s.block desc
$$;

-- Audit: ranges that do not continue the previous one (should never exist).
create or replace function onchain_asset_gaps(p_asset text)
returns table (chain text, after_block bigint, next_from bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  select chain, prev_to, from_block from (
    select chain, from_block, lag(to_block) over (partition by chain order by from_block) as prev_to
      from onchain_asset_commits where asset = p_asset
  ) x where prev_to is not null and from_block <> prev_to + 1
$$;

create or replace function onchain_indexer_touch(p_indexer text, p_chain text, p_asset text, p_ok boolean,
  p_head bigint, p_head_time timestamptz, p_finalized bigint, p_indexed bigint, p_indexed_time timestamptz,
  p_error text, p_duration_ms integer, p_detail jsonb)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  insert into onchain_indexer_status as s (indexer, chain, asset, head_block, head_time, finalized_block, indexed_block, indexed_time,
    last_ok_at, last_error_at, last_error, last_duration_ms, detail, updated_at)
  values (p_indexer, p_chain, coalesce(p_asset, ''), p_head, p_head_time, p_finalized, p_indexed, p_indexed_time,
    case when p_ok then now() end, case when not p_ok then now() end, case when not p_ok then left(p_error, 300) end,
    p_duration_ms, coalesce(p_detail, '{}'::jsonb), now())
  on conflict (indexer, chain, asset) do update set
    head_block = coalesce(excluded.head_block, s.head_block), head_time = coalesce(excluded.head_time, s.head_time),
    finalized_block = coalesce(excluded.finalized_block, s.finalized_block),
    -- indexed position never moves backwards
    indexed_block = greatest(s.indexed_block, excluded.indexed_block),
    indexed_time = case when excluded.indexed_block >= coalesce(s.indexed_block, -1) then coalesce(excluded.indexed_time, s.indexed_time) else s.indexed_time end,
    last_ok_at = coalesce(excluded.last_ok_at, s.last_ok_at),
    last_error_at = coalesce(excluded.last_error_at, s.last_error_at),
    last_error = coalesce(excluded.last_error, s.last_error),
    last_duration_ms = coalesce(excluded.last_duration_ms, s.last_duration_ms),
    detail = s.detail || excluded.detail, updated_at = now();
end $$;

-- ── Access ──────────────────────────────────────────────────────────────────

-- One explicit statement per table (lib/__tests__/rlsCoverage.spec.ts reads them).
alter table onchain_asset_cursors enable row level security;
alter table onchain_asset_commits enable row level security;
alter table onchain_asset_minutes enable row level security;
alter table onchain_supply_snapshots enable row level security;
alter table onchain_integrity_issues enable row level security;
alter table onchain_indexer_status enable row level security;
alter table onchain_tracked_wallets enable row level security;
alter table onchain_tracked_addresses enable row level security;
alter table onchain_solana_token_accounts enable row level security;
alter table onchain_wallet_balances enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onchain_asset_cursors', 'onchain_asset_commits', 'onchain_asset_minutes', 'onchain_supply_snapshots',
                           'onchain_integrity_issues', 'onchain_indexer_status', 'onchain_tracked_wallets', 'onchain_tracked_addresses',
                           'onchain_solana_token_accounts', 'onchain_wallet_balances'] loop
    execute format('revoke all on table %I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table %I to service_role', t);
  end loop;
  grant usage, select on all sequences in schema public to service_role;
end $$;
grant delete on table onchain_tracked_addresses to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'onchain_record_issue(text, text, text, bigint, text)',
    'onchain_asset_anchor(text, text, text, bigint, bigint, text, timestamptz, numeric, smallint, text)',
    'onchain_asset_commit(text, text, bigint, bigint, bigint, bigint, text, text, timestamptz, jsonb, jsonb, numeric, smallint, text, integer)',
    'onchain_asset_series(text, timestamptz, timestamptz, text)',
    'onchain_supply_series(text, timestamptz, timestamptz, text)',
    'onchain_asset_gaps(text)',
    'onchain_indexer_touch(text, text, text, boolean, bigint, timestamptz, bigint, bigint, timestamptz, text, integer, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Append-only provenance: a committed range and a supply snapshot are never edited.
create or replace function onchain_asset_immutable() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin raise exception '% is append-only', tg_table_name; end $$;
drop trigger if exists onchain_asset_commits_immutable on onchain_asset_commits;
create trigger onchain_asset_commits_immutable before update or delete on onchain_asset_commits
  for each row execute function onchain_asset_immutable();
drop trigger if exists onchain_supply_snapshots_immutable on onchain_supply_snapshots;
create trigger onchain_supply_snapshots_immutable before update or delete on onchain_supply_snapshots
  for each row execute function onchain_asset_immutable();
