-- ---------------------------------------------------------------------------
-- Atomic whole-account write-back
--
-- storeDb.saveAccount() flushes a user's children (balances, holdings, cards,
-- bills) over several PostgREST calls. It originally DELETEd each child table
-- and then re-INSERTed it, which meant a crash, timeout, or serverless freeze
-- between the two calls left that user's balances at ZERO — and any concurrent
-- read landing in the gap saw an empty wallet. Every account mutation flushes,
-- so the window was open on every transfer and every card freeze.
--
-- The TypeScript side has since been reordered to write-then-prune, which is
-- crash-safe (worst case: a stale row the next flush clears; never a zeroed
-- balance). This function closes the remaining gap: it makes the whole flush a
-- SINGLE transaction, so there is no intermediate state to observe at all.
--
-- storeDb.saveAccount() calls this via RPC when it exists and falls back to the
-- write-then-prune path when it doesn't, so applying this migration is a
-- straight upgrade and rolling it back is safe.
-- ---------------------------------------------------------------------------

create or replace function save_account_children(
  p_user_id        uuid,
  p_token_balances jsonb,
  p_fiat_balances  jsonb,
  p_holdings       jsonb,
  p_cards          jsonb,
  p_bills          jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- One statement per table, all inside the function's implicit transaction:
  -- either every child table lands, or none of them do.

  delete from token_balances where user_id = p_user_id;
  insert into token_balances (user_id, token, chain, amount, usd_value)
  select p_user_id, x.token, x.chain, x.amount, x.usd_value
  from jsonb_to_recordset(coalesce(p_token_balances, '[]'::jsonb))
    as x(token text, chain text, amount numeric, usd_value numeric);

  delete from fiat_balances where user_id = p_user_id;
  insert into fiat_balances (user_id, currency, amount, usd_value, local_details)
  select p_user_id, x.currency, x.amount, x.usd_value, x.local_details
  from jsonb_to_recordset(coalesce(p_fiat_balances, '[]'::jsonb))
    as x(currency text, amount numeric, usd_value numeric, local_details jsonb);

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
end;
$$;

-- Only the service role reaches PostgREST with our key; revoke the rest so a
-- leaked anon key can never rewrite an account's balances.
revoke all on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
