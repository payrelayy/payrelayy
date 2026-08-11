\set ON_ERROR_STOP on

begin;

set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '5s';

do $payreplayy$
begin
  execute pg_catalog.format(
    'alter role payreplayy_beta_admission_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '20 minutes'
  );

  if not exists (
    select 1
    from pg_catalog.pg_authid as role
    where role.rolname = 'payreplayy_beta_admission_runtime'
      and role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolpassword like 'SCRAM-SHA-256$%'
      and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '19 minutes'
      and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '20 minutes 5 seconds'
  ) then
    raise exception 'The temporary staging beta-admission credential was not stored in the expected SCRAM state.';
  end if;
end
$payreplayy$;

commit;
