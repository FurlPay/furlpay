-- ---------------------------------------------------------------------------
-- Schema assertions v2 — extend furlpay_missing_constraints() (0017) to every
-- uniqueness guard the application's money and webhook safety now relies on.
--
-- WHY. 0017 asserted two constraints (dividend and reorg settlement). Since
-- then the code has come to depend on more database-enforced uniqueness:
--
--   * webhook_events UNIQUE (provider, provider_event_id)   0022
--       the durable claim that stops a redelivered webhook — including the
--       deposit credit — being processed twice (lib/withDurableWebhook.ts)
--   * payments_idempotency_uniq, payments_tx_uniq           0009
--   * ledger_transactions_reverses_uniq                     0009
--       a ledger entry can be reversed at most once
--   * ftx_idempotency_uniq, ftx_provider_ref_uniq,
--     ftx_chain_tx_uniq                                     0014
--   * cp_mandates_nonce_uniq, cp_auth_idem_uniq             0020
--
-- Several of those are unique INDEXES, not constraints, so 0017's
-- pg_constraint lookup could never see them. This version checks both.
--
-- SAME SIGNATURE AND RETURN SHAPE as 0017, so lib/ops/schemaProbe.ts works
-- unchanged. Idempotent: `create or replace`, no data touched.
--
-- APPLYING THIS DOES NOT PROVE THE OTHERS ARE APPLIED — it is the probe that
-- tells you whether they are. After applying, an operator runs:
--     select * from furlpay_missing_constraints();
-- Zero rows = every listed guard exists. Any row names the missing guard and
-- the migration to apply.
-- ---------------------------------------------------------------------------

create or replace function furlpay_missing_constraints()
returns table (constraint_name text, table_name text, purpose text)
language sql
security definer
set search_path = public, pg_catalog
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
       '0020: one control-plane authorization per idempotency key')
  )
  select r.constraint_name, r.table_name, r.purpose
  from required r
  where not exists (
    -- a named constraint (UNIQUE / PRIMARY KEY) on the table…
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = r.table_name and c.conname = r.constraint_name
  )
  and not exists (
    -- …or a UNIQUE index of that name on the table.
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
