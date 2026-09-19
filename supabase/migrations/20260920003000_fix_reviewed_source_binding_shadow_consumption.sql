-- Repair the reviewed source-binding-to-shadow continuation so it recognizes the one immutable
-- non-settlement completion consumption created by the verifier before the recovery was closed.
-- The repair remains append-only and creates no reservation, settlement, execution, credit, or
-- money-moving authority.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_telebirr_historical_completion_consumptions in share mode;
lock table app.private_live_telebirr_verification_outcomes in share mode;
lock table app.private_live_telebirr_source_binding_recovery_closures in share mode;

do $reviewed_source_binding_consumption_fix_preflight$
declare
  safe_switch_count integer;
  disabled_companion_count integer;
begin
  if pg_catalog.to_regprocedure(
       'app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid,uuid)'
     ) is null
    or pg_catalog.to_regprocedure(
         'app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(uuid,uuid,timestamptz)'
       ) is not null
    or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'The reviewed source-binding consumption repair prerequisites do not match.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  select pg_catalog.count(*)::integer
    into disabled_companion_count
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
     and execution_control.control_state = 'disabled'
     and execution_control.certificate_id is null
     and execution_control.device_id is null
     and execution_control.device_key_id is null
     and execution_control.no_money_signer_key_id is null
     and execution_control.execution_signer_key_id is null
     and execution_control.execution_signer_public_key_spki is null
     and execution_control.execution_signer_public_key_spki_sha256 is null
     and execution_control.platform_agent_account_id is null
     and execution_control.pilot_revision_id is null
     and execution_control.pilot_revision is null
     and execution_control.pilot_configuration_digest is null
     and execution_control.activation_epoch is null
     and execution_control.active_from is null
     and execution_control.expires_at is null
     and execution_control.activated_by_admin_id is null
     and execution_control.activated_at is null;

  if safe_switch_count <> 7
    or disabled_companion_count <> 1
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The reviewed source-binding consumption repair requires the no-money boundary.';
  end if;
end;
$reviewed_source_binding_consumption_fix_preflight$;

create function app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
  p_request_key uuid,
  p_verification_outcome_id uuid,
  p_closed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_request_key is not null
    and p_verification_outcome_id is not null
    and p_closed_at is not null
    and (
      select pg_catalog.count(*) = 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
        join app.private_live_telebirr_verification_outcomes outcome
          on outcome.id = consumption.verification_outcome_id
       where consumption.request_key = p_request_key
         and consumption.verification_outcome_id = p_verification_outcome_id
         and not consumption.settlement_created
         and consumption.pilot_reservation_id is null
         and consumption.settlement_receipt_id is null
         and consumption.execution_job_id is null
         and consumption.consumed_at >= outcome.created_at
         and consumption.consumed_at <= p_closed_at
    );
$$;

create function pg_temp.apply_exact_source_binding_consumption_patch()
returns void
language plpgsql
set search_path = pg_catalog
as $patch$
declare
  validator_signature constant regprocedure :=
    'app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid,uuid)'::regprocedure;
  recovery_signature constant regprocedure :=
    'app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text)'::regprocedure;
  old_validator_fragment constant text := $old_validator$
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = source_retry.original_authority_request_key
    )$old_validator$;
  new_validator_fragment constant text := $new_validator$
    and app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
      source_retry.original_authority_request_key,
      source_outcome.id,
      source_closure.closed_at
    )$new_validator$;
  old_candidate_fragment constant text := $old_candidate$
     and not exists (
       select 1
         from app.private_live_telebirr_historical_completion_consumptions consumption
        where consumption.request_key = retry.original_authority_request_key
     )$old_candidate$;
  new_candidate_fragment constant text := $new_candidate$
     and app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
       retry.original_authority_request_key,
       outcome.id,
       closure.closed_at
     )$new_candidate$;
  old_safety_fragment constant text := $old_safety$
    or exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = source_retry.original_authority_request_key
    )$old_safety$;
  new_safety_fragment constant text := $new_safety$
    or not app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
      source_retry.original_authority_request_key,
      source_outcome.id,
      source_closure.closed_at
    )$new_safety$;
  helper_marker constant text :=
    'app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(';
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  original_security_definer boolean;
  original_config text[];
  original_volatility "char";
  patched_definition text;
  patched_source text;
  marker_count integer;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig,
         routine.provolatile
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config, original_volatility
    from pg_catalog.pg_proc routine
   where routine.oid = validator_signature;

  marker_count := (
    pg_catalog.length(original_source) -
      pg_catalog.length(pg_catalog.replace(original_source, old_validator_fragment, ''))
  ) / pg_catalog.length(old_validator_fragment);
  if original_definition is null
    or marker_count <> 1
    or pg_catalog.strpos(original_source, helper_marker) <> 0
    or not original_security_definer
    or original_config is distinct from array['search_path=pg_catalog']::text[]
    or original_volatility <> 's' then
    raise exception 'The source-binding shadow validator changed shape.';
  end if;

  patched_definition := pg_catalog.replace(
    original_definition,
    old_validator_fragment,
    new_validator_fragment
  );
  patched_source := pg_catalog.replace(
    original_source,
    old_validator_fragment,
    new_validator_fragment
  );
  execute patched_definition;

  marker_count := (
    pg_catalog.length(patched_source) -
      pg_catalog.length(pg_catalog.replace(patched_source, helper_marker, ''))
  ) / pg_catalog.length(helper_marker);
  if marker_count <> 1
    or pg_catalog.strpos(patched_source, old_validator_fragment) <> 0
    or not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = validator_signature
         and routine.prosrc = patched_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.prosecdef is not distinct from original_security_definer
         and routine.proconfig is not distinct from original_config
         and routine.provolatile is not distinct from original_volatility
    ) then
    raise exception 'The source-binding shadow validator repair was not exact.';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig,
         routine.provolatile
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config, original_volatility
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature;

  marker_count := (
    pg_catalog.length(original_source) -
      pg_catalog.length(pg_catalog.replace(original_source, old_candidate_fragment, ''))
  ) / pg_catalog.length(old_candidate_fragment);
  if original_definition is null
    or marker_count <> 2
    or pg_catalog.strpos(original_source, helper_marker) <> 0
    or not original_security_definer
    or original_config is distinct from array['search_path=pg_catalog']::text[]
    or original_volatility <> 'v' then
    raise exception 'The reviewed source-binding shadow recovery changed shape.';
  end if;

  marker_count := (
    pg_catalog.length(original_source) -
      pg_catalog.length(pg_catalog.replace(original_source, old_safety_fragment, ''))
  ) / pg_catalog.length(old_safety_fragment);
  if marker_count <> 1 then
    raise exception 'The source-binding consumption safety marker matched % times.', marker_count;
  end if;

  patched_definition := pg_catalog.replace(
    pg_catalog.replace(
      original_definition,
      old_candidate_fragment,
      new_candidate_fragment
    ),
    old_safety_fragment,
    new_safety_fragment
  );
  patched_source := pg_catalog.replace(
    pg_catalog.replace(
      original_source,
      old_candidate_fragment,
      new_candidate_fragment
    ),
    old_safety_fragment,
    new_safety_fragment
  );
  execute patched_definition;

  marker_count := (
    pg_catalog.length(patched_source) -
      pg_catalog.length(pg_catalog.replace(patched_source, helper_marker, ''))
  ) / pg_catalog.length(helper_marker);
  if marker_count <> 3
    or pg_catalog.strpos(patched_source, old_candidate_fragment) <> 0
    or pg_catalog.strpos(patched_source, old_safety_fragment) <> 0
    or not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = recovery_signature
         and routine.prosrc = patched_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.prosecdef is not distinct from original_security_definer
         and routine.proconfig is not distinct from original_config
         and routine.provolatile is not distinct from original_volatility
    ) then
    raise exception 'The reviewed source-binding shadow recovery repair was not exact.';
  end if;
end;
$patch$;

select pg_temp.apply_exact_source_binding_consumption_patch();

alter function app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
  uuid, uuid, timestamptz
) owner to postgres;

revoke all on function
  app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
    uuid, uuid, timestamptz
  )
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

comment on function
  app.private_live_telebirr_source_binding_nonsettlement_consumption_is_valid(
    uuid, uuid, timestamptz
  ) is
  'Private fail-closed validator for the one immutable, non-settlement historical completion consumed before a reviewed source-binding recovery closed; it grants no financial authority.';

comment on function app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
  uuid, uuid
) is
  'Validates one append-only source-binding-to-shadow recovery, including its exact prior non-settlement completion consumption, without granting financial authority.';

comment on function app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(
  text
) is
  'Creates at most one reviewed no-money shadow continuation from an exact closed source-binding lineage with one immutable non-settlement consumption; it never reserves, settles, enqueues execution, credits, or moves money.';

commit;
