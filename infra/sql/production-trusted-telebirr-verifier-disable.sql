\set ON_ERROR_STOP on

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:trusted-telebirr-verifier-runtime', 0)
);

alter role fetanagent_trusted_telebirr_verifier with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password null valid until 'infinity';
alter role fetanagent_trusted_telebirr_verifier_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

commit;

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:trusted-telebirr-verifier-runtime', 0)
);

do $fetanagent$
declare
  activity_pid integer;
begin
  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A production verifier session could not be terminated safely.';
    end if;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     ) and activity.pid <> pg_catalog.pg_backend_pid()
  ) or (select count(*) from pg_catalog.pg_authid role
         where role.rolname in (
           'fetanagent_trusted_telebirr_verifier',
           'fetanagent_trusted_telebirr_verifier_runtime'
         ) and not role.rolcanlogin and role.rolpassword is null) <> 2 then
    raise exception 'The production verifier role disablement is incomplete.';
  end if;
end
$fetanagent$;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'verifier_emergency_disable',
  'deploymentTarget', 'production',
  'verifierLogin', 'disabled',
  'financialSwitchesChanged', false
)::text;

commit;
