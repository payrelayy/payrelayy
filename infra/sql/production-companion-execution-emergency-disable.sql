\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The production project assertion is missing or incorrect.'
  select 1 / 0 as rejected;
\endif

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

-- An arm/provision workflow must use this same lifecycle key. Hold the session lock across
-- commits so no fresh runtime credential can be provisioned between phases.
select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
);

-- Commit credential and membership revocation first. Any later failure leaves the login
-- disabled rather than rolling this independent kill switch back.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

alter role fetanagent_companion_execution_bridge_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';
alter role fetanagent_companion_execution_bridge with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';
do $fetanagent$
declare
  non_admin_member text;
begin
  for non_admin_member in
    select member.rolname
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
     where granted.rolname = 'fetanagent_companion_execution_bridge'
       and member.rolname <> 'postgres'
  loop
    execute pg_catalog.format(
      'revoke fetanagent_companion_execution_bridge from %I', non_admin_member
    );
  end loop;
end
$fetanagent$;

commit;

-- Drain sessions after the NOLOGIN/password removal is durable. If the worker has already
-- crossed a one-use final-action fence, its provider outcome still needs reconciliation.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '20s';

do $fetanagent$
declare
  activity_pid integer;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The production administrator session identity is not exact.';
  end if;

  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      perform pg_catalog.pg_stat_clear_snapshot();
      if exists (
        select 1 from pg_catalog.pg_stat_activity activity
         where activity.pid = activity_pid
           and activity.usename in (
             'fetanagent_companion_execution_bridge',
             'fetanagent_companion_execution_bridge_runtime'
           )
      ) then
        raise exception 'A companion execution session could not be terminated safely.';
      end if;
    end if;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) or exists (
    select 1 from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles member on member.oid = membership.member
    where granted.rolname = 'fetanagent_companion_execution_bridge'
      and member.rolname <> 'postgres'
  ) or (
    select pg_catalog.count(*) from pg_catalog.pg_authid role
    where role.rolname in (
      'fetanagent_companion_execution_bridge',
      'fetanagent_companion_execution_bridge_runtime'
    )
      and not role.rolcanlogin
      and not role.rolinherit
      and role.rolpassword is null
  ) <> 2 then
    raise exception 'Companion execution credential revocation is incomplete.';
  end if;
end
$fetanagent$;

commit;

-- Fence the companion control and any still-live trusted TeleBirr financial epoch.
begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '20s';

do $fetanagent$
declare
  active_owner_count integer;
  actor_admin_id uuid;
  current_epoch bigint;
  authority_is_revocable boolean;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The production administrator session identity is not exact.';
  end if;

  select control.current_epoch into current_epoch
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
   for update;
  if current_epoch is null then
    raise exception 'Trusted TeleBirr authority is unavailable.';
  end if;

  select authority.authority_state = 'active' and authority.revoked_at is null
    into authority_is_revocable
    from app.private_trusted_telebirr_activation_epochs authority
   where authority.epoch = current_epoch
   for update;
  if not found then
    raise exception 'The trusted TeleBirr epoch is unavailable.';
  end if;

  if authority_is_revocable then
    select pg_catalog.count(*)::integer,
           (pg_catalog.array_agg(owner_user.id order by owner_user.id))[1]
      into active_owner_count, actor_admin_id
      from app.admin_users owner_user
     where owner_user.role = 'owner' and owner_user.status = 'active';
    if active_owner_count <> 1 or actor_admin_id is null then
      raise exception 'The exact active Owner is unavailable for emergency disable.';
    end if;
    perform app.request_private_trusted_telebirr_emergency_disable(
      actor_admin_id, current_epoch, pg_catalog.gen_random_uuid(),
      'execution_uncertainty'
    );
  end if;

  if app.current_private_trusted_telebirr_activation_epoch() is not null
    or exists (
      select 1 from app.feature_switches switch
       where switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification', 'withdrawal_collection',
         'withdrawal_validation'
       ) and switch.mode = 'live'
    ) then
    raise exception 'The financial emergency boundary is incomplete.';
  end if;
end
$fetanagent$;

commit;

-- Keep the financial stop committed even if the companion-control fence encounters drift.
-- Runtime credentials and sessions were already revoked in the first two phases.
begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

do $fetanagent$
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The production administrator session identity is not exact.';
  end if;
  perform app.disable_agent_platform_companion_execution_transport();
  if not exists (
    select 1 from app.agent_platform_companion_execution_control control
     where control.singleton and control.control_state = 'disabled'
       and control.activation_epoch is null
       and control.pilot_revision_id is null
  ) then
    raise exception 'The companion execution control fence is incomplete.';
  end if;
end
$fetanagent$;

commit;

select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
) as lifecycle_lock_released
\gset
\if :lifecycle_lock_released
\else
  \warn 'The companion execution lifecycle lock was not released exactly once.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'companion_execution_emergency_disable',
  'deploymentTarget', 'production',
  'runtimeLogin', 'disabled',
  'companionExecution', 'disabled',
  'financialAuthority', 'disabled',
  'providerOutcomeRequiresReconciliation', true
)::text;
