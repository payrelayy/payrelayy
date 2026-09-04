\set ON_ERROR_STOP on
\getenv runtime_password COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '10s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'runtime_password' ~ '^[0-9a-f]{64}$' as runtime_password_safe
\gset
\if :runtime_password_safe
\else
  \warn 'The companion bridge runtime password is not an exact generated secret.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:companion-bridge-runtime:v1', 0)
);

with locked_feature_switches as materialized (
  select feature_switch.feature_key, feature_switch.mode
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
)
select count(*) = 7
    and pg_catalog.bool_and(
      case
        when locked_feature_switches.feature_key = 'private_live_deposit_pilot'
          then locked_feature_switches.mode in ('disabled', 'dry_run')
        else locked_feature_switches.mode = 'disabled'
      end
    ) as financial_features_safe
from locked_feature_switches
\gset
\if :financial_features_safe
\else
  \warn 'Financial/provider features must remain disabled; only a dry-run pilot may coexist.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_companion_device_bridge_runtime'
      and not role.rolinherit and not role.rolsuper
      and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
  ) then
    raise exception 'The companion bridge runtime role is not safe.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_companion_device_bridge'
      and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
      and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 2
  ) then
    raise exception 'The companion bridge group role is not safe.';
  end if;
  if (
    select count(*) <> 1 or not pg_catalog.bool_and(
      granted.rolname = 'fetanagent_companion_device_bridge'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
    )
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles member on member.oid = membership.member
    where member.rolname = 'fetanagent_companion_device_bridge_runtime'
  ) then
    raise exception 'The companion bridge runtime membership is not exact.';
  end if;
end
$fetanagent$;

alter role fetanagent_companion_device_bridge_runtime with
  login
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password :'runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_companion_device_bridge_runtime valid until %L',
    'infinity'
  );
  execute pg_catalog.format(
    'grant connect, temporary on database %I to fetanagent_companion_device_bridge_runtime',
    pg_catalog.current_database()
  );
end
$fetanagent$;

select count(*) = 1
    and pg_catalog.bool_and(
      role.rolcanlogin and not role.rolinherit and not role.rolsuper
      and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolvaliduntil = 'infinity'::timestamptz
    ) as runtime_enabled_continuously
from pg_catalog.pg_roles role
where role.rolname = 'fetanagent_companion_device_bridge_runtime'
\gset
\if :runtime_enabled_continuously
\else
  \warn 'The companion bridge runtime postcondition is not safe.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'companion_runtime_enable_continuous',
  'runtime', 'continuous_function_only',
  'calendarShutdown', false,
  'moneyMoved', false
)::text;

commit;
