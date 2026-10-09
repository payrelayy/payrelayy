\set ON_ERROR_STOP on

-- This first disables the two shared switches. Existing fenced attempts still
-- require reconciliation; this file does not erase an attempt or role credential.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv stop_request_key FETANAGENT_ROUTINE_FINANCIAL_REQUEST_KEY
\getenv stop_reason FETANAGENT_ROUTINE_FINANCIAL_STOP_REASON

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'stop_request_key' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'stop_reason' in ('operator_requested', 'incident_stop')
  as exact_input
\gset
\if :exact_input
\else
  \warn 'The exact routine financial stop inputs are required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select app.stop_routine_telebirr_financial_gates(
  :'stop_request_key'::uuid, :'stop_reason'::text
) as changed
\gset

select pg_catalog.count(*) = 2 and pg_catalog.bool_and(
  switch.mode = 'disabled' and switch.settings = '{}'::jsonb
) as stopped
from app.feature_switches switch
where switch.feature_key in ('payment_verification', 'deposit_execution')
\gset
\if :stopped
\else
  \warn 'The routine financial gates are not stopped.'
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1, 'operation', 'routine_telebirr_financial_stop',
  'deploymentTarget', 'production', 'financialGatesDisabled', true,
  'existingAttemptsRequireReconciliation', true)::text;
