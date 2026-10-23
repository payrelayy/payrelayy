\set ON_ERROR_STOP on

-- Run only after deploying the SMS-only inert overlay. Old signed SMS events,
-- payment claims and the earlier cutover stay recorded for Owner review.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv retirement_request_key FETANAGENT_RECEIVER_SMS_RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'retirement_request_key' ~
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

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004)) as serialized
\gset

select singleton as route_locked from app.receiver_sms_route_control
  where singleton for update
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
select count(*) = 7 and bool_and(mode = 'disabled' and settings = '{}'::jsonb)
  and (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and not enabled and cutover_at is not null)
  and not exists (select 1 from app.deposit_jobs
    where job_kind in ('execute_deposit', 'reconcile_execution')
      and status in ('queued', 'leased', 'retry_wait'))
  and not exists (select 1 from app.deposit_execution_attempts
    where status in ('prepared', 'final_action_fenced',
      'reconciliation_required', 'review_required'))
  and not exists (select 1 from app.routine_telebirr_paid_poll_claims
    where claimed_at >= clock_timestamp() - interval '5 minutes')
  and (select count(*) = 3 and bool_and(rolcanlogin)
    from pg_catalog.pg_roles where rolname in (
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  and not exists (select 1 from pg_catalog.pg_stat_activity
    where usename in (
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  as exact_retirement_boundary
from locked_financial_switches
\gset
\if :exact_retirement_boundary
\else
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
  'receiver_sms.incident_receipt_logins_retired', 'database_role',
  jsonb_build_object('requestKey', :'retirement_request_key'::uuid,
    'roleCount', 3, 'historyPreserved', true)
);

select count(*) = 3 and bool_and(not rolcanlogin)
  as exact_receipt_logins_disabled
from pg_catalog.pg_roles where rolname in (
  'fetanagent_routine_telebirr_no_money_runtime',
  'fetanagent_routine_telebirr_paid_poll_runtime',
  'fetanagent_routine_telebirr_paid_settlement_runtime')
\gset
\if :exact_receipt_logins_disabled
\else
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select jsonb_build_object(
  'operation', 'receiver_sms_incident_retire_receipt_logins',
  'deploymentTarget', 'production',
  'rolesDisabled', 3,
  'financialGatesDisabled', true,
  'historyPreserved', true)::text;
