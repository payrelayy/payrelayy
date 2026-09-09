\set ON_ERROR_STOP on
\getenv verifier_runtime_password TRUSTED_TELEBIRR_VERIFIER_RUNTIME_PASSWORD

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
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'verifier_runtime_password' ~ '^[0-9a-f]{64}$'
  as credential_canonical
\gset
\if :credential_canonical
\else
  \warn 'The verifier credential is not one lowercase 32-byte hexadecimal value.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:trusted-telebirr-verifier-runtime', 0)
);

do $fetanagent$
declare
  runtime_state record;
  group_state record;
  financial_state text;
begin
  select role.* into runtime_state
    from pg_catalog.pg_roles role
   where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime';
  select role.* into group_state
    from pg_catalog.pg_roles role
   where role.rolname = 'fetanagent_trusted_telebirr_verifier';

  if runtime_state.rolname is null
    or runtime_state.rolinherit or runtime_state.rolsuper or runtime_state.rolcreatedb
    or runtime_state.rolcreaterole or runtime_state.rolreplication or runtime_state.rolbypassrls
    or runtime_state.rolconnlimit <> 1
    or group_state.rolname is null or group_state.rolcanlogin or group_state.rolinherit
    or group_state.rolsuper or group_state.rolcreatedb or group_state.rolcreaterole
    or group_state.rolreplication or group_state.rolbypassrls or group_state.rolconnlimit <> 2 then
    raise exception 'The production verifier roles are outside their narrow scaffold.';
  end if;

  if (select count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime') <> 1
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    ) then
    raise exception 'The production verifier role membership is not exact.';
  end if;

  if (select count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier') <> 1
    or exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where member_role.rolname = 'fetanagent_trusted_telebirr_verifier'
    ) then
    raise exception 'The production verifier group membership is not exact.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and role.rolcanlogin
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'The production deposit executor must remain disabled.';
  end if;

  select case
    when (select count(*) from app.feature_switches) >= 7
     and (select count(*) from app.feature_switches
           where feature_key in (
             'payment_verification', 'deposit_execution', 'withdrawal_validation',
             'withdrawal_collection', 'cbe_birr_authoritative_verification',
             'telebirr_authoritative_verification', 'private_live_deposit_pilot'
           ) and mode = 'disabled' and settings = '{}'::jsonb) = 7
      then 'disabled'
    when (select count(*) from app.feature_switches
           where feature_key in (
             'payment_verification', 'deposit_execution', 'withdrawal_validation',
             'withdrawal_collection', 'cbe_birr_authoritative_verification',
             'telebirr_authoritative_verification'
           ) and mode = 'disabled' and settings = '{}'::jsonb) = 6
     and exists (
       select 1
         from app.feature_switches pilot_switch
         join app.private_live_deposit_pilot_revisions pilot
           on pilot.status = 'armed'
          and pilot.active_from <= pg_catalog.clock_timestamp()
          and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
        where pilot_switch.feature_key = 'private_live_deposit_pilot'
          and pilot_switch.mode = 'dry_run'
          and pilot_switch.settings = pg_catalog.jsonb_build_object(
            'contract_version', 1,
            'pilot_revision_id', pilot.id,
            'configuration_digest', pilot.configuration_digest
          )
     ) then 'dry_run'
    when (select count(*) from app.feature_switches
           where feature_key in (
             'payment_verification', 'deposit_execution',
             'telebirr_authoritative_verification', 'private_live_deposit_pilot'
           ) and mode = 'live') = 4
     and (select count(*) from app.feature_switches
           where feature_key in (
             'withdrawal_validation', 'withdrawal_collection',
             'cbe_birr_authoritative_verification'
           ) and mode = 'disabled' and settings = '{}'::jsonb) = 3
     and exists (
       select 1
         from app.feature_switches pilot_switch
         join app.private_live_deposit_pilot_revisions pilot
           on pilot.status = 'armed'
          and pilot.active_from <= pg_catalog.clock_timestamp()
          and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
        where pilot_switch.feature_key = 'private_live_deposit_pilot'
          and pilot_switch.settings = pg_catalog.jsonb_build_object(
            'contract_version', 1,
            'pilot_revision_id', pilot.id::text,
            'configuration_digest', pilot.configuration_digest
          )
     ) then 'live_verification_executor_disabled'
    else 'unsafe'
  end into financial_state;

  if financial_state = 'unsafe' then
    raise exception 'The production financial boundary is not an allowed verifier state.';
  end if;
end
$fetanagent$;

alter role fetanagent_trusted_telebirr_verifier_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'verifier_runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_trusted_telebirr_verifier_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
end
$fetanagent$;

select count(*) = 1 and pg_catalog.bool_and(
  role.rolcanlogin and not role.rolinherit and not role.rolsuper
  and not role.rolcreatedb and not role.rolcreaterole
  and not role.rolreplication and not role.rolbypassrls
  and role.rolconnlimit = 1
  and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '23 hours 55 minutes'
  and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
) as runtime_postcondition
from pg_catalog.pg_roles role
where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
\gset
\if :runtime_postcondition
\else
  \warn 'The bounded production verifier login was not installed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'bounded_verifier_login_provision',
  'deploymentTarget', 'production',
  'verifierLogin', 'bounded_24h',
  'executorLogin', 'disabled',
  'financialSwitchesChanged', false
)::text;

commit;
