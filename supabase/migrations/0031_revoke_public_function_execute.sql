-- ---------------------------------------------------------------------------
-- 0031 — No public-schema function is callable by anon or authenticated.
--
-- SEC-P2-005. Postgres grants EXECUTE on every new function to PUBLIC, and
-- Supabase's default privileges also grant it to anon and authenticated, and
-- PostgREST publishes every function those roles can execute at
-- /rest/v1/rpc/<name>. Several migrations never revoked it, among them
-- SECURITY DEFINER functions that bypass RLS:
--
--   ledger_post            0009  write arbitrary ledger transactions, or take
--                                the single reversal slot of a real one so the
--                                genuine refund can never post
--   settle_payment_atomic  0009  settle a pending payment
--   ftx_transition         0014  advance a financial transaction's state
--   claim_webhook_event    0022/0024  pre-claim a provider event id with a
--   mark_webhook_processed 0022       wrong hash, or mark it processed, so the
--   mark_webhook_failed    0022       real delivery (e.g. a deposit) is dropped
--   prune_notifications    0011
--
-- The app reaches Postgres only with the service-role key (0020, 0030), and
-- FurlPay ships no anon key to any client, so this is not reachable today
-- without that key. But Supabase treats the anon key as public, so it is not a
-- secret that a money path should depend on. 0030 already fixed this for its
-- own three functions and named the problem; this applies it to all of them.
--
-- WHAT THIS DOES.
--   1. Every function and procedure in schema public that is not owned by an
--      extension: EXECUTE revoked from PUBLIC, anon and authenticated, granted
--      to service_role. Extension functions (e.g. PostGIS) are left alone.
--   2. Default privileges for functions created later by this role: the same
--      revoke, so the next migration cannot reintroduce the gap by omission.
--
-- Trigger functions are covered too, harmlessly: EXECUTE is checked when a
-- trigger is created, not when it fires.
--
-- Role checks keep the file applicable to plain Postgres (the PGlite test
-- harness), where the Supabase roles may not exist.
-- Forward-only and idempotent; no data is touched.
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
  r text;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke all on routine %s from public', f.sig);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on routine %s from %I', f.sig, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on routine %s to service_role', f.sig);
    end if;
  end loop;

  -- PUBLIC's EXECUTE is a GLOBAL default, and a per-schema ALTER DEFAULT
  -- PRIVILEGES can only add to the global defaults, never take from them —
  -- so this one must be the global form. Supabase's anon/authenticated grants
  -- are per-schema, so those are revoked per-schema.
  execute 'alter default privileges revoke execute on routines from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges in schema public revoke execute on routines from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'alter default privileges in schema public grant execute on routines to service_role';
  end if;
end;
$$;
