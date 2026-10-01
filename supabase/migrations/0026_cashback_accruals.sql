-- ---------------------------------------------------------------------------
-- 0026 — Durable cashback accruals with a database-atomic claim.
--
-- BEFORE. Accruals lived in a per-process Map (lib/services/membership.ts): lost
-- on restart, invisible to other instances, and "claimed" was a field flipped
-- in memory. The payout itself was keyed (0025), but whether an accrual had
-- been claimed was not something the database knew.
--
-- NOW.
--   cashback_accruals   one row per (user, source spend) — UNIQUE, so the same
--                       spend can never accrue twice; amounts in integer minor
--                       units, USD only; claimed_at + claim_effect_key record
--                       exactly which payout consumed it.
--   claim_cashback()    in ONE transaction: lock the caller's unclaimed
--                       accruals (FOR UPDATE, deterministic order), compute the
--                       total from the ROWS (never from the client), apply one
--                       financial effect keyed by the exact accrual set, mark
--                       them claimed. A concurrent second claim waits on the
--                       row locks, re-checks `claimed_at is null` after the
--                       first commits, finds nothing, and pays nothing.
--
-- The claim operates on the user id the SERVER passes (the session subject);
-- there is no parameter for choosing accruals, so another user's accrual can
-- never be named, mixed in, or paid to the wrong account.
--
-- Forward-only, idempotent.
-- ---------------------------------------------------------------------------

create table if not exists cashback_accruals (
  id                text primary key,
  user_id           uuid not null references users (id) on delete cascade,
  -- The spend this accrual came from (e.g. a card authorisation id). One
  -- accrual per spend per user, enforced here rather than in application code.
  source_ref        text not null,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          text not null default 'USD' check (currency = 'USD'),
  accrued_at        timestamptz not null default now(),
  claimed_at        timestamptz,
  claim_effect_key  text,
  constraint cashback_accrual_once_per_source unique (user_id, source_ref),
  constraint cashback_claim_consistent check ((claimed_at is null) = (claim_effect_key is null))
);

create index if not exists cashback_accruals_unclaimed_idx
  on cashback_accruals (user_id) where claimed_at is null;

alter table if exists cashback_accruals enable row level security;

-- Record an accrual. Idempotent on (user, source): a redelivered spend event
-- returns false and changes nothing.
create or replace function record_cashback_accrual(
  p_id           text,
  p_user_id      uuid,
  p_source_ref   text,
  p_amount_minor bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_inserted text;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'record_cashback_accrual: amount must be positive';
  end if;
  insert into cashback_accruals (id, user_id, source_ref, amount_minor)
  values (p_id, p_user_id, p_source_ref, p_amount_minor)
  on conflict do nothing
  returning id into v_inserted;
  return v_inserted is not null;
end;
$$;

-- Claim everything the user has accrued and not yet claimed.
--   p_liability_account  the user's customer-liability ledger account id
--   p_expense_account    the rewards/operational expense account id
-- Both accounts must exist (the application ensures them, as for every posting).
create or replace function claim_cashback(
  p_user_id            uuid,
  p_liability_account  text,
  p_expense_account    text
) returns table (applied boolean, claimed_minor bigint, accrual_count int, effect_key text)
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_ids    text[];
  v_total  bigint;
  v_key    text;
  v_amount text;
  v_res    record;
begin
  -- The liability account must be THIS user's: the caller cannot direct the
  -- payout to someone else's account by passing a different id.
  if p_liability_account <> 'acct_2000_' || p_user_id::text then
    raise exception 'claim_cashback: liability account does not belong to the user';
  end if;

  select array_agg(id order by id), coalesce(sum(amount_minor), 0)
    into v_ids, v_total
    from (
      select id, amount_minor
        from cashback_accruals
       where user_id = p_user_id and claimed_at is null
       order by id
         for update
    ) locked;

  if v_ids is null or array_length(v_ids, 1) is null or v_total <= 0 then
    return query select false, 0::bigint, 0, null::text;
    return;
  end if;

  v_key := 'cashback:furlpay:' || p_user_id::text || ':' || md5(array_to_string(v_ids, ','));
  v_amount := (v_total::numeric / 100)::numeric(20, 2)::text;

  select * into v_res from apply_financial_effect(
    v_key,
    'Cashback claim (' || array_length(v_ids, 1) || ' accruals)',
    jsonb_build_array(
      jsonb_build_object('account_id', p_expense_account, 'side', 'debit', 'amount', v_total),
      jsonb_build_object('account_id', p_liability_account, 'side', 'credit', 'amount', v_total)
    ),
    jsonb_build_array(
      jsonb_build_object('user_id', p_user_id, 'token', 'USDC', 'chain', 'arbitrum', 'amount', v_amount, 'usd_value', v_amount)
    )
  );

  update cashback_accruals
     set claimed_at = now(), claim_effect_key = v_key
   where id = any (v_ids);

  return query select v_res.applied, v_total, array_length(v_ids, 1), v_key;
end;
$$;

revoke all on function record_cashback_accrual(text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function claim_cashback(uuid, text, text) from public, anon, authenticated;
grant execute on function record_cashback_accrual(text, uuid, text, bigint) to service_role;
grant execute on function claim_cashback(uuid, text, text) to service_role;
