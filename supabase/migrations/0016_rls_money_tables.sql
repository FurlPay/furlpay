-- ---------------------------------------------------------------------------
-- Row-level security for the money tables.
--
-- THE GAP. 0001_init.sql establishes the pattern for this database and states it
-- plainly: "Service-role-only access: RLS on, zero policies. PostgREST with the
-- service key bypasses RLS; the anon key gets nothing." That is a sound
-- deny-by-default design, and it was applied to users, balances, holdings,
-- cards, bills and transactions.
--
-- Seven tables added later never got the same line. Every one of them holds
-- customer financial records:
--
--     payments, payment_events
--     ledger_accounts, ledger_transactions, ledger_postings
--     financial_transactions, financial_transaction_events
--
-- Supabase grants the `anon` and `authenticated` roles access to tables in the
-- public schema. With RLS off, those grants are the only thing standing between
-- a published anon key — which is published, by design, it ships in clients —
-- and the payment and ledger history of every customer. PostgREST will happily
-- serve `/rest/v1/payments?select=*` to it.
--
-- WHY THIS IS SAFE TO APPLY. The application reaches Postgres exclusively with
-- SUPABASE_SERVICE_ROLE_KEY (lib/supabase.ts), and the service role bypasses
-- RLS. No browser code queries these tables directly — verified by searching for
-- client-side `.from("payments")` and friends, of which there are none. So
-- enabling RLS removes anon reachability and changes nothing about how the app
-- works.
--
-- NO POLICIES, DELIBERATELY. A policy would be a statement that some non-service
-- role may read these rows, and none should. Zero policies under RLS is a total
-- deny for every role that does not bypass it, which is exactly the intent.
--
-- IDEMPOTENT. `enable row level security` is not conditional in Postgres, but
-- re-running it on an already-enabled table is a no-op rather than an error, so
-- this migration is safe to replay.
-- ---------------------------------------------------------------------------

-- Payments (0009)
alter table if exists payments        enable row level security;
alter table if exists payment_events  enable row level security;

-- Double-entry ledger (0009). `ledger_postings` is the row-level money movement
-- and is the single most sensitive table in this list.
alter table if exists ledger_accounts     enable row level security;
alter table if exists ledger_transactions enable row level security;
alter table if exists ledger_postings     enable row level security;

-- Financial transaction projection (0014)
alter table if exists financial_transactions       enable row level security;
alter table if exists financial_transaction_events enable row level security;

-- ---------------------------------------------------------------------------
-- Belt and braces: revoke the grants themselves.
--
-- RLS is the control; this removes the grant RLS is filtering. Two independent
-- reasons to keep both: a future migration that disables RLS on one of these
-- tables (to debug something, say) would re-expose it if the grant were still
-- there, and `GRANT ALL ON ALL TABLES IN SCHEMA public` in some future setup
-- script would quietly re-widen access that only RLS was holding shut.
--
-- The service role is unaffected — it is a distinct role and bypasses both.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'payments', 'payment_events',
    'ledger_accounts', 'ledger_transactions', 'ledger_postings',
    'financial_transactions', 'financial_transaction_events'
  ]
  loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
