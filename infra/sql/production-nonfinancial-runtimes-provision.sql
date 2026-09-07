\set ON_ERROR_STOP on
\getenv beta_runtime_password BETA_ADMISSION_RUNTIME_PASSWORD
\getenv customer_web_runtime_password CUSTOMER_WEB_RUNTIME_PASSWORD
\getenv owner_runtime_password OWNER_CONTROL_RUNTIME_PASSWORD
\getenv player_action_runtime_password PLAYER_ACTION_RUNTIME_PASSWORD
\getenv assignment_runtime_password TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD
\getenv device_state_runtime_password TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '20s';

select current_user = 'postgres' and session_user = 'postgres' as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:nonfinancial-runtimes', 0)
);

select :'beta_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'customer_web_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'owner_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'player_action_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'assignment_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'device_state_runtime_password' ~ '^[0-9a-f]{64}$'
   and pg_catalog.array_length(
     pg_catalog.array(
       select distinct value from pg_catalog.unnest(array[
         :'beta_runtime_password', :'customer_web_runtime_password',
         :'owner_runtime_password', :'player_action_runtime_password',
         :'assignment_runtime_password', :'device_state_runtime_password'
       ]) as value
     ), 1
   ) = 6 as credentials_canonical
\gset
\if :credentials_canonical
\else
  \warn 'Production runtime credentials must be six distinct lowercase 32-byte hexadecimal values.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
declare
  expected record;
begin
  for expected in
    select * from (values
      ('fetanagent_beta_admission', 'fetanagent_beta_admission_runtime', 1),
      ('fetanagent_customer_web', 'fetanagent_customer_web_runtime', 2),
      ('fetanagent_owner_control', 'fetanagent_owner_control_runtime', 1),
      ('fetanagent_player_actions', 'fetanagent_player_actions_runtime', 2),
      ('fetanagent_telebirr_assignment_broker', 'fetanagent_telebirr_assignment_broker_runtime', 1),
      ('fetanagent_telebirr_device_state', 'fetanagent_telebirr_device_state_runtime', 1)
    ) as roles(group_name, runtime_name, connection_limit)
  loop
    if not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname = expected.group_name
         and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
    ) or not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname = expected.runtime_name
         and not role.rolinherit and not role.rolsuper and not role.rolcreatedb
         and not role.rolcreaterole and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = expected.connection_limit
    ) then
      raise exception 'A production runtime role is absent or outside its least-privilege scaffold.';
    end if;

    if (select count(*) from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname = expected.runtime_name) <> 1
       or not exists (
         select 1 from pg_catalog.pg_auth_members membership
           join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
           join pg_catalog.pg_roles member_role on member_role.oid = membership.member
          where granted_role.rolname = expected.group_name
            and member_role.rolname = expected.runtime_name
            and membership.inherit_option and not membership.set_option
            and not membership.admin_option
       ) then
      raise exception 'A production runtime role membership is not exact.';
    end if;
  end loop;

  if (select count(*) from app.feature_switches
       where feature_key in (
         'payment_verification', 'deposit_execution', 'withdrawal_validation',
         'withdrawal_collection', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification', 'cbe_birr_authoritative_verification'
       ) and mode = 'disabled' and settings = '{}'::jsonb) <> 7
     or exists (select 1 from app.feature_switches where mode <> 'disabled') then
    raise exception 'Production non-financial runtimes require every financial switch to be disabled.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles
     where rolname in ('fetanagent_deposit_executor_runtime', 'fetanagent_trusted_telebirr_verifier_runtime')
       and rolcanlogin
  ) then
    raise exception 'Financial runtime logins must remain disabled.';
  end if;
end
$fetanagent$;

alter role fetanagent_beta_admission_runtime with login password :'beta_runtime_password' valid until 'infinity';
alter role fetanagent_customer_web_runtime with login password :'customer_web_runtime_password' valid until 'infinity';
alter role fetanagent_owner_control_runtime with login password :'owner_runtime_password' valid until 'infinity';
alter role fetanagent_player_actions_runtime with login password :'player_action_runtime_password' valid until 'infinity';
alter role fetanagent_telebirr_assignment_broker_runtime with login password :'assignment_runtime_password' valid until 'infinity';
alter role fetanagent_telebirr_device_state_runtime with login password :'device_state_runtime_password' valid until 'infinity';

select count(*) = 6
   and pg_catalog.bool_and(
     rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
     and not rolcreaterole and not rolreplication and not rolbypassrls
     and rolvaliduntil = 'infinity'::timestamptz
   ) as runtime_postcondition
from pg_catalog.pg_roles
where rolname in (
  'fetanagent_beta_admission_runtime', 'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime', 'fetanagent_player_actions_runtime',
  'fetanagent_telebirr_assignment_broker_runtime', 'fetanagent_telebirr_device_state_runtime'
)
\gset
\if :runtime_postcondition
\else
  \warn 'The continuous production runtime postcondition was not installed.'
  select 1 / 0 as rejected;
\endif

commit;
\echo 'Six continuous non-financial production logins are ready; all financial authority remains disabled.'
