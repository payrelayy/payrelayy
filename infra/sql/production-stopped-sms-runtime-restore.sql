\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv customer_web_password CUSTOMER_WEB_RUNTIME_PASSWORD
\getenv owner_password OWNER_CONTROL_RUNTIME_PASSWORD
\getenv player_action_password PLAYER_ACTION_RUNTIME_PASSWORD
\getenv assignment_password TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD
\getenv device_state_password TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  as exact_administrator
\gset
\if :exact_administrator
\else
  \warn 'The stopped SMS runtime restore requires the exact production administrator.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:production:nonfinancial-runtimes', 0));
select singleton from app.receiver_sms_route_control where singleton for update;

select count(*) = 7 and pg_catalog.bool_and(
  mode = 'disabled' and settings = '{}'::jsonb) as financial_boundary
from app.feature_switches
where feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :financial_boundary
\else
  \warn 'All seven financial switches must be exactly disabled.'
  select 1 / 0 as rejected;
\endif

select (select count(*) = 1 from app.receiver_sms_route_control
    where singleton and not enabled and cutover_at is null)
  and not exists (select 1 from app.deposit_jobs
    where status in ('queued', 'leased', 'retry_wait'))
  and not exists (select 1 from app.deposit_execution_attempts
    where status in ('prepared', 'final_action_fenced',
      'reconciliation_required', 'review_required'))
  and not exists (select 1 from app.routine_telebirr_paid_poll_claims
    where claimed_at >= pg_catalog.clock_timestamp() - interval '5 minutes')
  and not exists (select 1 from pg_catalog.pg_stat_activity
    where usename in (
      'fetanagent_receiver_sms_ingest_runtime',
      'fetanagent_receiver_sms_settlement_runtime',
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime'))
  and not exists (select 1 from pg_catalog.pg_stat_activity
    where usename in (
      'fetanagent_customer_web_runtime',
      'fetanagent_owner_control_runtime',
      'fetanagent_player_actions_runtime',
      'fetanagent_telebirr_assignment_broker_runtime',
      'fetanagent_telebirr_device_state_runtime',
      'fetanagent_companion_device_bridge_runtime')
      and (state is distinct from 'idle' or xact_start is not null
        or state_change > pg_catalog.clock_timestamp() - interval '30 seconds'))
  and (select count(*) = 4 from pg_catalog.pg_roles
    where rolname in (
      'fetanagent_beta_admission_runtime',
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime')
      and not rolcanlogin)
  as stopped_boundary
\gset
\if :stopped_boundary
\else
  \warn 'The app is not at the exact stopped SMS production boundary.'
  select 1 / 0 as rejected;
\endif

-- The pooler may keep a stopped app's old idle sessions. Terminate only those
-- exact, idle, non-transactional sessions before restoring their credentials.
with stale as materialized (
  select pid from pg_catalog.pg_stat_activity
  where usename in (
    'fetanagent_customer_web_runtime', 'fetanagent_owner_control_runtime',
    'fetanagent_player_actions_runtime',
    'fetanagent_telebirr_assignment_broker_runtime',
    'fetanagent_telebirr_device_state_runtime',
    'fetanagent_companion_device_bridge_runtime')
    and state = 'idle' and xact_start is null
    and state_change <= pg_catalog.clock_timestamp() - interval '30 seconds'
), terminated as (
  select pg_catalog.pg_terminate_backend(pid, 1000) as ok from stale
)
select coalesce(pg_catalog.bool_and(ok), true) as stale_sessions_closed
from terminated
\gset
\if :stale_sessions_closed
\else
  \warn 'A stopped app pooler session could not be closed.'
  select 1 / 0 as rejected;
\endif

select not exists (select 1 from pg_catalog.pg_stat_activity
  where usename in (
    'fetanagent_customer_web_runtime', 'fetanagent_owner_control_runtime',
    'fetanagent_player_actions_runtime',
    'fetanagent_telebirr_assignment_broker_runtime',
    'fetanagent_telebirr_device_state_runtime',
    'fetanagent_companion_device_bridge_runtime')) as no_old_sessions
\gset
\if :no_old_sessions
\else
  \warn 'A stopped app runtime session is still connected.'
  select 1 / 0 as rejected;
\endif

select :'customer_web_password' ~ '^[0-9a-f]{64}$'
  and :'owner_password' ~ '^[0-9a-f]{64}$'
  and :'player_action_password' ~ '^[0-9a-f]{64}$'
  and :'assignment_password' ~ '^[0-9a-f]{64}$'
  and :'device_state_password' ~ '^[0-9a-f]{64}$'
  and (select count(distinct supplied.credential) = 5 from pg_catalog.unnest(array[
    :'customer_web_password', :'owner_password', :'player_action_password',
    :'assignment_password', :'device_state_password']) as supplied(credential))
  as credentials_canonical
\gset
\if :credentials_canonical
\else
  \warn 'Five distinct production runtime credentials are required.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
declare expected record;
begin
  for expected in
    select * from (values
      ('fetanagent_customer_web', 'fetanagent_customer_web_runtime', 2),
      ('fetanagent_owner_control', 'fetanagent_owner_control_runtime', 1),
      ('fetanagent_player_actions', 'fetanagent_player_actions_runtime', 2),
      ('fetanagent_telebirr_assignment_broker',
        'fetanagent_telebirr_assignment_broker_runtime', 1),
      ('fetanagent_telebirr_device_state', 'fetanagent_telebirr_device_state_runtime', 1)
    ) as roles(group_name, runtime_name, connection_limit)
  loop
    if not exists (select 1 from pg_catalog.pg_roles role
      where role.rolname = expected.group_name and not role.rolcanlogin
        and not role.rolinherit and not role.rolsuper and not role.rolcreatedb
        and not role.rolcreaterole and not role.rolreplication
        and not role.rolbypassrls)
      or not exists (select 1 from pg_catalog.pg_authid role
        where role.rolname = expected.runtime_name and not role.rolcanlogin
          and role.rolpassword is null and not role.rolinherit
          and not role.rolsuper and not role.rolcreatedb
          and not role.rolcreaterole and not role.rolreplication
          and not role.rolbypassrls and role.rolconnlimit = expected.connection_limit)
      or (select count(*) from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
        where member_role.rolname = expected.runtime_name) <> 1
      or not exists (select 1 from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
        where granted_role.rolname = expected.group_name
          and member_role.rolname = expected.runtime_name
          and membership.inherit_option and not membership.set_option
          and not membership.admin_option)
    then
      raise exception 'A current SMS app runtime role is outside its stopped scaffold.';
    end if;
  end loop;
end
$fetanagent$;

alter role fetanagent_customer_web_runtime with login password :'customer_web_password' valid until 'infinity';
alter role fetanagent_owner_control_runtime with login password :'owner_password' valid until 'infinity';
alter role fetanagent_player_actions_runtime with login password :'player_action_password' valid until 'infinity';
alter role fetanagent_telebirr_assignment_broker_runtime with login password :'assignment_password' valid until 'infinity';
alter role fetanagent_telebirr_device_state_runtime with login password :'device_state_password' valid until 'infinity';

select count(*) = 5 and pg_catalog.bool_and(rolcanlogin
    and rolvaliduntil = 'infinity'::timestamptz) as current_roles_restored
from pg_catalog.pg_roles where rolname in (
  'fetanagent_customer_web_runtime', 'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
  'fetanagent_telebirr_assignment_broker_runtime',
  'fetanagent_telebirr_device_state_runtime')
\gset
\if :current_roles_restored
\else
  select 1 / 0 as rejected;
\endif

commit;
\echo 'Five current SMS app logins restored; beta admission and receipt logins remain disabled.'
