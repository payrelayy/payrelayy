\set ON_ERROR_STOP on

-- Move the already-stopped shared gates to the exact seven-switch SMS restart
-- boundary. The existing database function preserves claims, jobs and history.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv stop_request_key FETANAGENT_RECEIVER_SMS_RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'stop_request_key' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_input
\gset
\if :exact_input
\else
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select count(*) = 7
  and count(*) filter (where feature_key = 'cbe_birr_authoritative_verification'
    and mode = 'live' and settings = '{}'::jsonb) = 1
  and count(*) filter (where feature_key <> 'cbe_birr_authoritative_verification'
    and mode = 'disabled' and settings = '{}'::jsonb) = 6
  and (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and enabled and cutover_at is not null)
  and not exists (select 1 from app.deposit_jobs
    where job_kind in ('execute_deposit', 'reconcile_execution')
      and status in ('queued', 'leased', 'retry_wait'))
  and not exists (select 1 from app.deposit_execution_attempts
    where status in ('prepared', 'final_action_fenced',
      'reconciliation_required', 'review_required'))
  as exact_incident_boundary
from app.feature_switches
where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_incident_boundary
\else
  select 1 / 0 as rejected;
\endif

select cutover_at::text as previous_cutover
from app.receiver_sms_route_control where singleton
\gset

select app.stop_receiver_sms_financial_gates(
  :'stop_request_key'::uuid, 'operator_requested'
) as changed
\gset
\if :changed
\else
  select 1 / 0 as rejected;
\endif

select count(*) = 7 and bool_and(mode = 'disabled' and settings = '{}'::jsonb)
  and (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and not enabled and cutover_at = :'previous_cutover'::timestamptz)
  as exact_stopped_boundary
from app.feature_switches
where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_stopped_boundary
\else
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select jsonb_build_object(
  'operation', 'receiver_sms_incident_stop',
  'deploymentTarget', 'production',
  'financialGatesDisabled', true,
  'smsRouteDisabled', true,
  'historyPreserved', true)::text;
