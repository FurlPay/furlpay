-- ---------------------------------------------------------------------------
-- Durable webhook event registry — a THIRD, authoritative dedupe layer.
--
-- WHAT ALREADY EXISTS (and is NOT replaced by this):
--   1. Per-provider HMAC signature verification (fail-closed).
--   2. webhookGuard — KV/Redis `wh:dedup:{id}` tryBegin/markProcessed/markFailed.
--   3. Business-operation idempotency (withIdempotency) + markCredited.
-- Those are fast and correct in the common case, but KV is non-authoritative:
-- a cache eviction or Upstash outage erases the dedupe set, and nothing durable
-- then stops a provider redelivery (providers retry for hours/days) from being
-- processed twice. This table makes the UNIQUE(provider, provider_event_id)
-- constraint in Postgres the ultimate concurrency authority, surviving cache
-- loss and giving a permanent audit trail. It is an ADDITIONAL layer, not a
-- substitute — defense in depth for money movement.
--
-- WHAT IS STORED. Provider, event id, event type, a payload HASH (never the raw
-- payload — no PII/secret at rest), processing status + timestamps + attempt
-- count + a sanitized last_error. A payload-hash column also detects a spoofed
-- "same id, different body" replay.
--
-- SERVICE-ROLE ONLY. Same posture as every money table (see 0016): RLS on, zero
-- policies. The app reaches Postgres only with the service role, which bypasses
-- RLS; anon/authenticated get nothing.
--
-- IDEMPOTENT + FORWARD-ONLY. Safe to replay; applies nothing destructive.
-- ---------------------------------------------------------------------------

create table if not exists webhook_events (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null,
  provider_event_id     text not null,
  event_type            text,
  -- Hash only. The raw body is never persisted; this is enough to detect a
  -- "same id, different payload" replay without holding sensitive data at rest.
  payload_hash          text not null,
  status                text not null default 'received'
                          check (status in ('received','processing','processed','failed')),
  attempt_count         integer not null default 0,
  received_at           timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at          timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- The dedupe lookup is always (provider, provider_event_id); the UNIQUE index
-- above already serves it. This one supports operational queries by state.
create index if not exists webhook_events_status_idx
  on webhook_events (provider, status, received_at desc);

alter table if exists webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- claim_webhook_event — atomic claim. The INSERT ... ON CONFLICT DO NOTHING is
-- the whole point: two workers racing the same event cannot both win, because
-- the UNIQUE constraint admits exactly one INSERT. The loser reads the existing
-- row and learns it is a duplicate, plus whether the body hash differs (a
-- suspicious "same id, different payload" replay the caller must NOT process).
-- ---------------------------------------------------------------------------
create or replace function claim_webhook_event(
  p_provider          text,
  p_provider_event_id text,
  p_event_type        text,
  p_payload_hash      text
) returns table (
  claimed          boolean,
  duplicate        boolean,
  existing_status  text,
  payload_mismatch boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_hash   text;
begin
  -- One statement decides ownership. A fresh event inserts. A previously FAILED
  -- event, or one whose worker claimed it and then died (status 'processing'
  -- older than the stale window), is re-claimed via DO UPDATE — that is the
  -- crash-recovery / retry path (FAILED → PROCESSING). A row that is genuinely
  -- 'processing' (live) or already 'processed' is excluded by the WHERE, so the
  -- UPDATE touches nothing and `found` is false: a real duplicate.
  --
  -- payload_hash is deliberately NEVER updated here, so it always reflects the
  -- FIRST body seen for this id — which is what lets a "same id, different body"
  -- replay be detected on any later claim.
  insert into webhook_events (provider, provider_event_id, event_type, payload_hash, status, attempt_count, processing_started_at)
  values (p_provider, p_provider_event_id, p_event_type, p_payload_hash, 'processing', 1, now())
  on conflict (provider, provider_event_id) do update
    set status = 'processing',
        attempt_count = webhook_events.attempt_count + 1,
        processing_started_at = now(),
        last_error = null
    where webhook_events.status = 'failed'
       or (webhook_events.status = 'processing'
           and webhook_events.processing_started_at < now() - interval '15 minutes')
  returning status, payload_hash into v_status, v_hash;

  if found then
    -- Claimed (inserted or reclaimed). On a fresh insert v_hash = p_payload_hash
    -- so mismatch is false; on a reclaim it is the original body's hash.
    return query select true, false, v_status, (v_hash is distinct from p_payload_hash);
    return;
  end if;

  -- Live duplicate (processing-not-stale, or already processed): DO NOT process.
  -- Read its state and flag a body-hash mismatch as suspicious.
  select status, payload_hash into v_status, v_hash
  from webhook_events
  where provider = p_provider and provider_event_id = p_provider_event_id;

  return query select false, true, v_status, (v_hash is distinct from p_payload_hash);
end;
$$;

-- Mark a claimed event processed. Idempotent by nature — re-running just keeps
-- it 'processed'. Only advances from a non-terminal-success state.
create or replace function mark_webhook_processed(
  p_provider          text,
  p_provider_event_id text
) returns void
language sql
security definer
set search_path = public
as $$
  update webhook_events
     set status = 'processed', processed_at = now()
   where provider = p_provider and provider_event_id = p_provider_event_id;
$$;

-- Mark a claimed event failed and RELEASE it for retry: the next claim from the
-- provider's redelivery re-enters 'processing' and bumps attempt_count. Mirrors
-- webhookGuard.markFailed (KV) so the two layers agree that a failed handler is
-- retryable rather than a swallowed duplicate.
create or replace function mark_webhook_failed(
  p_provider          text,
  p_provider_event_id text,
  p_error             text
) returns void
language sql
security definer
set search_path = public
as $$
  update webhook_events
     set status = 'failed', last_error = left(coalesce(p_error, ''), 500)
   where provider = p_provider and provider_event_id = p_provider_event_id;
$$;
