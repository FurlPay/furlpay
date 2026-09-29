-- ---------------------------------------------------------------------------
-- Schema assertions — let the running app check that the constraints it relies
-- on for CORRECTNESS actually exist in the database it is talking to.
--
-- THE GAP. Some of this application's safety properties are enforced by the
-- database, not by application code. The clearest one is dividend settlement:
--
--   apps/web/src/app/api/investing/dividends/settle/route.ts writes the
--   settlement record BEFORE crediting cash, and its comment says the UNIQUE
--   (user_id, corporate_action_id) constraint "is what makes this safe under
--   concurrency: two simultaneous runs both reading an empty settled-set will
--   both attempt the insert, and the database rejects the loser instead of
--   paying twice."
--
-- That reasoning is correct, and it is entirely contingent on the constraint
-- being present. 0006_corporate_actions.sql creates it. Nothing, anywhere,
-- verified that 0006 had actually been applied to the database a given
-- deployment points at.
--
-- The failure mode is the dangerous kind: SILENT. Without the constraint the
-- code still runs, every test still passes (tests exercise one request at a
-- time), and the only symptom is a dividend paid twice under concurrency —
-- discovered, if at all, during reconciliation, after the money moved.
--
-- WHAT THIS DOES. Exposes one function returning which of a FIXED, hard-coded
-- list of required constraints are missing. It is deliberately not a general
-- schema-introspection endpoint:
--
--   - the list of constraints lives in the function body, so a caller cannot
--     ask about arbitrary tables,
--   - it returns only names the application already knows, never column
--     definitions, row counts, or anything about data, and
--   - it is called from /api/ops/health, which is ADMIN_ONLY.
--
-- SECURITY DEFINER is required because pg_constraint is not readable through
-- PostgREST's exposed schema. The function is owned by the migration runner and
-- takes no arguments, so there is no injection surface: it cannot be steered.
--
-- IF THIS MIGRATION IS NOT APPLIED, the probe reports "unverified" rather than
-- "operational". That is the point — an unrunnable check must never read as a
-- passing check.
-- ---------------------------------------------------------------------------

create or replace function furlpay_missing_constraints()
returns table (constraint_name text, table_name text, purpose text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with required (constraint_name, table_name, purpose) as (
    values
      -- 0006_corporate_actions.sql. The concurrency backstop for dividend
      -- settlement: without it, two simultaneous settle runs both insert and
      -- both credit. See investing/dividends/settle/route.ts.
      ('dividend_once_per_user', 'dividend_events',
       'Stops a dividend being credited twice under concurrent settlement'),
      -- 0008_reorg_settlement.sql. Same shape for corporate-action reorgs
      -- (mergers, spin-offs, delistings) settled by
      -- investing/corporate-actions/settle.
      ('reorg_once_per_user', 'reorg_events',
       'Stops a corporate action being settled twice under concurrency')
  )
  select r.constraint_name, r.table_name, r.purpose
  from required r
  where not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = r.table_name
      and c.conname = r.constraint_name
  );
$$;

-- PostgREST reaches this with the service key only; the anon role gets nothing,
-- matching the deny-by-default posture established in 0001_init.sql.
revoke all on function furlpay_missing_constraints() from public;
revoke all on function furlpay_missing_constraints() from anon;
