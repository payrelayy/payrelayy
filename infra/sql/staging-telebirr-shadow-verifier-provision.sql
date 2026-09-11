\set ON_ERROR_STOP on
\getenv confirmed_project_ref STAGING_PROJECT_REF
\getenv shadow_runtime_password TELEBIRR_SHADOW_VERIFIER_RUNTIME_PASSWORD

select :'confirmed_project_ref' = 'spzpiyxheappsfyswewl'
  as staging_target_confirmed
\gset
\if :staging_target_confirmed
\else
  \warn 'The workflow-supplied staging project assertion is missing or incorrect; it does not identify the connected database.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';
set local password_encryption = 'scram-sha-256';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'shadow_runtime_password' ~ '^[0-9a-f]{64}$'
  as credential_canonical
\gset
\if :credential_canonical
\else
  \warn 'The shadow-verifier runtime credential is not canonical.'
  select 1 / 0 as rejected;
\endif

-- This transaction lock conflicts with disablement's session-scoped lock on the exact same key.
-- Provisioning therefore cannot interleave with either disablement transaction or its postconditions.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-shadow-verifier-runtime', 0)
);

-- Lock the complete seven-row boundary while provisioning. The runtime functions repeat this
-- no-money proof for every write, so a later switch transition stops shadow work fail closed.
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
   order by feature_switch.feature_key
   for share
), armed_shadow_pilot as (
  select pilot.id,
         pilot.configuration_digest
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.status = 'armed'
     and pilot.configuration_digest is not null
     and pilot.active_from <= pg_catalog.clock_timestamp()
     and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
)
select (select count(*) from locked_feature_switches) = 7
   and (select count(*) from locked_feature_switches
         where feature_key <> 'private_live_deposit_pilot'
           and mode = 'disabled'
           and settings = '{}'::jsonb) = 6
   and (select count(*) from armed_shadow_pilot) = 1
   and (select count(*)
          from locked_feature_switches switch_state
          join armed_shadow_pilot pilot
            on switch_state.feature_key = 'private_live_deposit_pilot'
         where switch_state.mode = 'dry_run'
           and switch_state.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )) = 1
  as shadow_no_money_boundary_ready
\gset
\if :shadow_no_money_boundary_ready
\else
  \warn 'The exact armed dry-run shadow pilot and disabled financial boundary are required.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
declare
  group_state record;
  runtime_state record;
begin
  select role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls,
         role.rolconnlimit
    into group_state
    from pg_catalog.pg_roles role
   where role.rolname = 'fetanagent_telebirr_shadow_verifier';
  if not found
    or group_state.rolcanlogin
    or group_state.rolinherit
    or group_state.rolsuper
    or group_state.rolcreatedb
    or group_state.rolcreaterole
    or group_state.rolreplication
    or group_state.rolbypassrls
    or group_state.rolconnlimit <> 2 then
    raise exception 'The shadow-verifier privilege role is outside its narrow scaffold.';
  end if;

  select role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls,
         role.rolconnlimit,
         role.rolvaliduntil,
         auth.rolpassword
    into runtime_state
    from pg_catalog.pg_roles role
    join pg_catalog.pg_authid auth on auth.oid = role.oid
   where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime';
  if not found
    or runtime_state.rolcanlogin
    or runtime_state.rolinherit
    or runtime_state.rolsuper
    or runtime_state.rolcreatedb
    or runtime_state.rolcreaterole
    or runtime_state.rolreplication
    or runtime_state.rolbypassrls
    or runtime_state.rolconnlimit <> 1
    or runtime_state.rolpassword is not null then
    raise exception 'The shadow-verifier runtime role is not disabled cleanly.';
  end if;

  if (select count(*)
        from pg_catalog.pg_auth_members membership
       where membership.member = (
         select role.oid from pg_catalog.pg_roles role
          where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
       )) <> 1
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_telebirr_shadow_verifier'
         and member_role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    ) then
    raise exception 'The shadow-verifier runtime membership is not exact.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A shadow-verifier session already exists.';
  end if;
end
$fetanagent$;

alter role fetanagent_telebirr_shadow_verifier_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'shadow_runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_telebirr_shadow_verifier_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
end
$fetanagent$;

select count(*) = 1
   and pg_catalog.bool_and(
     role.rolcanlogin
     and not role.rolinherit
     and not role.rolsuper
     and not role.rolcreatedb
     and not role.rolcreaterole
     and not role.rolreplication
     and not role.rolbypassrls
     and role.rolconnlimit = 1
     and auth.rolpassword is not null
     and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '23 hours 55 minutes'
     and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
   ) as runtime_postcondition
from pg_catalog.pg_roles role
join pg_catalog.pg_authid auth on auth.oid = role.oid
where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
\gset
\if :runtime_postcondition
\else
  \warn 'The bounded shadow-verifier runtime postcondition was not installed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'shadow_verifier_bounded_runtime_provision',
  'deploymentTarget', 'staging',
  'financialBoundary', 'dry_run',
  'runtimeLogin', 'bounded_24_hours'
)::text;

commit;
