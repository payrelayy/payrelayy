\set ON_ERROR_STOP on

-- A single, money-capable operator call. The migration only installed the
-- dormant function; this script performs the reviewed recovery transaction.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv owner_auth_user_id FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID
\getenv activation_request_key FETANAGENT_RECEIVER_SMS_RESUME_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'owner_auth_user_id' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'activation_request_key' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_input
\gset
\if :exact_input
\else
  select 1 / 0 as rejected;
\endif

-- Require the reviewed resume body that expects the paid receipt logins to
-- already be retired. The original one-use function expected live logins.
select count(*) = 1 and bool_and(
    encode(sha256(convert_to(routine.prosrc, 'UTF8')), 'hex') =
      '3516e005212b34f9c98cea4a175dd0a940416267cbe0230ebafd847aa127c6a9'
    and routine.proowner = 'postgres'::regrole
    and not routine.prosecdef
    and routine.proconfig = array['search_path=pg_catalog']::text[]
    and not has_function_privilege('public', routine.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    and not has_function_privilege('service_role', routine.oid, 'EXECUTE'))
  as exact_resume_function
from pg_catalog.pg_proc routine
where routine.oid = to_regprocedure(
  'app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid)')::oid
\gset
\if :exact_resume_function
\else
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select cutover_at::text as prior_cutover
from app.receiver_sms_route_control where singleton and enabled
\gset

select app.resume_receiver_sms_cbe_stopped_financial_gates(
  :'owner_auth_user_id'::uuid, :'activation_request_key'::uuid
)::text as new_cutover
\gset

select count(*) = 7
  and count(*) filter (where feature_key in (
    'cbe_birr_authoritative_verification', 'payment_verification',
    'deposit_execution') and mode = 'live' and settings = '{}'::jsonb) = 3
  and count(*) filter (where feature_key in (
    'private_live_deposit_pilot', 'telebirr_authoritative_verification',
    'withdrawal_collection', 'withdrawal_validation')
    and mode = 'disabled' and settings = '{}'::jsonb) = 4
  and (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and enabled and cutover_at = :'new_cutover'::timestamptz
      and cutover_at > :'prior_cutover'::timestamptz)
  and (select count(*) = 2 and bool_and(not rolcanlogin)
    from pg_catalog.pg_roles where rolname in (
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  and not exists (select 1 from app.deposit_jobs
    where job_kind in ('execute_deposit', 'reconcile_execution')
      and status in ('queued', 'leased', 'retry_wait'))
  and not exists (select 1 from app.deposit_execution_attempts attempt
    where attempt.status in ('prepared', 'final_action_fenced',
      'reconciliation_required')
      or (attempt.status = 'review_required'
        and not attempt.routine_review_isolated))
  as exact_resumed_boundary
from app.feature_switches where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_resumed_boundary
\else
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select jsonb_build_object(
  'operation', 'receiver_sms_cbe_stopped_resume',
  'deploymentTarget', 'production',
  'moneyCapable', true,
  'livePaymentPerformed', false,
  'cbeMode', 'live',
  'freshCutover', true,
  'retiredPaidReceiptRoles', 2)::text;
