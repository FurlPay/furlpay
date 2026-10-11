-- Metadata only. No application rows, credentials, function bodies or data writes.
begin transaction read only;
set local statement_timeout = '10s';
select jsonb_build_object(
  'formatVersion', 1,
  'tables', coalesce((select jsonb_agg(jsonb_build_object(
    'name', c.relname,
    'schema', n.nspname,
    'rlsEnabled', c.relrowsecurity,
    'rlsForced', c.relforcerowsecurity,
    'extension', (select e.extname from pg_depend d join pg_extension e on e.oid=d.refobjid
      where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e' limit 1),
    'columns', (select jsonb_agg(jsonb_build_object('name', a.attname,
      'type', format_type(a.atttypid,a.atttypmod), 'notNull', a.attnotnull,
      'identity', a.attidentity, 'generated', a.attgenerated) order by a.attnum)
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints', coalesce((select jsonb_agg(jsonb_build_object('name', k.conname,
      'type', k.contype, 'definition', pg_get_constraintdef(k.oid), 'validated', k.convalidated)
      order by k.conname) from pg_constraint k where k.conrelid=c.oid), '[]'::jsonb),
    'indexes', coalesce((select jsonb_agg(jsonb_build_object('name', ic.relname,
      'definition', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid) order by ic.relname)
      from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('name', p.policyname,
      'roles', p.roles, 'command', p.cmd, 'using', p.qual, 'check', p.with_check)
      order by p.policyname) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname), '[]'::jsonb),
    'privileges', (select jsonb_object_agg(r.rolname, jsonb_build_object(
      'select', has_table_privilege(r.oid,c.oid,'SELECT'),
      'insert', has_table_privilege(r.oid,c.oid,'INSERT'),
      'update', has_table_privilege(r.oid,c.oid,'UPDATE'),
      'delete', has_table_privilege(r.oid,c.oid,'DELETE'),
      'bypassRls', r.rolbypassrls)) from pg_roles r where r.rolname in ('anon','authenticated','service_role'))
  ) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')), '[]'::jsonb),
  'foreignKeysWithoutLeadingIndex', coalesce((select jsonb_agg(jsonb_build_object(
    'table', t.relname, 'constraint', k.conname, 'definition', pg_get_constraintdef(k.oid)) order by t.relname,k.conname)
    from pg_constraint k join pg_class t on t.oid=k.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and k.contype='f' and not exists (
      select 1 from pg_index i where i.indrelid=k.conrelid and i.indisvalid and i.indpred is null
      and array(select key::smallint from unnest(i.indkey) with ordinality as x(key,position)
        where position<=cardinality(k.conkey) order by position)=k.conkey
    )), '[]'::jsonb),
  'views', coalesce((select jsonb_agg(jsonb_build_object('name', c.relname, 'options', c.reloptions,
    'select', (select jsonb_object_agg(r.rolname,has_table_privilege(r.oid,c.oid,'SELECT'))
      from pg_roles r where r.rolname in ('anon','authenticated','service_role')))
    order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m') and not exists (select 1 from pg_depend d
      where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(jsonb_build_object('name', p.proname,
    'arguments', pg_get_function_identity_arguments(p.oid), 'securityDefiner', p.prosecdef,
    'execute', (select jsonb_object_agg(r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE'))
      from pg_roles r where r.rolname in ('anon','authenticated','service_role')))
    order by p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists (select 1 from pg_depend d
      where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')), '[]'::jsonb)
) as catalog;
rollback;
