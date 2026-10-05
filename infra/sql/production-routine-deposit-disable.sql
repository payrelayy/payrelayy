\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv disable_request_key FETANAGENT_ROUTINE_DISABLE_REQUEST_KEY
\getenv disable_reason FETANAGENT_ROUTINE_DISABLE_REASON

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'disable_request_key' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'disable_reason' in ('operator_requested', 'incident_stop', 'rotation')
  as exact_disable_input
\gset
\if :exact_disable_input
\else
  \warn 'The exact production routine-deposit disable inputs are required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '20s';

select app.disable_routine_telebirr_execution_transport(
  :'disable_request_key'::uuid,
  :'disable_reason'::text
);
commit;

select pg_catalog.pg_terminate_backend(activity.pid, 5000)
  from pg_catalog.pg_stat_activity activity
 where activity.usename = 'fetanagent_routine_deposit_broker_runtime'
   and activity.pid <> pg_catalog.pg_backend_pid();

select not role.rolcanlogin and role.rolpassword is null
  and not pg_catalog.pg_has_role(
    'fetanagent_routine_deposit_broker_runtime',
    'fetanagent_routine_deposit_broker', 'member'
  ) as runtime_disabled
  from pg_catalog.pg_authid role
 where role.rolname = 'fetanagent_routine_deposit_broker_runtime'
\gset
\if :runtime_disabled
\else
  \warn 'The routine-deposit runtime disable did not complete.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'routine_deposit_disable',
  'deploymentTarget', 'production',
  'runtimeLogin', 'disabled',
  'providerOutcomeRequiresReconciliation', true
)::text;
