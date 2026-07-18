-- ---------------------------------------------------------------------------
-- Post-migration verification for 0006_corporate_actions.sql
--
-- Run this in the Supabase SQL Editor immediately AFTER applying 0006 and
-- BEFORE running the backfill. Confirms the schema is actually what the
-- application expects, rather than inferring it from "the migration ran".
--
-- The specific trap: CREATE TABLE IF NOT EXISTS silently SKIPS a table that
-- already exists in a different shape. A partially-applied earlier draft would
-- therefore report success while missing columns the backfill depends on.
-- Query 2 is what catches that.
--
-- Every query should return the row counts noted in its header.
-- ---------------------------------------------------------------------------

-- 1. Tables exist. Expect 4 rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('trade_lots', 'corporate_actions', 'dividend_events', 'symbol_mappings')
order by table_name;

-- 2. trade_lots has the columns the app writes. Expect 12 rows, and
--    `provenance` MUST be present — the backfill writes it and storeDb reads
--    it. Its absence means an older draft of 0006 is deployed.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'trade_lots'
order by ordinal_position;

-- 3. Indexes. Expect 8 across the three tables. The ones that matter are
--    trade_lots_open_idx (FIFO hot path) and trade_lots_provenance_idx (the
--    "still on reconstructed data?" query); the rest are PKs and the
--    dividend_once_per_user uniqueness guard.
--    (Verified against staging 2026-07-19: 8 rows.)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('trade_lots', 'corporate_actions', 'dividend_events')
order by tablename, indexname;

-- 4. DEFERRABLE self-referencing FKs. Expect 2 rows, BOTH with
--    deferrable = true and deferred = true:
--      trade_lots.source_lot_id        -> trade_lots.id
--      corporate_actions.supersedes    -> corporate_actions.id
--
--    These matter because a split writes the superseded lot AND its
--    replacement in one batch; the replacement references the original. FK
--    triggers normally fire at end of statement, which usually works — but
--    breaks the moment the writer chunks the batch. DEFERRED makes ordering
--    irrelevant by contract rather than by luck.
--    NOTE these are TWO DISTINCT attributes. A constraint can be DEFERRABLE
--    but INITIALLY IMMEDIATE, which still checks per-statement and gives none
--    of the benefit. Both must be true, so this emits a verdict rather than
--    two booleans a reader has to interpret correctly under time pressure.
select
  rel.relname       as table_name,
  con.conname       as constraint_name,
  con.condeferrable as is_deferrable,        -- DEFERRABLE clause present
  con.condeferred   as initially_deferred,   -- INITIALLY DEFERRED specifically
  case
    when con.condeferrable and con.condeferred then 'PASS'
    when con.condeferrable and not con.condeferred
      then 'FAIL: DEFERRABLE but INITIALLY IMMEDIATE — still checked per statement'
    else 'FAIL: not deferrable — split batches will violate the self-FK'
  end as verdict
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where con.contype = 'f'
  and rel.relname in ('trade_lots', 'corporate_actions')
  and con.confrelid = con.conrelid   -- self-referencing only
order by rel.relname;

-- 5. CHECK constraints that protect financial correctness. Expect at least:
--      split_needs_ratio        — a ratio-less split would corrupt positions
--      dividend_needs_amount    — a dividend with no rate pays nothing/anything
--      rename_needs_target      — a symbol change with no destination
--      open_lot_has_shares      — a zero-qty open lot pollutes FIFO forever
select rel.relname as table_name, con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where con.contype = 'c'
  and rel.relname in ('trade_lots', 'corporate_actions', 'dividend_events')
order by rel.relname, con.conname;

-- 6. RLS enabled, zero policies — matching 0001-0005. The anon key must read
--    nothing; the service role bypasses RLS. A table with RLS enabled and a
--    permissive policy would silently expose the ledger.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('trade_lots', 'corporate_actions', 'dividend_events', 'symbol_mappings')
order by c.relname;

-- 7. Baseline before backfill. Expect 0 — anything else means the ledger was
--    already written to, and the backfill's "already backfilled" count should
--    account for it.
select
  (select count(*) from trade_lots)        as lots,
  (select count(*) from corporate_actions) as actions,
  (select count(*) from dividend_events)   as dividends;

-- 8. `provenance` operational characteristics.
--
--    Existence alone is not enough — the backfill, the order path and the
--    monitoring query all depend on its DEFAULT, its allowed values and the
--    partial index. Verified together so a partially-correct column cannot
--    pass by satisfying one check and failing another.
--
--    Expect: default 'execution', a CHECK naming all four values, and
--    trade_lots_provenance_idx present as a PARTIAL index.
select
  'default' as property,
  coalesce(column_default, '(none)') as value,
  case when column_default like '%execution%' then 'PASS'
       else 'FAIL: new rows will not default to execution' end as verdict
from information_schema.columns
where table_schema = 'public' and table_name = 'trade_lots' and column_name = 'provenance'

union all

select
  'check_values',
  coalesce((
    select pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'trade_lots' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%provenance%'
    limit 1), '(missing)'),
  case when exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'trade_lots' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%backfill%'
      and pg_get_constraintdef(con.oid) like '%corporate_action%'
      and pg_get_constraintdef(con.oid) like '%seed%'
  ) then 'PASS' else 'FAIL: CHECK missing or does not cover all four values' end

union all

select
  'partial_index',
  coalesce((select indexdef from pg_indexes
             where schemaname = 'public' and indexname = 'trade_lots_provenance_idx'), '(missing)'),
  case when exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'trade_lots_provenance_idx'
      and indexdef like '%WHERE%'
  ) then 'PASS' else 'FAIL: index missing or not partial — the adoption query will scan the table' end;
