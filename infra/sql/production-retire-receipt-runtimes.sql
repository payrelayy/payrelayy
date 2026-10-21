\set ON_ERROR_STOP on

-- Retire only the three receipt lookup logins. SMS ingestion, signed pairing,
-- Player ID verification, claims, jobs, and financial switches are untouched.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv retirement_request_key FETANAGENT_RECEIPT_RETIREMENT_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'retirement_request_key' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_input
\gset
\if :exact_input
\else
  \warn 'The production receipt-runtime retirement inputs are not exact.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004)) as serialized
\gset

select control.singleton as route_locked from app.receiver_sms_route_control control
  where control.singleton for update
\gset

with locked_financial_switches as materialized (
  select feature_key, mode, settings from app.feature_switches
  where feature_key in (
    'cbe_birr_authoritative_verification', 'deposit_execution',
    'payment_verification', 'private_live_deposit_pilot',
    'telebirr_authoritative_verification', 'withdrawal_collection',
    'withdrawal_validation')
  order by feature_key for update
)
select count(*) = 7 and pg_catalog.bool_and(
  mode = 'disabled' and settings = '{}'::jsonb)
  as locked_financial_boundary
from locked_financial_switches
\gset
\if :locked_financial_boundary
\else
  \warn 'Financial switches are not exactly disabled.'
  select 1 / 0 as rejected;
\endif

select (select count(*) = 1 from app.receiver_sms_route_control control
    where control.singleton and not control.enabled and control.cutover_at is null)
  and not exists (select 1 from app.deposit_jobs job
    where job.status in ('queued','leased','retry_wait'))
  and not exists (select 1 from app.deposit_execution_attempts attempt
    where attempt.status in ('prepared','final_action_fenced',
      'reconciliation_required','review_required'))
  and not exists (select 1 from app.routine_telebirr_paid_poll_claims claim
    where claim.claimed_at >= pg_catalog.clock_timestamp() - interval '5 minutes')
  and (select count(*) = 3 from pg_catalog.pg_roles role
    where role.rolname in (
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  and not exists (select 1 from pg_catalog.pg_stat_activity activity
    where activity.usename in (
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  as retirement_ready
\gset
\if :retirement_ready
\else
  \warn 'Receipt runtimes are active or the stopped production boundary changed.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_routine_telebirr_no_money_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';
alter role fetanagent_routine_telebirr_paid_poll_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';
alter role fetanagent_routine_telebirr_paid_settlement_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';

insert into app.audit_events (
  actor_kind, actor_label, action, resource_type, metadata
) values (
  'system', 'production-database-administrator',
  'receiver_sms.legacy_receipt_runtimes_retired', 'database_role',
  pg_catalog.jsonb_build_object('requestKey', :'retirement_request_key'::uuid,
    'roleCount', 3, 'smsRouteChanged', false, 'financialSwitchChanged', false)
);

select count(*) = 3 and pg_catalog.bool_and(not role.rolcanlogin)
  as roles_disabled
from pg_catalog.pg_roles role
where role.rolname in (
  'fetanagent_routine_telebirr_no_money_runtime',
  'fetanagent_routine_telebirr_paid_poll_runtime',
  'fetanagent_routine_telebirr_paid_settlement_runtime')
\gset
\if :roles_disabled
\else
  select 1 / 0 as rejected;
\endif

commit;

select pg_catalog.jsonb_build_object(
  'operation','retire_receipt_runtimes',
  'deploymentTarget','production','rolesDisabled',3,
  'smsRouteChanged',false,'financialSwitchChanged',false)::text;
