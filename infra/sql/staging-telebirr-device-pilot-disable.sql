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
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-device-pilot-runtime', 0)
);

alter role fetanagent_telebirr_assignment_broker with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password null valid until 'infinity';
alter role fetanagent_telebirr_assignment_broker_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';
alter role fetanagent_telebirr_device_state with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password null valid until 'infinity';
alter role fetanagent_telebirr_device_state_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

-- Make NOLOGIN and password revocation visible before terminating pooled sessions. Keeping the
-- ALTER ROLE statements and termination loop in one transaction permits a disconnected pooler
-- client to authenticate again against the still-visible pre-transaction role state.
commit;

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-device-pilot-runtime', 0)
);

do $fetanagent$
declare
  activity_pid integer;
begin
  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime',
       'fetanagent_telebirr_device_state',
       'fetanagent_telebirr_device_state_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A TeleBirr device-pilot session could not be terminated safely.';
    end if;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime',
       'fetanagent_telebirr_device_state',
       'fetanagent_telebirr_device_state_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A TeleBirr device-pilot session remains after disablement.';
  end if;

  if (
    select count(*)
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime',
       'fetanagent_telebirr_device_state',
       'fetanagent_telebirr_device_state_runtime'
     )
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolpassword is null
  ) <> 4 then
    raise exception 'The TeleBirr device-pilot roles were not disabled safely.';
  end if;
end
$fetanagent$;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'device_pilot_runtime_disable',
  'assignmentBroker', 'disabled_ready',
  'deviceStateBroker', 'disabled_ready'
)::text;

commit;
