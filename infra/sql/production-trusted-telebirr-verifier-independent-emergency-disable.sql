begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

do $fetanagent_verifier_login_disable$
declare
  activity_pid integer;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The production administrator session identity is not exact.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:production:trusted-telebirr-verifier-runtime',
      0
    )
  );

  alter role fetanagent_trusted_telebirr_verifier with
    nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
    connection limit 2 password null valid until 'infinity';
  alter role fetanagent_trusted_telebirr_verifier_runtime with
    nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
    connection limit 1 password null valid until 'infinity';

  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A production verifier session could not be terminated safely.';
    end if;
  end loop;
end;
$fetanagent_verifier_login_disable$;

commit;

-- Deliberately use a second transaction. The verifier credential revocation above remains
-- committed even if the financial emergency boundary detects drift and fails closed below.
-- The frozen financial readiness gate requires READ COMMITTED for this state transition.
begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

do $fetanagent_financial_emergency_disable$
declare
  actor_admin_id uuid;
  current_epoch bigint;
  active_owner_count integer;
  authority_is_revocable boolean;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The production administrator session identity is not exact.';
  end if;

  select activation_control.current_epoch
    into current_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for update;

  if current_epoch is null then
    raise exception 'Trusted TeleBirr activation authority is unavailable.';
  end if;

  select activation_epoch.authority_state = 'active'
         and activation_epoch.revoked_at is null
    into authority_is_revocable
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = current_epoch
   for update;

  if not found then
    raise exception 'The current trusted TeleBirr activation epoch is unavailable.';
  end if;

  if authority_is_revocable then
    select pg_catalog.count(*)::integer,
           (pg_catalog.array_agg(admin_user.id order by admin_user.id))[1]
      into active_owner_count, actor_admin_id
      from app.admin_users admin_user
     where admin_user.role = 'owner'
       and admin_user.status = 'active';

    if active_owner_count <> 1 or actor_admin_id is null then
      raise exception 'The exact active Owner is unavailable for emergency disable.';
    end if;

    perform app.request_private_trusted_telebirr_emergency_disable(
      actor_admin_id,
      current_epoch,
      pg_catalog.gen_random_uuid(),
      'execution_uncertainty'
    );
  end if;

  if app.current_private_trusted_telebirr_activation_epoch() is not null
    or exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification',
         'deposit_execution',
         'payment_verification',
         'private_live_deposit_pilot',
         'telebirr_authoritative_verification',
         'withdrawal_collection',
         'withdrawal_validation'
       )
         and feature_switch.mode = 'live'
    ) then
    raise exception 'The production financial emergency disablement is incomplete.';
  end if;
end;
$fetanagent_financial_emergency_disable$;

commit;

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'verifier_independent_emergency_disable',
  'deploymentTarget', 'production',
  'verifierLogin', case when (
    select pg_catalog.count(*)
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and not role.rolcanlogin
       and role.rolpassword is null
  ) = 2 then 'disabled' else 'unsafe' end,
  'activeVerifierSessions', (
    select pg_catalog.count(*)
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ),
  'currentActivationEpoch', (
    select activation_control.current_epoch
      from app.private_trusted_telebirr_activation_control activation_control
     where activation_control.control_key = 'trusted_telebirr_financial_authority'
  ),
  'currentFinancialAuthority',
    app.current_private_trusted_telebirr_activation_epoch(),
  'liveMoneySwitchCount', (
    select pg_catalog.count(*)
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
       and feature_switch.mode = 'live'
  )
) as result;
