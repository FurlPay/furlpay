-- BVNK provider records. Apply after 0051. Service-role access only.
--
-- One row per BVNK object FurlPay has heard about (pay-in, payout, transfer,
-- wallet), holding BVNK's latest reported state for reconciliation. It is a
-- RECORD OF WHAT BVNK SAID, not an accounting entry: nothing here posts to the
-- ledger, credits a balance or authorises a payment. BVNK itself says to
-- confirm a payment through the API after a webhook before acting on it.
--
-- Delivery de-duplication is webhook_events (0022, provider 'bvnk', keyed by
-- BVNK's eventId). This table adds ORDER: bvnk_record_upsert applies a report
-- only if its provider timestamp is newer than the stored one, so a late,
-- out-of-order delivery can never move a status backwards.
--
-- Amounts are BVNK's decimal amounts stored as numeric (exact), never float.
-- A transfer between two wallets of the same account produces both an IN and
-- an OUT report, so direction is part of the key.
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
  primary key (kind, provider_id, direction)
);
create index bvnk_records_reference on bvnk_records(reference) where reference is not null;
create index bvnk_records_open on bvnk_records(kind, status, provider_updated_at);

-- Insert, or update only when the incoming report is NEWER than the stored one.
-- Returns 'inserted', 'updated' or 'stale' (an older or equal report, ignored).
create function bvnk_record_upsert(p jsonb) returns text
language plpgsql security definer set search_path=public as $$
declare r bvnk_records; result text;
begin
  r := jsonb_populate_record(null::bvnk_records, p);
  if r.kind is null or r.provider_id is null or r.status is null or r.provider_updated_at is null or r.source is null then
    raise exception 'bvnk_record_incomplete';
  end if;
  r.direction := coalesce(r.direction, '');
  insert into bvnk_records as t (kind,provider_id,direction,reference,status,method,wallet_id,customer_id,
    originator_amount,originator_currency,beneficiary_amount,beneficiary_currency,processing_fee_amount,processing_fee_currency,
    customer_fee_amount,customer_fee_currency,conversion_rate,quote_digest,quote_expires_at,provider_updated_at,source,last_event_id)
  values (r.kind,r.provider_id,r.direction,r.reference,r.status,r.method,r.wallet_id,r.customer_id,
    r.originator_amount,r.originator_currency,r.beneficiary_amount,r.beneficiary_currency,r.processing_fee_amount,r.processing_fee_currency,
    r.customer_fee_amount,r.customer_fee_currency,r.conversion_rate,r.quote_digest,r.quote_expires_at,r.provider_updated_at,r.source,r.last_event_id)
  on conflict (kind,provider_id,direction) do update set
    reference=coalesce(excluded.reference,t.reference), status=excluded.status, method=coalesce(excluded.method,t.method),
    wallet_id=coalesce(excluded.wallet_id,t.wallet_id), customer_id=coalesce(excluded.customer_id,t.customer_id),
    originator_amount=coalesce(excluded.originator_amount,t.originator_amount), originator_currency=coalesce(excluded.originator_currency,t.originator_currency),
    beneficiary_amount=coalesce(excluded.beneficiary_amount,t.beneficiary_amount), beneficiary_currency=coalesce(excluded.beneficiary_currency,t.beneficiary_currency),
    processing_fee_amount=coalesce(excluded.processing_fee_amount,t.processing_fee_amount), processing_fee_currency=coalesce(excluded.processing_fee_currency,t.processing_fee_currency),
    customer_fee_amount=coalesce(excluded.customer_fee_amount,t.customer_fee_amount), customer_fee_currency=coalesce(excluded.customer_fee_currency,t.customer_fee_currency),
    conversion_rate=coalesce(excluded.conversion_rate,t.conversion_rate), quote_digest=coalesce(excluded.quote_digest,t.quote_digest),
    quote_expires_at=coalesce(excluded.quote_expires_at,t.quote_expires_at),
    provider_updated_at=excluded.provider_updated_at, source=excluded.source, last_event_id=coalesce(excluded.last_event_id,t.last_event_id), last_seen_at=now()
  where t.provider_updated_at < excluded.provider_updated_at
  returning case when xmax = 0 then 'inserted' else 'updated' end into result;
  return coalesce(result, 'stale');
end $$;

alter table bvnk_records enable row level security;
revoke all on bvnk_records from anon, authenticated;
grant all on bvnk_records to service_role;
revoke all on function bvnk_record_upsert(jsonb) from public, anon, authenticated;
grant execute on function bvnk_record_upsert(jsonb) to service_role;

commit;
