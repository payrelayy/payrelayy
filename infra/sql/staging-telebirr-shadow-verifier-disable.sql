\set ON_ERROR_STOP on
\getenv confirmed_project_ref STAGING_PROJECT_REF

select :'confirmed_project_ref' = 'spzpiyxheappsfyswewl'
  as staging_target_confirmed
\gset
\if :staging_target_confirmed
\else
  \warn 'The workflow-supplied staging project assertion is missing or incorrect; it does not identify the connected database.'
  select 1 / 0 as rejected;
\endif

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-shadow-verifier-runtime', 0)
);

alter role fetanagent_telebirr_shadow_verifier with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password null valid until 'infinity';
alter role fetanagent_telebirr_shadow_verifier_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

commit;

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
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-shadow-verifier-runtime', 0)
);

do $fetanagent$
declare
  activity_pid integer;
begin
  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      -- A pooled session can end on its own between enumeration and signalling. Treat that exact
      -- disappearance as success, but still fail if the same shadow PID remains observable.
      perform pg_catalog.pg_stat_clear_snapshot();
      if exists (
        select 1
          from pg_catalog.pg_stat_activity activity
         where activity.pid = activity_pid
           and activity.usename in (
             'fetanagent_telebirr_shadow_verifier',
             'fetanagent_telebirr_shadow_verifier_runtime'
           )
      ) then
        raise exception 'A shadow-verifier session could not be terminated safely.';
      end if;
    end if;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) or (select count(*) from pg_catalog.pg_authid role
         where role.rolname in (
           'fetanagent_telebirr_shadow_verifier',
           'fetanagent_telebirr_shadow_verifier_runtime'
         )
           and not role.rolcanlogin
           and not role.rolinherit
           and not role.rolsuper
           and not role.rolcreatedb
           and not role.rolcreaterole
           and not role.rolreplication
           and not role.rolbypassrls
           and role.rolpassword is null) <> 2 then
    raise exception 'The shadow-verifier role disablement is incomplete.';
  end if;
end
$fetanagent$;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'shadow_verifier_runtime_disable',
  'deploymentTarget', 'staging',
  'runtimeLogin', 'disabled',
  'financialSwitchesChanged', false
)::text;

commit;
