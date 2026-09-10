\set ON_ERROR_STOP on
\getenv confirmed_project_ref STAGING_PROJECT_REF

select :'confirmed_project_ref' = 'spzpiyxheappsfyswewl'
  as staging_target_confirmed
\gset
\if :staging_target_confirmed
\else
  \warn 'The exact staging project must be confirmed by the deployment workflow.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable read only;
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

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'shadow_verifier_status',
  'deploymentTarget', 'staging',
  'runtimeLogin', coalesce((
    select case
      when role.rolcanlogin
       and not role.rolinherit and not role.rolsuper and not role.rolcreatedb
       and not role.rolcreaterole and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1 and auth.rolpassword is not null
       and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
       and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
       and (select count(*) from pg_catalog.pg_auth_members membership
             where membership.member = role.oid) = 1
       and exists (
         select 1
           from pg_catalog.pg_auth_members membership
           join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
          where membership.member = role.oid
            and granted_role.rolname = 'fetanagent_telebirr_shadow_verifier'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
       ) then 'bounded'
      when not role.rolcanlogin
       and not role.rolinherit and not role.rolsuper and not role.rolcreatedb
       and not role.rolcreaterole and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1 and auth.rolpassword is null then 'disabled'
      else 'unsafe'
    end
      from pg_catalog.pg_roles role
      join pg_catalog.pg_authid auth on auth.oid = role.oid
     where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
  ), 'missing'),
  'activeRuntimeSessions', (
    select count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename = 'fetanagent_telebirr_shadow_verifier_runtime'
       and activity.pid <> pg_catalog.pg_backend_pid()
  ),
  'financialBoundary', case
    when (select count(*) from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'payment_verification', 'deposit_execution', 'withdrawal_validation',
             'withdrawal_collection', 'cbe_birr_authoritative_verification',
             'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'disabled'
             and feature_switch.settings = '{}'::jsonb) = 6
      and exists (
        select 1
          from app.feature_switches pilot_switch
          join app.private_live_deposit_pilot_revisions pilot
            on pilot.status = 'armed'
           and pilot.configuration_digest is not null
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
    when (select count(*) from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'payment_verification', 'deposit_execution', 'withdrawal_validation',
             'withdrawal_collection', 'cbe_birr_authoritative_verification',
             'telebirr_authoritative_verification', 'private_live_deposit_pilot'
           ) and feature_switch.mode = 'disabled'
             and feature_switch.settings = '{}'::jsonb) = 7 then 'disabled'
    else 'unsafe'
  end,
  'executorBoundary', case
    when exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
         and role.rolcanlogin
    ) or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then 'unsafe' else 'disabled' end
)::text;

rollback;
