-- ---------------------------------------------------------------------------
-- 0024 — claim_webhook_event: only the SAME body may reclaim a failed/stale row.
--
-- WHY A NEW MIGRATION. This guard was first written by editing 0022 in place
-- after 0022 had been committed (7f6f283). Version-tracked tooling
-- (`supabase db push`) never re-runs an applied version, so any environment
-- that had applied the committed 0022 would silently keep the weaker function
-- while the repository claimed otherwise. 0022 is restored byte-for-byte to
-- its committed text; the change ships here, forward-only.
--
-- WHAT CHANGES. In 0022, a redelivery carrying a known event id but a
-- DIFFERENT body could take ownership of a `failed` or stale `processing` row
-- (the DO UPDATE had no hash condition) and then be reported as a mismatch
-- only after it had claimed. Here the DO UPDATE additionally requires
-- `payload_hash = excluded.payload_hash`, so a forged "same id, different
-- payload" can never take ownership; it falls through to the duplicate branch,
-- is flagged, and the row is left for the genuine retry.
--
-- Same signature and return shape as 0022 — callers are unchanged.
-- Idempotent: `create or replace`, no data touched.
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
    where (webhook_events.status = 'failed'
           or (webhook_events.status = 'processing'
               and webhook_events.processing_started_at < now() - interval '15 minutes'))
      -- Only the SAME body may reclaim. A forged "same id, different payload"
      -- must never take ownership of a failed/stale row; it falls through to the
      -- duplicate branch below and is flagged, leaving the row for the real retry.
      and webhook_events.payload_hash = excluded.payload_hash
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
