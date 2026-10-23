\set ON_ERROR_STOP on

-- The reviewed database function checks current Owner authority, paired SMS
-- evidence for both providers, an idle signed worker, runtime roles and ledger.
-- Its switch trigger additionally requires a running independent watchdog.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv owner_auth_user_id FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID
\getenv activation_request_key FETANAGENT_RECEIVER_SMS_RECOVERY_REQUEST_KEY

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

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select count(*) = 7 and bool_and(mode = 'disabled' and settings = '{}'::jsonb)
  and (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and not enabled and cutover_at is not null)
  and (select count(*) = 3 and bool_and(not rolcanlogin)
    from pg_catalog.pg_roles where rolname in (
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  as exact_stopped_boundary
from app.feature_switches where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_stopped_boundary
\else
  select 1 / 0 as rejected;
\endif

select cutover_at::text as prior_cutover
from app.receiver_sms_route_control where singleton
\gset

select app.activate_receiver_sms_financial_gates(
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
    where singleton and enabled
      and cutover_at = :'new_cutover'::timestamptz
      and cutover_at > :'prior_cutover'::timestamptz)
  as exact_live_boundary
from app.feature_switches where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_live_boundary
\else
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select jsonb_build_object(
  'operation', 'receiver_sms_incident_activate',
  'deploymentTarget', 'production',
  'moneyCapable', true,
  'livePaymentPerformed', false,
  'cbeMode', 'live',
  'freshCutover', true)::text;
