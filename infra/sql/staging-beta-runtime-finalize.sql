\set ON_ERROR_STOP on

alter role payreplayy_beta_admission_runtime valid until 'infinity';

do $payreplayy$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'payreplayy_beta_admission_runtime'
      and role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolvaliduntil = 'infinity'::timestamptz
  ) then
    raise exception 'The staging beta-admission runtime could not be finalized safely.';
  end if;
end
$payreplayy$;
