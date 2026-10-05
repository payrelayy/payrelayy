\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv owner_auth_user_id FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID
\getenv certificate_id FETANAGENT_ROUTINE_COMPANION_CERTIFICATE_ID
\getenv activation_request_key FETANAGENT_ROUTINE_ACTIVATION_REQUEST_KEY
\getenv runtime_password FETANAGENT_ROUTINE_RUNTIME_PASSWORD

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'owner_auth_user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'certificate_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'activation_request_key' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'runtime_password' ~ '^[0-9a-f]{64}$'
  as exact_activation_input
\gset
\if :exact_activation_input
\else
  \warn 'The exact production routine-deposit activation inputs are required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '20s';

select app.activate_routine_telebirr_execution_transport(
  :'owner_auth_user_id'::uuid,
  :'certificate_id'::uuid,
  :'activation_request_key'::uuid,
  :'runtime_password'::text
) as valid_until
\gset

select app.routine_telebirr_runtime_is_active(null) as routine_runtime_active
\gset
\if :routine_runtime_active
\else
  \warn 'The routine-deposit runtime did not become active.'
  select 1 / 0 as rejected;
\endif
commit;
\unset runtime_password

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'routine_deposit_activate',
  'deploymentTarget', 'production',
  'runtimeLogin', 'active',
  'validUntil', :'valid_until'::timestamptz,
  'livePaymentPerformed', false
)::text;
