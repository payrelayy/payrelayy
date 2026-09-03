\set ON_ERROR_STOP on

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

-- Serialize this boundary with future broker provisioning/disablement operations. These are stable
-- protocol namespace constants, not a date, duration, or automatic shutdown time.
select pg_catalog.pg_advisory_xact_lock(1178948673, 1413632594);

-- Lock the seven disabled financial/provider gates so this emergency action cannot overlap an
-- activation. The aggregate is captured by psql without emitting the individual rows, and the
-- action changes no feature switch itself.
select count(*) = 7
    and pg_catalog.bool_and(locked_feature.mode = 'disabled')
      as financial_features_disabled
from (
  select feature_switch.mode
  from app.feature_switches as feature_switch
  where feature_switch.feature_key in (
    'payment_verification',
    'deposit_execution',
    'withdrawal_validation',
    'withdrawal_collection',
    'cbe_birr_authoritative_verification',
    'telebirr_authoritative_verification',
    'private_live_deposit_pilot'
  )
  for update
) as locked_feature
\gset
\if :financial_features_disabled
\else
  \warn 'Every financial and provider feature must remain disabled for broker disablement.'
  select 1 / 0 as rejected;
\endif

select count(*) = 2 as exact_roles_exist
from pg_catalog.pg_roles as role
where role.rolname in (
  'fetanagent_telebirr_assignment_broker',
  'fetanagent_telebirr_assignment_broker_runtime'
)
\gset
\if :exact_roles_exist
\else
  \warn 'The exact private TeleBirr broker roles are unavailable.'
  select 1 / 0 as rejected;
\endif

with membership_state as (
  select granted_role.rolname as granted_role,
         member_role.rolname as member_role,
         membership.inherit_option,
         membership.set_option,
         membership.admin_option
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
   where granted_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
      or member_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
)
select count(*) <= 1
    and pg_catalog.coalesce(
      pg_catalog.bool_and(
        membership_state.granted_role = 'fetanagent_telebirr_assignment_broker'
        and membership_state.member_role = 'fetanagent_telebirr_assignment_broker_runtime'
      ),
      true
    ) as membership_scope_safe
from membership_state
\gset
\if :membership_scope_safe
\else
  \warn 'An unexpected private TeleBirr broker membership exists; no role was changed.'
  select 1 / 0 as rejected;
\endif

-- A missing row or changed PostgreSQL membership option is repaired conservatively. Any extra or
-- cross-role membership was rejected above. Both statements are transactional with the role
-- disablement and postconditions below.
revoke fetanagent_telebirr_assignment_broker
from fetanagent_telebirr_assignment_broker_runtime;

grant fetanagent_telebirr_assignment_broker
to fetanagent_telebirr_assignment_broker_runtime
with inherit true, set false, admin false;

with membership_state as (
  select granted_role.rolname as granted_role,
         member_role.rolname as member_role,
         membership.inherit_option,
         membership.set_option,
         membership.admin_option
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
   where granted_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
      or member_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
)
select count(*) = 1
    and pg_catalog.bool_and(
      membership_state.granted_role = 'fetanagent_telebirr_assignment_broker'
      and membership_state.member_role = 'fetanagent_telebirr_assignment_broker_runtime'
      and membership_state.inherit_option
      and not membership_state.set_option
      and not membership_state.admin_option
    ) as normalized_membership_ready
from membership_state
\gset
\if :normalized_membership_ready
\else
  \warn 'The private TeleBirr broker membership was not normalized safely.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_telebirr_assignment_broker with
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2
  password null
  valid until 'infinity';

alter role fetanagent_telebirr_assignment_broker_runtime with
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password null
  valid until 'infinity';

do $fetanagent$
declare
  activity_pid integer;
begin
  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity as activity
     where activity.usename in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A private TeleBirr broker session could not be terminated safely.';
    end if;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();

  if exists (
    select 1
      from pg_catalog.pg_stat_activity as activity
     where activity.usename in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A private TeleBirr broker session remains after disablement.';
  end if;

  if (
    select count(*)
      from pg_catalog.pg_authid as role
     where (
       (
         role.rolname = 'fetanagent_telebirr_assignment_broker'
         and role.rolconnlimit = 2
       ) or (
         role.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         and role.rolconnlimit = 1
       )
     )
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolpassword is null
  ) <> 2 then
    raise exception 'The private TeleBirr broker roles were not disabled safely.';
  end if;

  if (
    select count(*)
      from app.feature_switches as feature_switch
     where feature_switch.feature_key in (
       'payment_verification',
       'deposit_execution',
       'withdrawal_validation',
       'withdrawal_collection',
       'cbe_birr_authoritative_verification',
       'telebirr_authoritative_verification',
       'private_live_deposit_pilot'
     )
       and feature_switch.mode = 'disabled'
  ) <> 7 then
    raise exception 'A financial or provider feature changed during broker disablement.';
  end if;
end
$fetanagent$;

commit;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'target', 'staging',
  'brokerDatabaseScaffold', 'disabled_ready',
  'activeBrokerSessions', 'absent',
  'financialFeatures', 'disabled'
)::text;
