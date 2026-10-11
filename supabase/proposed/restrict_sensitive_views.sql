-- PROPOSED ONLY: allocate a migration version after reconciling staging history
-- and the missing 0040-0048 branch migrations. Do not apply remotely yet.
--
-- Views run with their owner's privileges unless explicitly configured otherwise.
-- RLS and revocations on the underlying tables therefore do not protect these
-- financial/control-plane projections from Supabase's default view grants.
-- Server-side service-role access remains available; no rows or definitions change.
-- Reversible via GRANT, but restoring public access is not a safe rollback.
begin;
do $$
declare
  view_name text;
begin
  foreach view_name in array array[
    'ledger_imbalance', 'payments_missing_ledger',
    'ftx_settled_without_ledger', 'ftx_completed_without_evidence',
    'ftx_stale_in_flight', 'ftx_awaiting_review',
    'cp_settled_without_evidence', 'cp_settled_without_approval',
    'cp_indeterminate_executions', 'cp_recipient_settled'
  ] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=view_name and c.relkind='v') then
      raise exception 'Expected sensitive view is absent: %', view_name;
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated', view_name);
    execute format('grant select on public.%I to service_role', view_name);
  end loop;
end $$;
commit;
