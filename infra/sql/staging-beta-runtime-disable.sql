\set ON_ERROR_STOP on

alter role payreplayy_beta_admission_runtime with
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password null
  valid until 'infinity';

do $payreplayy$
begin
  if not exists (
    select 1
    from pg_catalog.pg_authid as role
    where role.rolname = 'payreplayy_beta_admission_runtime'
      and not role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolpassword is null
  ) then
    raise exception 'The staging beta-admission runtime login was not disabled safely.';
  end if;
end
$payreplayy$;
