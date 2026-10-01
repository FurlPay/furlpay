-- ---------------------------------------------------------------------------
-- 0025 — Effect-level idempotency and a single writer for money balances.
--
-- AUDIT P0-1. A webhook's financial effect could run twice. withDurableWebhook
-- ran the handler, then marked the event processed in a SEPARATE call; when
-- that mark failed the event was set 'failed', the provider redelivered, 0022
-- re-claimed the failed row and the handler ran again. The only thing between
-- that and a second credit was a 24h Redis key, and ledger transaction ids were
-- random, so Postgres had nothing to reject.
--
-- AUDIT P0-2. Balances were per-instance, in-memory snapshots flushed whole by
-- save_account_children (delete + reinsert every child row). Two instances
-- serving one user each wrote their own copy; the last writer won and the
-- other's credit or debit vanished. Flush errors were logged and swallowed.
--
-- WHAT THIS MIGRATION MAKES TRUE, IN THE DATABASE:
--
--  1. ledger_transactions.external_ref + a partial UNIQUE index. A financial
--     effect carries a key derived from the provider's own facts
--     (stripe:pi:<id>, x402-fund:<network>:<tx>, applepay:<ref>, ...). The
--     unique index admits exactly one transaction per key, whatever the retry
--     path, cache state or number of concurrent deliveries.
--
--  2. apply_financial_effect(): in ONE transaction —
--       insert the ledger header keyed by the effect (ON CONFLICT DO NOTHING),
--       and only if this call inserted it:
--         check and insert the balanced postings,
--         apply balance deltas with row locks and an overdraft guard,
--       then (either way) mark the webhook event processed.
--     A duplicate returns applied=false and changes nothing but the mark, so an
--     acknowledgement failure followed by a redelivery is harmless.
--
--  3. save_account_children no longer touches token_balances or fiat_balances.
--     Same 7-argument signature (callers unchanged; the two balance arguments
--     are accepted and ignored), so an older app build can no longer clobber a
--     balance either. Money balances change ONLY through
--     apply_financial_effect (or the older row-locked transfer function from
--     0002). A snapshot can go stale; it can no longer overwrite money.
--
-- Forward-only and idempotent: `add column if not exists`, `create ... if not
-- exists`, `create or replace`. No data is modified.
-- ---------------------------------------------------------------------------

alter table ledger_transactions add column if not exists external_ref text;

create unique index if not exists ledger_tx_external_ref_uniq
  on ledger_transactions (external_ref) where external_ref is not null;

-- ---------------------------------------------------------------------------
-- apply_financial_effect
--
-- p_postings:        [{account_id, side: 'debit'|'credit', amount: bigint}]
--                    integer minor units, at least two legs, debits = credits.
--                    The ledger accounts must already exist (the app ensures
--                    them, as ledger_post callers always have).
-- p_balance_deltas:  [{user_id, token, chain, amount, usd_value}]
--                    amount and usd_value are SIGNED decimal strings (never
--                    floats); a delta that would take a balance below zero
--                    raises, rolling back the whole effect.
-- p_provider/
-- p_event_id:        optional webhook_events row to mark processed in the same
--                    transaction as the effect.
-- ---------------------------------------------------------------------------
create or replace function apply_financial_effect(
  p_effect_key     text,
  p_memo           text,
  p_postings       jsonb,
  p_balance_deltas jsonb default '[]'::jsonb,
  p_provider       text  default null,
  p_event_id       text  default null
) returns table (applied boolean, ledger_tx_id text)
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_tx_id   text := 'lx_' || md5(p_effect_key);
  v_new_id  text;
  v_debits  numeric;
  v_credits numeric;
  v_count   int;
  d         record;
begin
  if p_effect_key is null or length(trim(p_effect_key)) = 0 then
    raise exception 'apply_financial_effect: effect key is required';
  end if;

  insert into ledger_transactions (id, memo, external_ref)
  values (v_tx_id, p_memo, p_effect_key)
  on conflict do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Already applied (by an earlier delivery, a retry, or a concurrent call
    -- that won the unique index). Nothing moves. Record the acknowledgement so
    -- the redelivery that got us here stops.
    if p_provider is not null and p_event_id is not null then
      update webhook_events
         set status = 'processed', processed_at = coalesce(processed_at, now())
       where provider = p_provider and provider_event_id = p_event_id;
    end if;
    return query
      select false, lt.id from ledger_transactions lt where lt.external_ref = p_effect_key;
    return;
  end if;

  select
    coalesce(sum(case when x.side = 'debit'  then x.amount else 0 end), 0),
    coalesce(sum(case when x.side = 'credit' then x.amount else 0 end), 0),
    count(*)
  into v_debits, v_credits, v_count
  from jsonb_to_recordset(coalesce(p_postings, '[]'::jsonb))
    as x(account_id text, side text, amount bigint);

  if v_count < 2 then
    raise exception 'apply_financial_effect: a transaction needs at least two postings (got %)', v_count;
  end if;
  if v_debits <> v_credits then
    raise exception 'apply_financial_effect: unbalanced — debits % <> credits %', v_debits, v_credits;
  end if;

  insert into ledger_postings (transaction_id, account_id, side, amount)
  select v_tx_id, x.account_id, x.side, x.amount
  from jsonb_to_recordset(p_postings) as x(account_id text, side text, amount bigint);

  -- Balance deltas. Rows are created first (so every row exists), then locked
  -- in one deterministic order before any is changed — two effects touching
  -- the same pair of balances cannot deadlock.
  for d in
    select (x->>'user_id')::uuid as user_id,
           x->>'token'           as token,
           x->>'chain'           as chain
    from jsonb_array_elements(coalesce(p_balance_deltas, '[]'::jsonb)) x
  loop
    insert into token_balances (user_id, token, chain, amount, usd_value)
    values (d.user_id, d.token, d.chain, 0, 0)
    on conflict (user_id, token, chain) do nothing;
  end loop;

  perform 1
    from token_balances tb
    join (
      select distinct (x->>'user_id')::uuid as user_id, x->>'token' as token, x->>'chain' as chain
      from jsonb_array_elements(coalesce(p_balance_deltas, '[]'::jsonb)) x
    ) k on k.user_id = tb.user_id and k.token = tb.token and k.chain = tb.chain
   order by tb.user_id, tb.token, tb.chain
     for update of tb;

  for d in
    select (x->>'user_id')::uuid        as user_id,
           x->>'token'                  as token,
           x->>'chain'                  as chain,
           (x->>'amount')::numeric      as amount,
           coalesce((x->>'usd_value')::numeric, 0) as usd_value
    from jsonb_array_elements(coalesce(p_balance_deltas, '[]'::jsonb)) x
  loop
    update token_balances
       set amount    = amount + d.amount,
           usd_value = greatest(usd_value + d.usd_value, 0)
     where user_id = d.user_id and token = d.token and chain = d.chain
       and amount + d.amount >= 0;               -- overdraft guard
    if not found then
      raise exception 'apply_financial_effect: insufficient % balance on % for user %',
        d.token, d.chain, d.user_id;
    end if;
  end loop;

  if p_provider is not null and p_event_id is not null then
    update webhook_events
       set status = 'processed', processed_at = now()
     where provider = p_provider and provider_event_id = p_event_id;
  end if;

  return query select true, v_tx_id;
end;
$$;

revoke all on function apply_financial_effect(text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function apply_financial_effect(text, text, jsonb, jsonb, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- save_account_children, v3: the snapshot no longer writes money.
--
-- Same signature as 0010 so `create or replace` replaces it in place and every
-- caller (including an older build mid-rollout) keeps resolving. The balance
-- arguments are ACCEPTED AND IGNORED on purpose.
-- ---------------------------------------------------------------------------
create or replace function save_account_children(
  p_user_id        uuid,
  p_token_balances jsonb,
  p_fiat_balances  jsonb,
  p_holdings       jsonb,
  p_cards          jsonb,
  p_bills          jsonb,
  p_contacts       jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- token_balances / fiat_balances: intentionally untouched. See header.

  delete from holdings where user_id = p_user_id;
  insert into holdings (user_id, symbol, name, shares, price, change_pct, market_value, cost_basis)
  select p_user_id, x.symbol, x.name, x.shares, x.price, x.change_pct, x.market_value, x.cost_basis
  from jsonb_to_recordset(coalesce(p_holdings, '[]'::jsonb))
    as x(symbol text, name text, shares numeric, price numeric,
         change_pct numeric, market_value numeric, cost_basis numeric);

  delete from cards where user_id = p_user_id;
  insert into cards (id, user_id, kind, label, last4, network, frozen, gradient, limits, channels, settlement_currency)
  select x.id, p_user_id, x.kind, x.label, x.last4, x.network, x.frozen, x.gradient, x.limits, x.channels, x.settlement_currency
  from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(id text, kind text, label text, last4 text, network text, frozen boolean,
         gradient jsonb, limits jsonb, channels jsonb, settlement_currency text);

  delete from bills where user_id = p_user_id;
  insert into bills (id, user_id, provider, category, balance_due, due_date, autopay)
  select x.id, p_user_id, x.provider, x.category, x.balance_due, x.due_date, x.autopay
  from jsonb_to_recordset(coalesce(p_bills, '[]'::jsonb))
    as x(id text, provider text, category text, balance_due numeric,
         due_date date, autopay boolean);

  delete from contacts where user_id = p_user_id;
  insert into contacts (id, user_id, name, avatar_color, addresses, is_favorite, created_at, updated_at)
  select x.id, p_user_id, x.name, x.avatar_color,
         coalesce(x.addresses, '[]'::jsonb), coalesce(x.is_favorite, false),
         coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_contacts, '[]'::jsonb))
    as x(id text, name text, avatar_color text, addresses jsonb,
         is_favorite boolean, created_at timestamptz, updated_at timestamptz);
end;
$$;

revoke all on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Schema assertions v3: add the new uniqueness guard to the probe (0023 shape).
-- ---------------------------------------------------------------------------
create or replace function furlpay_missing_constraints()
returns table (constraint_name text, table_name text, purpose text)
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  with required (constraint_name, table_name, purpose) as (
    values
      ('dividend_once_per_user', 'dividend_events',
       '0006: stops a dividend being credited twice under concurrent settlement'),
      ('reorg_once_per_user', 'reorg_events',
       '0008: stops a corporate action being settled twice under concurrency'),
      ('webhook_events_provider_provider_event_id_key', 'webhook_events',
       '0022: stops a redelivered webhook (incl. deposit credits) being processed twice'),
      ('payments_idempotency_uniq', 'payments',
       '0009: one payment per idempotency key'),
      ('payments_tx_uniq', 'payments',
       '0009: one payment per on-chain transaction'),
      ('ledger_transactions_reverses_uniq', 'ledger_transactions',
       '0009: a ledger entry can be reversed at most once'),
      ('ftx_idempotency_uniq', 'financial_transactions',
       '0014: one financial transaction per idempotency key'),
      ('ftx_provider_ref_uniq', 'financial_transactions',
       '0014: one financial transaction per provider reference'),
      ('ftx_chain_tx_uniq', 'financial_transactions',
       '0014: one financial transaction per chain transaction'),
      ('cp_mandates_nonce_uniq', 'cp_mandates',
       '0020: a mandate nonce is single-use per organization'),
      ('cp_auth_idem_uniq', 'cp_authorizations',
       '0020: one control-plane authorization per idempotency key'),
      ('ledger_tx_external_ref_uniq', 'ledger_transactions',
       '0025: one financial effect per effect key (webhook/retry idempotency)')
  )
  select r.constraint_name, r.table_name, r.purpose
  from required r
  where not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = r.table_name and c.conname = r.constraint_name
  )
  and not exists (
    select 1
    from pg_index i
    join pg_class ix on ix.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = r.table_name and ix.relname = r.constraint_name
      and i.indisunique
  );
$$;

revoke all on function furlpay_missing_constraints() from public;
revoke all on function furlpay_missing_constraints() from anon;
revoke all on function furlpay_missing_constraints() from authenticated;
grant execute on function furlpay_missing_constraints() to service_role;
