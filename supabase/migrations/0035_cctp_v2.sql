-- ---------------------------------------------------------------------------
-- 0035 — Circle CCTP V2 cross-chain USDC transfers. Depends on 0034
-- (onchain_asset_cursors, onchain_record_issue, onchain_asset_immutable).
--
-- MODEL
--   cctp_events             raw, append-only: every DepositForBurn and every
--                           (MintAndWithdraw + MessageReceived) pair read from a
--                           FINALIZED block. event_id = chain:block_hash:tx:log_index.
--   cctp_transfers          ONE cross-chain transfer. Identity: the CCTP message
--                           (cctp_version, source_domain, nonce). The source chain
--                           does not emit the nonce in V2 (verified on-chain), so a
--                           burn is first keyed by its source event and gains the
--                           nonce from Circle's attestation service (Iris).
--   cctp_transfer_evidence  append-only: every state change with the proof that
--                           caused it. Earlier evidence is never overwritten.
--
-- STATE (forward-only):  burn_confirmed -> attestation_pending ->
--   attestation_complete -> destination_verified -> finalized
--   plus terminal flags: mismatch (fields disagree; flagged, not hidden).
-- A transfer is NEVER marked destination_verified from Iris alone: it needs the
-- destination chain itself — a finalized MintAndWithdraw+MessageReceived that
-- FurlPay indexed, or usedNonces(nonce)=1 on the destination
-- MessageTransmitterV2 read at its 'finalized' block tag.
--
-- FEE SEMANTICS (verified): CCTP takes its fee out of the transfer, so
-- minted + mint fee = burned amount.
-- IDEMPOTENT: if not exists / create or replace / on conflict.
-- ---------------------------------------------------------------------------

create table if not exists cctp_events (
  event_id      text primary key check (length(event_id) between 20 and 300),
  chain         text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  chain_id      bigint not null,
  block_number  bigint not null,
  block_hash    text not null,
  block_time    timestamptz not null,
  tx_hash       text not null,
  log_index     integer not null,
  kind          text not null check (kind in ('deposit_for_burn', 'mint_received')),
  decoded       jsonb not null,
  observed_at   timestamptz not null default now()
);
create index if not exists cctp_events_tx on cctp_events (tx_hash);
create index if not exists cctp_events_chain_block on cctp_events (chain, block_number);

create table if not exists cctp_transfers (
  id                          bigserial primary key,
  cctp_version                smallint not null default 2,
  source_domain               integer not null check (source_domain >= 0),
  destination_domain          integer check (destination_domain >= 0),
  nonce                       text check (nonce ~ '^0x[0-9a-f]{64}$'),
  source_chain                text,
  destination_chain           text,
  -- source leg (null when only the destination was indexed)
  source_event_id             text unique references cctp_events (event_id),
  source_tx_hash              text,
  source_block_number         bigint,
  source_log_index            integer,
  source_block_time           timestamptz,
  burn_token                  text,
  depositor                   text,
  amount_raw                  numeric(78,0) check (amount_raw >= 0),
  mint_recipient              text,
  max_fee_raw                 numeric(78,0),
  min_finality_threshold      integer,
  -- attestation (Circle Iris)
  attestation_status          text,
  executed_fee_raw            numeric(78,0),
  finality_threshold_executed integer,
  attestation_attempts        integer not null default 0,
  attestation_next_at         timestamptz not null default now(),
  attestation_checked_at      timestamptz,
  -- destination leg
  destination_event_id        text unique references cctp_events (event_id),
  destination_tx_hash         text,
  destination_block_number    bigint,
  destination_log_index       integer,
  destination_block_time      timestamptz,
  minted_raw                  numeric(78,0),
  mint_fee_raw                numeric(78,0),
  destination_method          text check (destination_method in ('mint_event', 'used_nonce')),
  destination_checked_at      timestamptz,
  -- verification flags (each is a fact about what was independently checked)
  source_verified             boolean not null default false,
  message_verified            boolean not null default false,
  destination_verified        boolean not null default false,
  finality_verified           boolean not null default false,
  status                      text not null check (status in ('burn_confirmed', 'attestation_pending', 'attestation_complete', 'destination_verified', 'finalized', 'mismatch', 'merged')),
  status_reason               text,
  -- 'merged': an inbound-only row that turned out to be the destination leg of
  -- an indexed burn. Kept (with its evidence) and pointed at the survivor.
  merged_into                 bigint references cctp_transfers (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create unique index if not exists cctp_transfers_identity on cctp_transfers (cctp_version, source_domain, nonce) where nonce is not null;
create index if not exists cctp_transfers_source_tx on cctp_transfers (source_tx_hash);
create index if not exists cctp_transfers_dest_tx on cctp_transfers (destination_tx_hash);
create index if not exists cctp_transfers_status on cctp_transfers (status);
create index if not exists cctp_transfers_dest_status on cctp_transfers (destination_domain, status);
create index if not exists cctp_transfers_recipient on cctp_transfers (mint_recipient);
create index if not exists cctp_transfers_source_block on cctp_transfers (source_chain, source_block_number);
create index if not exists cctp_transfers_dest_block on cctp_transfers (destination_chain, destination_block_number);
create index if not exists cctp_transfers_attest_due on cctp_transfers (attestation_next_at) where status in ('burn_confirmed', 'attestation_pending');
create index if not exists cctp_transfers_dest_due on cctp_transfers (destination_checked_at) where status = 'attestation_complete';

create table if not exists cctp_transfer_evidence (
  id           bigserial primary key,
  transfer_id  bigint not null references cctp_transfers (id) on delete cascade,
  kind         text not null,
  detail       jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists cctp_transfer_evidence_transfer on cctp_transfer_evidence (transfer_id);

create or replace function cctp_status_rank(s text) returns integer
language sql immutable set search_path = public, pg_catalog as $$
  select case s when 'burn_confirmed' then 1 when 'attestation_pending' then 2 when 'attestation_complete' then 3
                when 'destination_verified' then 4 when 'finalized' then 5 else 0 end
$$;

-- Verify a destination leg against a known transfer and record it (internal).
create or replace function cctp_attach_destination(p_id bigint, p_event_id text, p_tx text, p_block bigint, p_log integer,
  p_time timestamptz, p_chain text, p_local_domain integer, p_minted numeric, p_fee numeric, p_recipient text, p_method text)
returns text
language plpgsql set search_path = public, pg_catalog as $$
declare t cctp_transfers%rowtype; v_problem text := null;
begin
  select * into t from cctp_transfers where id = p_id for update;
  if t.destination_domain is not null and p_local_domain is not null and t.destination_domain <> p_local_domain then
    v_problem := format('destination domain %s but mint observed on domain %s', t.destination_domain, p_local_domain);
  elsif t.amount_raw is not null and p_minted is not null and p_fee is not null and p_minted + p_fee <> t.amount_raw then
    v_problem := format('burned %s but minted %s + fee %s', t.amount_raw, p_minted, p_fee);
  elsif t.mint_recipient is not null and p_recipient is not null and lower(t.mint_recipient) <> lower(p_recipient) then
    v_problem := format('burn recipient %s but mint recipient %s', t.mint_recipient, p_recipient);
  end if;
  update cctp_transfers set
    destination_event_id = coalesce(p_event_id, destination_event_id), destination_tx_hash = coalesce(p_tx, destination_tx_hash),
    destination_block_number = coalesce(p_block, destination_block_number), destination_log_index = coalesce(p_log, destination_log_index),
    destination_block_time = coalesce(p_time, destination_block_time), destination_chain = coalesce(p_chain, destination_chain),
    minted_raw = coalesce(p_minted, minted_raw), mint_fee_raw = coalesce(p_fee, mint_fee_raw),
    mint_recipient = coalesce(mint_recipient, p_recipient),
    destination_method = p_method, destination_checked_at = now(),
    destination_verified = v_problem is null, finality_verified = v_problem is null,
    status = case when v_problem is not null then 'mismatch' else 'finalized' end,
    status_reason = v_problem, updated_at = now()
  where id = p_id;
  insert into cctp_transfer_evidence (transfer_id, kind, detail)
  values (p_id, case when v_problem is null then 'destination_verified' else 'destination_mismatch' end,
          jsonb_build_object('method', p_method, 'tx', p_tx, 'block', p_block, 'chain', p_chain, 'minted', p_minted, 'fee', p_fee, 'problem', v_problem));
  if v_problem is not null then
    perform onchain_record_issue(coalesce(p_chain, 'unknown'), 'cctp-v2', 'provider_disagreement', p_block, left('CCTP transfer ' || p_id || ': ' || v_problem, 500));
  end if;
  return coalesce(v_problem, 'ok');
end $$;

-- Atomic commit of one finalized block range of CCTP events for one chain.
-- Same guarantees as onchain_asset_commit: compare-and-set cursor (asset
-- 'cctp-v2'), contiguous ranges, unchanged parent hash. Burns create
-- transfers; mints attach to the matching transfer (by nonce) or create an
-- inbound-only transfer whose source leg FurlPay did not index.
create or replace function cctp_commit_range(p_chain text, p_chain_id bigint, p_local_domain integer, p_expected bigint,
  p_from bigint, p_to bigint, p_parent_hash text, p_to_hash text, p_to_time timestamptz, p_events jsonb)
returns jsonb
language plpgsql set search_path = public, pg_catalog as $$
declare cur onchain_asset_cursors%rowtype; e jsonb; d jsonb; v_id bigint; v_burns int := 0; v_mints int := 0; v_matched int := 0; v_dup int := 0;
begin
  select * into cur from onchain_asset_cursors where chain = p_chain and asset = 'cctp-v2' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_cursor'); end if;
  if cur.chain_id <> p_chain_id then return jsonb_build_object('ok', false, 'reason', 'chain_id_mismatch'); end if;
  if cur.last_block is distinct from p_expected then return jsonb_build_object('ok', false, 'reason', 'stale_cursor'); end if;
  if p_from <> cur.last_block + 1 or p_to < p_from then
    perform onchain_record_issue(p_chain, 'cctp-v2', 'block_gap', p_from, format('range %s..%s does not continue cursor %s', p_from, p_to, cur.last_block));
    return jsonb_build_object('ok', false, 'reason', 'block_gap');
  end if;
  if p_parent_hash is distinct from cur.last_block_hash then
    perform onchain_record_issue(p_chain, 'cctp-v2', 'reorg_inconsistency', cur.last_block, format('finalized block %s hash changed', cur.last_block));
    return jsonb_build_object('ok', false, 'reason', 'parent_hash_mismatch');
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    d := e->'decoded';
    insert into cctp_events (event_id, chain, chain_id, block_number, block_hash, block_time, tx_hash, log_index, kind, decoded)
    values (e->>'event_id', p_chain, p_chain_id, (e->>'block_number')::bigint, e->>'block_hash', (e->>'block_time')::timestamptz,
            e->>'tx_hash', (e->>'log_index')::int, e->>'kind', d)
    on conflict (event_id) do nothing;
    if not found then v_dup := v_dup + 1; continue; end if;

    if e->>'kind' = 'deposit_for_burn' then
      insert into cctp_transfers (source_domain, destination_domain, source_chain, destination_chain, source_event_id, source_tx_hash,
        source_block_number, source_log_index, source_block_time, burn_token, depositor, amount_raw, mint_recipient, max_fee_raw,
        min_finality_threshold, source_verified, status)
      values (p_local_domain, (d->>'destination_domain')::int, p_chain, d->>'destination_chain', e->>'event_id', e->>'tx_hash',
        (e->>'block_number')::bigint, (e->>'log_index')::int, (e->>'block_time')::timestamptz, d->>'burn_token', d->>'depositor',
        (d->>'amount')::numeric, d->>'mint_recipient', (d->>'max_fee')::numeric, (d->>'min_finality_threshold')::int, true, 'burn_confirmed')
      returning id into v_id;
      insert into cctp_transfer_evidence (transfer_id, kind, detail) values (v_id, 'burn_observed', jsonb_build_object('event_id', e->>'event_id', 'finalized', true));
      v_burns := v_burns + 1;
    else
      v_mints := v_mints + 1;
      select id into v_id from cctp_transfers where cctp_version = 2 and source_domain = (d->>'source_domain')::int and nonce = d->>'nonce';
      if found then
        perform cctp_attach_destination(v_id, e->>'event_id', e->>'tx_hash', (e->>'block_number')::bigint, (e->>'log_index')::int,
          (e->>'block_time')::timestamptz, p_chain, p_local_domain, (d->>'minted')::numeric, (d->>'fee')::numeric, d->>'mint_recipient', 'mint_event');
        v_matched := v_matched + 1;
      else
        -- Inbound transfer whose source leg FurlPay did not index: recorded from the
        -- destination chain only (source_verified stays false; amount = minted + fee).
        insert into cctp_transfers (source_domain, destination_domain, nonce, destination_chain, destination_event_id, destination_tx_hash,
          destination_block_number, destination_log_index, destination_block_time, amount_raw, minted_raw, mint_fee_raw, mint_recipient,
          finality_threshold_executed, destination_method, destination_checked_at, destination_verified, finality_verified, status, status_reason)
        values ((d->>'source_domain')::int, p_local_domain, d->>'nonce', p_chain, e->>'event_id', e->>'tx_hash', (e->>'block_number')::bigint,
          (e->>'log_index')::int, (e->>'block_time')::timestamptz, (d->>'minted')::numeric + (d->>'fee')::numeric, (d->>'minted')::numeric,
          (d->>'fee')::numeric, d->>'mint_recipient', (d->>'finality_threshold_executed')::int, 'mint_event', now(), true, true, 'finalized',
          'source leg not indexed by FurlPay')
        on conflict (cctp_version, source_domain, nonce) where nonce is not null do nothing
        returning id into v_id;
        if v_id is not null then
          insert into cctp_transfer_evidence (transfer_id, kind, detail) values (v_id, 'mint_observed_inbound', jsonb_build_object('event_id', e->>'event_id'));
        end if;
      end if;
    end if;
  end loop;

  update onchain_asset_cursors set last_block = p_to, last_block_hash = p_to_hash, last_block_time = p_to_time, updated_at = now()
   where chain = p_chain and asset = 'cctp-v2';
  return jsonb_build_object('ok', true, 'burns', v_burns, 'mints', v_mints, 'matched', v_matched, 'duplicates', v_dup);
end $$;

-- Iris result for one transfer. p_matched = an Iris message matched the burn
-- field-for-field (amount, recipient, destination domain, max fee).
create or replace function cctp_apply_attestation(p_id bigint, p_matched boolean, p_status text, p_nonce text,
  p_executed_fee numeric, p_fin_executed integer, p_error text)
returns text
language plpgsql set search_path = public, pg_catalog as $$
declare t cctp_transfers%rowtype; other cctp_transfers%rowtype; v_next interval;
begin
  select * into t from cctp_transfers where id = p_id for update;
  if not found then return 'missing'; end if;
  if cctp_status_rank(t.status) >= 3 or t.status = 'mismatch' then return 'already'; end if;
  if not p_matched or p_status is distinct from 'complete' then
    -- not yet: back off exponentially (30 s .. 1 h)
    v_next := least(interval '1 hour', interval '30 seconds' * power(2, least(t.attestation_attempts, 7)));
    update cctp_transfers set attestation_attempts = attestation_attempts + 1, attestation_next_at = now() + v_next,
      attestation_checked_at = now(), attestation_status = coalesce(p_status, attestation_status),
      status = case when p_matched then 'attestation_pending' else status end,
      status_reason = coalesce(p_error, case when not p_matched then 'no attestation matching this burn yet' end), updated_at = now()
    where id = p_id;
    return 'pending';
  end if;
  -- An inbound-only row for the same message may already exist (destination indexed first).
  -- It is merged, not deleted: it gives up the identity and the destination event to this
  -- transfer and keeps its own evidence, pointing at the survivor.
  select * into other from cctp_transfers where cctp_version = t.cctp_version and source_domain = t.source_domain and nonce = p_nonce and id <> p_id and source_event_id is null for update;
  if other.id is not null then
    update cctp_transfers set nonce = null, destination_event_id = null, status = 'merged', merged_into = p_id,
      status_reason = 'destination leg of burn ' || p_id, updated_at = now() where id = other.id;
    insert into cctp_transfer_evidence (transfer_id, kind, detail) values (other.id, 'merged', jsonb_build_object('into', p_id));
  end if;
  update cctp_transfers set nonce = p_nonce, attestation_status = 'complete', executed_fee_raw = p_executed_fee,
    finality_threshold_executed = p_fin_executed, message_verified = true, attestation_checked_at = now(),
    status = 'attestation_complete', status_reason = null, updated_at = now()
  where id = p_id and not exists (select 1 from cctp_transfers x where x.id <> p_id and x.cctp_version = t.cctp_version and x.source_domain = t.source_domain and x.nonce = p_nonce and x.source_event_id is not null);
  if not found then
    perform onchain_record_issue(coalesce(t.source_chain, 'unknown'), 'cctp-v2', 'duplicate_event', t.source_block_number, format('nonce %s already belongs to another burn', p_nonce));
    update cctp_transfers set status = 'mismatch', status_reason = 'nonce already used by another burn', updated_at = now() where id = p_id;
    return 'duplicate_nonce';
  end if;
  insert into cctp_transfer_evidence (transfer_id, kind, detail) values (p_id, 'attestation_complete', jsonb_build_object('nonce', p_nonce, 'executed_fee', p_executed_fee, 'finality_threshold_executed', p_fin_executed));
  if other.id is not null then
    perform cctp_attach_destination(p_id, other.destination_event_id, other.destination_tx_hash, other.destination_block_number, other.destination_log_index,
      other.destination_block_time, other.destination_chain, other.destination_domain, other.minted_raw, other.mint_fee_raw, other.mint_recipient, 'mint_event');
  end if;
  return 'complete';
end $$;

-- Destination proven by chain state alone: usedNonces(nonce) = 1 on the
-- destination MessageTransmitterV2 at its finalized block (no tx known).
drop function if exists cctp_apply_used_nonce(bigint, boolean, text);
create or replace function cctp_apply_used_nonce(p_id bigint, p_used boolean, p_chain text, p_reason text default null)
returns text
language plpgsql set search_path = public, pg_catalog as $$
declare t cctp_transfers%rowtype;
begin
  select * into t from cctp_transfers where id = p_id for update;
  if not found or t.status <> 'attestation_complete' then return 'skip'; end if;
  if not p_used then
    update cctp_transfers set destination_checked_at = now(), status_reason = coalesce(p_reason, 'awaiting destination mint'), updated_at = now() where id = p_id;
    return 'pending';
  end if;
  update cctp_transfers set destination_method = 'used_nonce', destination_checked_at = now(), destination_chain = coalesce(destination_chain, p_chain),
    destination_verified = true, finality_verified = true, status = 'finalized',
    status_reason = 'destination receipt proven by usedNonces at the finalized block; mint transaction not indexed', updated_at = now()
  where id = p_id;
  insert into cctp_transfer_evidence (transfer_id, kind, detail) values (p_id, 'destination_used_nonce', jsonb_build_object('chain', p_chain, 'nonce', t.nonce, 'block_tag', 'finalized'));
  return 'finalized';
end $$;

-- Server-side summary for the dashboard (never raw rows to the browser).
create or replace function cctp_summary(p_since timestamptz)
returns jsonb
language sql stable set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from cctp_transfers
         where status <> 'merged' and coalesce(source_block_time, destination_block_time) >= p_since group by status) s), '{}'::jsonb),
    'outbound', coalesce((select jsonb_agg(o order by o.amount::numeric desc) from (
        select source_chain, destination_domain, count(*) n, sum(amount_raw)::text amount,
               count(*) filter (where destination_verified) verified
          from cctp_transfers where source_event_id is not null and status not in ('merged', 'mismatch') and source_block_time >= p_since
         group by 1, 2) o), '[]'::jsonb),
    'inbound', coalesce((select jsonb_agg(i order by i.minted::numeric desc) from (
        select destination_chain, source_domain, count(*) n, sum(minted_raw)::text minted
          from cctp_transfers where destination_event_id is not null and status not in ('merged', 'mismatch') and destination_block_time >= p_since
         group by 1, 2) i), '[]'::jsonb),
    'completion_seconds', (select jsonb_build_object('n', count(*), 'median', percentile_cont(0.5) within group (order by extract(epoch from destination_block_time - source_block_time)))
         from cctp_transfers where source_block_time >= p_since and destination_block_time is not null and source_block_time is not null and status = 'finalized'),
    'indexed_chains', coalesce((select jsonb_agg(jsonb_build_object('chain', chain, 'through', last_block, 'through_time', last_block_time)) from onchain_asset_cursors where asset = 'cctp-v2'), '[]'::jsonb)
  )
$$;

-- ── Access ──────────────────────────────────────────────────────────────────
alter table cctp_events enable row level security;
alter table cctp_transfers enable row level security;
alter table cctp_transfer_evidence enable row level security;
do $$
declare t text; f text;
begin
  foreach t in array array['cctp_events', 'cctp_transfers', 'cctp_transfer_evidence'] loop
    execute format('revoke all on table %I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table %I to service_role', t);
  end loop;
  grant usage, select on all sequences in schema public to service_role;
  foreach f in array array[
    'cctp_status_rank(text)',
    'cctp_attach_destination(bigint, text, text, bigint, integer, timestamptz, text, integer, numeric, numeric, text, text)',
    'cctp_commit_range(text, bigint, integer, bigint, bigint, bigint, text, text, timestamptz, jsonb)',
    'cctp_apply_attestation(bigint, boolean, text, text, numeric, integer, text)',
    'cctp_apply_used_nonce(bigint, boolean, text, text)',
    'cctp_summary(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

drop trigger if exists cctp_events_immutable on cctp_events;
create trigger cctp_events_immutable before update or delete on cctp_events
  for each row execute function onchain_asset_immutable();
drop trigger if exists cctp_transfer_evidence_immutable on cctp_transfer_evidence;
create trigger cctp_transfer_evidence_immutable before update or delete on cctp_transfer_evidence
  for each row execute function onchain_asset_immutable();
