-- Read-only schema comparison for the staging CBE migration rehearsal.
-- Returns no customer rows, function bodies, role credentials, or receiver values.
-- Run once on staging and once after the 87-file disposable baseline.
with objects as (
  select 'relations'::text as category,
         c.relname::text as identity,
         concat_ws('|', c.relkind, c.relpersistence, c.relrowsecurity,
                   c.relforcerowsecurity, c.relispartition,
                   coalesce(c.reloptions::text, '')) as definition
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'columns', c.relname || '.' || a.attnum::text || '.' || a.attname,
         concat_ws('|', pg_catalog.format_type(a.atttypid, a.atttypmod),
                   a.attnotnull, a.attgenerated, a.attidentity,
                   coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''))
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'app' and c.relkind in ('r', 'p', 'v', 'm')
     and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraints', c.conname || '.' ||
         case when c.conrelid <> 0 then c.conrelid::regclass::text
              else c.contypid::regtype::text end,
         concat_ws('|', c.contype,
                   pg_catalog.pg_get_constraintdef(c.oid, true))
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'app'
  union all
  select 'indexes', i.indexrelid::regclass::text,
         pg_catalog.pg_get_indexdef(i.indexrelid)
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app'
  union all
  select 'functions', p.proname || '(' ||
         pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
         pg_catalog.pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prokind in ('f', 'p', 'w')
  union all
  select 'triggers', c.relname || '.' || t.tgname,
         pg_catalog.pg_get_triggerdef(t.oid)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and not t.tgisinternal
  union all
  select 'policies', c.relname || '.' || p.polname,
         concat_ws('|', p.polcmd, p.polpermissive,
                   coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
                   coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), ''),
                   coalesce((select pg_catalog.string_agg(role_name, ',' order by role_name)
                               from (select case when role_oid = 0 then 'PUBLIC'
                                                 else pg_catalog.pg_get_userbyid(role_oid)
                                            end as role_name
                                       from pg_catalog.unnest(p.polroles) role_oid) roles), ''))
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app'
  union all
  select 'enums', t.typname || '.' || e.enumsortorder::text, e.enumlabel::text
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app'
)
select category,
       pg_catalog.count(*)::integer as object_count,
       pg_catalog.md5(pg_catalog.string_agg(identity || E'\x1f' || definition,
                                          E'\x1e' order by identity)) as definition_md5
  from objects
 group by category
 order by category;
