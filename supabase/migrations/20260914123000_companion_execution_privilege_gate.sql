-- Keep the companion execution surface dormant until the separate execution runtime is armed.
--
-- The execution bridge migration intentionally seeded its control disabled, but it granted the
-- seven execution procedures to the always-on no-money companion group. That made the base
-- bridge's exact function-surface preflight fail closed. Move those grants to a separate NOLOGIN
-- capability role with no members. A later, separately reviewed activation must grant that role
-- explicitly before enabling the execution runtime; this migration cannot lease work or move money.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $fetanagent$
begin
  if (
    select count(*) <> 1 or not pg_catalog.bool_and(
      control.control_state = 'disabled'
      and control.certificate_id is null
      and control.device_id is null
      and control.device_key_id is null
      and control.no_money_signer_key_id is null
      and control.execution_signer_key_id is null
      and control.execution_signer_public_key_spki is null
      and control.execution_signer_public_key_spki_sha256 is null
      and control.platform_agent_account_id is null
      and control.pilot_revision_id is null
      and control.pilot_revision is null
      and control.pilot_configuration_digest is null
      and control.activation_epoch is null
      and control.active_from is null
      and control.expires_at is null
      and control.activated_by_admin_id is null
      and control.activated_at is null
      and control.disabled_at is null
      and control.disable_reason_code is null
    )
    from app.agent_platform_companion_execution_control control
    where control.singleton
  ) then
    raise exception 'The companion execution control is not dormant.';
  end if;

  if (select count(*) from app.agent_platform_companion_execution_http_requests) <> 0
    or (select count(*) from app.agent_platform_companion_execution_assignments) <> 0
    or (select count(*) from app.agent_platform_companion_execution_statuses) <> 0 then
    raise exception 'Companion execution records exist; the dormant privilege repair was refused.';
  end if;
end
$fetanagent$;

create role fetanagent_companion_execution_bridge
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  valid until 'infinity';

revoke all on function
  app.claim_agent_platform_companion_execution_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, text, text, text
  ),
  app.complete_agent_platform_companion_execution_assignment(text, jsonb, text, jsonb),
  app.claim_agent_platform_companion_execution_authority(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_authority(text, jsonb),
  app.accept_agent_platform_companion_execution_result(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    jsonb, jsonb, jsonb, jsonb
  ),
  app.claim_agent_platform_companion_execution_status(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_status(text, jsonb)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge;

grant execute on function
  app.claim_agent_platform_companion_execution_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, text, text, text
  ),
  app.complete_agent_platform_companion_execution_assignment(text, jsonb, text, jsonb),
  app.claim_agent_platform_companion_execution_authority(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_authority(text, jsonb),
  app.accept_agent_platform_companion_execution_result(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    jsonb, jsonb, jsonb, jsonb
  ),
  app.claim_agent_platform_companion_execution_status(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_status(text, jsonb)
to fetanagent_companion_execution_bridge;

do $fetanagent$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_companion_execution_bridge'
      and not role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolvaliduntil = 'infinity'::timestamptz
  ) then
    raise exception 'The dormant companion execution capability role is not safe.';
  end if;

  if (
    select count(*) > 1 or not coalesce(pg_catalog.bool_and(
      member.rolname = 'postgres'
      and not membership.inherit_option
      and not membership.set_option
      and membership.admin_option
    ), true)
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles member on member.oid = membership.member
    where granted.rolname = 'fetanagent_companion_execution_bridge'
  ) then
    raise exception 'The dormant companion execution capability role has a non-administrative member.';
  end if;

  if (
    select count(*) <> 7
      or not pg_catalog.bool_and(
        pg_catalog.has_function_privilege(
          'fetanagent_companion_execution_bridge', routine.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'fetanagent_companion_device_bridge', routine.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'fetanagent_companion_device_bridge_runtime', routine.oid, 'EXECUTE'
        )
      )
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'app'
      and routine.proname in (
        'claim_agent_platform_companion_execution_assignment',
        'complete_agent_platform_companion_execution_assignment',
        'claim_agent_platform_companion_execution_authority',
        'complete_agent_platform_companion_execution_authority',
        'accept_agent_platform_companion_execution_result',
        'claim_agent_platform_companion_execution_status',
        'complete_agent_platform_companion_execution_status'
      )
  ) then
    raise exception 'The companion execution procedure grant boundary is not exact.';
  end if;
end
$fetanagent$;

comment on role fetanagent_companion_execution_bridge is
  'Dormant NOLOGIN capability for the seven paired-companion execution procedures. It has no members until a separately reviewed execution activation.';

commit;
