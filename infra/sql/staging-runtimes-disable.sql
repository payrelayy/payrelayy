\set ON_ERROR_STOP on

alter role payreplayy_beta_admission_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

alter role payreplayy_owner_control_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

do $payreplayy$
declare
  expected_role text;
begin
  foreach expected_role in array array[
    'payreplayy_beta_admission_runtime',
    'payreplayy_owner_control_runtime'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_authid as role
      where role.rolname = expected_role
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
      raise exception 'A staging runtime login was not disabled safely.';
    end if;
  end loop;
end
$payreplayy$;
