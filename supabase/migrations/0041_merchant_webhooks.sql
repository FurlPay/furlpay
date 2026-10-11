-- Merchant webhook delivery for the 0040 outbox. Apply after 0040.
-- One HTTPS endpoint per merchant. The signing secret is stored only sealed
-- (AES-256-GCM, "v1:" prefix, key FURLPAY_PARTNER_WEBHOOK_KEY, AAD bound to the
-- merchant id); the plaintext is shown to the merchant once, at creation.
-- Delivery is at-least-once: merchants dedupe on the event id, which is the
-- outbox row id and is identical on every retry.
begin;
create table merchant_webhook_endpoints (
  merchant_id uuid primary key,
  url text not null check (url ~ '^https://[^\s]{4,500}$'),
  secret_enc text not null check (secret_enc like 'v1:%'),
  secret_last4 text not null check (char_length(secret_last4) = 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table merchant_payment_outbox
  add column attempts integer not null default 0 check (attempts >= 0),
  add column next_attempt_at timestamptz not null default now(),
  add column delivered_at timestamptz,
  add column last_error text;
create index merchant_payment_outbox_due on merchant_payment_outbox (next_attempt_at) where delivered_at is null;

-- Claim due events for one delivery pass. SKIP LOCKED + a lease on
-- next_attempt_at keep two overlapping cron runs from sending the same event
-- concurrently; attempts is counted at claim time so a crash mid-send still
-- consumes the attempt (no infinite retry of a poison event).
create function merchant_outbox_claim(p_limit integer, p_lease_seconds integer, p_max_attempts integer)
returns setof merchant_payment_outbox language plpgsql security definer set search_path=public as $$
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 10 or p_max_attempts < 1 then raise exception 'invalid_claim'; end if;
  return query
  update merchant_payment_outbox o
     set attempts = o.attempts + 1, next_attempt_at = now() + make_interval(secs => p_lease_seconds)
   where o.id in (
     select id from merchant_payment_outbox
      where delivered_at is null and attempts < p_max_attempts and next_attempt_at <= now()
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning o.*;
end $$;

alter table merchant_webhook_endpoints enable row level security;
revoke all on merchant_webhook_endpoints from anon, authenticated;
grant all on merchant_webhook_endpoints to service_role;
revoke all on function merchant_outbox_claim(integer, integer, integer) from public, anon, authenticated;
grant execute on function merchant_outbox_claim(integer, integer, integer) to service_role;
commit;
