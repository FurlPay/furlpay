-- BVNK provider records. Apply after 0051. Service-role access only.
--
-- One row per BVNK object FurlPay has heard about (pay-in, payout, transfer,
-- wallet), holding BVNK's latest reported state for reconciliation. It is a
-- RECORD OF WHAT BVNK SAID, not an accounting entry: nothing here posts to the
-- ledger, credits a balance or authorises a payment. BVNK itself says to
-- confirm a payment through the API after a webhook before acting on it.
--
-- Delivery de-duplication is webhook_events (0022, provider 'bvnk', keyed by
-- BVNK's eventId; atomic claim with a 15-minute lease for abandoned attempts).
-- This migration adds ORDER and FINALITY:
--   * a report is applied only if its provider timestamp is newer than the
--     stored one, so a late, out-of-order delivery cannot regress a status;
--   * once a record reaches a final status, a report that would move it
--     anywhere else is NOT applied, even if newer — it is recorded in
--     bvnk_exceptions for a person to look at. The one documented exception
--     is a completed payout being RETURNED by the beneficiary bank;
--   * two reports with the same timestamp and different statuses are a
--     contradiction, not a no-op, and are recorded the same way.
--
-- Amounts are BVNK's decimal amounts stored as numeric (exact), never float.
-- A transfer between two wallets of the same account produces both an IN and
-- an OUT report, so direction is part of the key.
--
-- No tenant column yet: FurlPay does not onboard customers to BVNK, so no row
-- belongs to a FurlPay user. These tables are reachable by service_role only
-- and are never read by a user-facing route.
begin;

create table bvnk_records (
  kind text not null check (kind in ('payin','payout','transfer','wallet')),
  provider_id text not null check (char_length(provider_id) between 1 and 100),
  direction text not null default '' check (direction in ('IN','OUT','')),
  reference text check (char_length(reference) <= 200),
  status text not null check (char_length(status) between 1 and 40),
  method text check (char_length(method) <= 40),
  wallet_id text check (char_length(wallet_id) <= 100),
  customer_id text check (char_length(customer_id) <= 100),
  originator_amount numeric check (originator_amount >= 0),
  originator_currency text check (char_length(originator_currency) <= 12),
  beneficiary_amount numeric check (beneficiary_amount >= 0),
  beneficiary_currency text check (char_length(beneficiary_currency) <= 12),
  processing_fee_amount numeric check (processing_fee_amount >= 0),
  processing_fee_currency text check (char_length(processing_fee_currency) <= 12),
  customer_fee_amount numeric check (customer_fee_amount >= 0),
  customer_fee_currency text check (char_length(customer_fee_currency) <= 12),
  conversion_rate numeric check (conversion_rate > 0),
  quote_digest text check (char_length(quote_digest) <= 1000),
  quote_expires_at timestamptz,
  provider_updated_at timestamptz not null,
  source text not null check (source in ('webhook','api')),
  last_event_id text check (char_length(last_event_id) <= 100),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- When reconciliation last asked BVNK about this record (null: never).
  reconciled_at timestamptz,
  primary key (kind, provider_id, direction)
);
create index bvnk_records_reference on bvnk_records(reference) where reference is not null;
-- Reconciliation picks the open records it checked longest ago first.
create index bvnk_records_reconcile on bvnk_records(kind, reconciled_at nulls first);

-- Anything a person must look at: a report that contradicts a final status,
-- two reports that disagree at the same timestamp, a record BVNK no longer
-- knows. Append-only from the application's side.
create table bvnk_exceptions (
  id bigint generated always as identity primary key,
  kind text not null,
  provider_id text not null,
  direction text not null default '',
  reason text not null check (reason in ('final_status_contradicted','same_time_status_conflict','missing_at_provider')),
  stored_status text,
  reported_status text,
  source text not null check (source in ('webhook','api')),
  event_id text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (char_length(resolution) <= 500)
);
create index bvnk_exceptions_open on bvnk_exceptions(detected_at desc) where resolved_at is null;

-- Final statuses as BVNK documents them.
create function bvnk_is_final(p_kind text, p_status text) returns boolean language sql immutable as $$
  select case p_kind
    when 'payin' then p_status = 'COMPLETED'
    when 'payout' then p_status in ('COMPLETED','EXPIRED','CANCELLED','FAILED','RETURNED')
    when 'transfer' then p_status in ('COMPLETED','FAILED','EXPIRED')
    when 'wallet' then p_status = 'TERMINATED'
    else false end
$$;

-- Apply one report. Returns 'inserted', 'updated', 'stale' (older, or an
-- identical repeat) or 'conflict' (not applied; recorded in bvnk_exceptions).
-- Row-locked, so concurrent reports for one object are applied one at a time.
create function bvnk_record_upsert(p jsonb) returns text
language plpgsql security definer set search_path=public as $$
declare r bvnk_records; cur bvnk_records;
begin
  r := jsonb_populate_record(null::bvnk_records, p);
  if r.kind is null or r.provider_id is null or r.status is null or r.provider_updated_at is null or r.source is null then
    raise exception 'bvnk_record_incomplete';
  end if;
  r.direction := coalesce(r.direction, '');

  insert into bvnk_records (kind,provider_id,direction,reference,status,method,wallet_id,customer_id,
    originator_amount,originator_currency,beneficiary_amount,beneficiary_currency,processing_fee_amount,processing_fee_currency,
    customer_fee_amount,customer_fee_currency,conversion_rate,quote_digest,quote_expires_at,provider_updated_at,source,last_event_id,reconciled_at)
  values (r.kind,r.provider_id,r.direction,r.reference,r.status,r.method,r.wallet_id,r.customer_id,
    r.originator_amount,r.originator_currency,r.beneficiary_amount,r.beneficiary_currency,r.processing_fee_amount,r.processing_fee_currency,
    r.customer_fee_amount,r.customer_fee_currency,r.conversion_rate,r.quote_digest,r.quote_expires_at,r.provider_updated_at,r.source,r.last_event_id,
    case when r.source = 'api' then now() end)
  on conflict (kind,provider_id,direction) do nothing;
  if found then return 'inserted'; end if;

  select * into cur from bvnk_records where kind=r.kind and provider_id=r.provider_id and direction=r.direction for update;
  if r.source = 'api' then update bvnk_records set reconciled_at=now() where kind=r.kind and provider_id=r.provider_id and direction=r.direction; end if;

  if r.provider_updated_at < cur.provider_updated_at then return 'stale'; end if;
  if r.provider_updated_at = cur.provider_updated_at then
    if r.status = cur.status then return 'stale'; end if;
    insert into bvnk_exceptions(kind,provider_id,direction,reason,stored_status,reported_status,source,event_id)
      values (r.kind,r.provider_id,r.direction,'same_time_status_conflict',cur.status,r.status,r.source,r.last_event_id);
    return 'conflict';
  end if;
  if bvnk_is_final(cur.kind, cur.status) and r.status <> cur.status
     and not (cur.kind = 'payout' and cur.status = 'COMPLETED' and r.status = 'RETURNED') then
    insert into bvnk_exceptions(kind,provider_id,direction,reason,stored_status,reported_status,source,event_id)
      values (r.kind,r.provider_id,r.direction,'final_status_contradicted',cur.status,r.status,r.source,r.last_event_id);
    return 'conflict';
  end if;

  update bvnk_records t set
    reference=coalesce(r.reference,t.reference), status=r.status, method=coalesce(r.method,t.method),
    wallet_id=coalesce(r.wallet_id,t.wallet_id), customer_id=coalesce(r.customer_id,t.customer_id),
    originator_amount=coalesce(r.originator_amount,t.originator_amount), originator_currency=coalesce(r.originator_currency,t.originator_currency),
    beneficiary_amount=coalesce(r.beneficiary_amount,t.beneficiary_amount), beneficiary_currency=coalesce(r.beneficiary_currency,t.beneficiary_currency),
    processing_fee_amount=coalesce(r.processing_fee_amount,t.processing_fee_amount), processing_fee_currency=coalesce(r.processing_fee_currency,t.processing_fee_currency),
    customer_fee_amount=coalesce(r.customer_fee_amount,t.customer_fee_amount), customer_fee_currency=coalesce(r.customer_fee_currency,t.customer_fee_currency),
    conversion_rate=coalesce(r.conversion_rate,t.conversion_rate), quote_digest=coalesce(r.quote_digest,t.quote_digest),
    quote_expires_at=coalesce(r.quote_expires_at,t.quote_expires_at),
    provider_updated_at=r.provider_updated_at, source=r.source, last_event_id=coalesce(r.last_event_id,t.last_event_id), last_seen_at=now()
  where t.kind=r.kind and t.provider_id=r.provider_id and t.direction=r.direction;
  return 'updated';
end $$;

-- Reconciliation found the record unknown at BVNK (404): record it once per
-- record while it stays unresolved, and mark the record checked.
create function bvnk_record_missing(p_kind text, p_provider_id text, p_direction text) returns void
language plpgsql security definer set search_path=public as $$
begin
  update bvnk_records set reconciled_at=now() where kind=p_kind and provider_id=p_provider_id and direction=p_direction;
  if not exists (select 1 from bvnk_exceptions where kind=p_kind and provider_id=p_provider_id and direction=p_direction
                 and reason='missing_at_provider' and resolved_at is null) then
    insert into bvnk_exceptions(kind,provider_id,direction,reason,source) values (p_kind,p_provider_id,p_direction,'missing_at_provider','api');
  end if;
end $$;

alter table bvnk_records enable row level security;
alter table bvnk_exceptions enable row level security;
revoke all on bvnk_records, bvnk_exceptions from anon, authenticated;
grant all on bvnk_records, bvnk_exceptions to service_role;
revoke all on function bvnk_record_upsert(jsonb), bvnk_record_missing(text,text,text), bvnk_is_final(text,text) from public, anon, authenticated;
grant execute on function bvnk_record_upsert(jsonb), bvnk_record_missing(text,text,text), bvnk_is_final(text,text) to service_role;

commit;
