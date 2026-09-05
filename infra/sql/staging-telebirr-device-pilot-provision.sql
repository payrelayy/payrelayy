\set ON_ERROR_STOP on
\getenv assignment_runtime_password TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD
\getenv device_state_runtime_password TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD

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

select :'assignment_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'device_state_runtime_password' ~ '^[0-9a-f]{64}$'
   and :'assignment_runtime_password' <> :'device_state_runtime_password'
  as credentials_canonical
\gset
\if :credentials_canonical
\else
  \warn 'The two isolated TeleBirr runtime credentials are not canonical and distinct.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-device-pilot-runtime', 0)
);

with locked_feature_switches as materialized (
  select feature_switch.feature_key,
         feature_switch.mode,
         feature_switch.settings
    from app.feature_switches feature_switch
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
), armed_pilot as (
  select pilot.id,
         pilot.configuration_digest
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.status = 'armed'
     and pilot.active_from <= pg_catalog.clock_timestamp()
     and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
)
select (select count(*) from locked_feature_switches) = 7
   and (select count(*) from locked_feature_switches
         where feature_key <> 'private_live_deposit_pilot'
           and mode = 'disabled'
           and settings = '{}'::jsonb) = 6
   and (select count(*) from armed_pilot) = 1
   and (select count(*)
          from locked_feature_switches switch_state
          join armed_pilot pilot on switch_state.feature_key = 'private_live_deposit_pilot'
         where switch_state.mode = 'dry_run'
           and switch_state.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )) = 1
  as no_money_pilot_ready
\gset
\if :no_money_pilot_ready
\else
  \warn 'The exact armed dry-run pilot and disabled financial boundary are required.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
declare
  expected record;
  runtime_state record;
begin
  for expected in
    select * from (values
      ('fetanagent_telebirr_assignment_broker', false, 2),
      ('fetanagent_telebirr_assignment_broker_runtime', true, 1),
      ('fetanagent_telebirr_device_state', false, 2),
      ('fetanagent_telebirr_device_state_runtime', true, 1)
    ) as roles(role_name, runtime_role, connection_limit)
  loop
    select role.rolcanlogin,
           role.rolinherit,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls,
           role.rolconnlimit,
           role.rolvaliduntil
      into runtime_state
      from pg_catalog.pg_roles role
     where role.rolname = expected.role_name;
    if not found
      or runtime_state.rolinherit
      or runtime_state.rolsuper
      or runtime_state.rolcreatedb
      or runtime_state.rolcreaterole
      or runtime_state.rolreplication
      or runtime_state.rolbypassrls
      or runtime_state.rolconnlimit <> expected.connection_limit
      or (not expected.runtime_role and runtime_state.rolcanlogin)
      or (
        expected.runtime_role
        and runtime_state.rolcanlogin
        and (
          runtime_state.rolvaliduntil is null
          or runtime_state.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '5 minutes'
          or runtime_state.rolvaliduntil > pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
        )
      ) then
      raise exception 'A TeleBirr runtime role is absent or outside its narrow scaffold.';
    end if;
  end loop;

  if (select count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where member_role.rolname = 'fetanagent_telebirr_assignment_broker_runtime') <> 1
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_telebirr_assignment_broker'
         and member_role.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    )
    or (select count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname = 'fetanagent_telebirr_device_state_runtime') <> 1
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_telebirr_device_state'
         and member_role.rolname = 'fetanagent_telebirr_device_state_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    ) then
    raise exception 'A TeleBirr runtime role membership is not exact.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname in (
       'fetanagent_telebirr_assignment_broker',
       'fetanagent_telebirr_assignment_broker_runtime',
       'fetanagent_telebirr_device_state',
       'fetanagent_telebirr_device_state_runtime'
     )
       and not (
         granted_role.rolname = 'fetanagent_telebirr_assignment_broker'
         and member_role.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
       )
       and not (
         granted_role.rolname = 'fetanagent_telebirr_device_state'
         and member_role.rolname = 'fetanagent_telebirr_device_state_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
       )
       and not (
         member_role.rolname = 'postgres'
         and not membership.inherit_option
         and not membership.set_option
         and membership.admin_option
       )
  ) then
    raise exception 'An unexpected TeleBirr role grant is present.';
  end if;
end
$fetanagent$;

alter role fetanagent_telebirr_assignment_broker_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'assignment_runtime_password';

alter role fetanagent_telebirr_device_state_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'device_state_runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_telebirr_assignment_broker_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
  execute pg_catalog.format(
    'alter role fetanagent_telebirr_device_state_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
end
$fetanagent$;

select count(*) = 2
   and pg_catalog.bool_and(
     role.rolcanlogin
     and not role.rolinherit
     and not role.rolsuper
     and not role.rolcreatedb
     and not role.rolcreaterole
     and not role.rolreplication
     and not role.rolbypassrls
     and role.rolconnlimit = 1
     and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '23 hours 55 minutes'
     and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
   ) as runtime_postcondition
from pg_catalog.pg_roles role
where role.rolname in (
  'fetanagent_telebirr_assignment_broker_runtime',
  'fetanagent_telebirr_device_state_runtime'
)
\gset
\if :runtime_postcondition
\else
  \warn 'The bounded TeleBirr runtime postcondition was not installed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'bounded_runtime_provision',
  'financialFeatures', 'disabled',
  'pilotMode', 'dry_run',
  'assignmentBroker', 'bounded_login_ready',
  'deviceStateBroker', 'bounded_login_ready'
)::text;

commit;
