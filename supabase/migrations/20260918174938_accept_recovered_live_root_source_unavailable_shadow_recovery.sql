-- Accept the already-validated append-only recovery history on the reviewed live root job when
-- creating the one no-money source-unavailable shadow child. The original implementation compared
-- the root job's current recovered expiry with its submission time, which incorrectly rejected a
-- job that had passed the existing guarded device/broker recovery chain. Bind the shadow lineage to
-- the immutable original five-minute expiry instead. This migration does not lengthen an assignment
-- or replay lease, enable a feature switch, create financial authority, reserve, settle, execute, or
-- move money.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_telebirr_verification_jobs in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_live_telebirr_source_recoveries in share row exclusive mode;

do $recovered_root_installation_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Recovered-root source-unavailable compatibility requires inactive TeleBirr authority.';
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
    into exact_disabled_companion_count
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
     and execution_control.activated_at is null
     and execution_control.disabled_at is null
     and execution_control.disable_reason_code is null;

  if safe_switch_count <> 7
    or exact_disabled_companion_count <> 1
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
    raise exception
      'Recovered-root source-unavailable compatibility requires the complete no-money boundary.';
  end if;

  -- A successful recovery written by an older release used the current expiry because the old
  -- function admitted only an unrecovered root. Such a row therefore already equals the canonical
  -- original expiry. Fail closed if production contains an incompatible historical child.
  if exists (
    select 1
      from app.private_live_telebirr_source_recoveries recovery
      join app.private_live_telebirr_verification_jobs root_job
        on root_job.id = recovery.root_live_verification_job_id
      join app.private_telebirr_shadow_proof_requests shadow_proof
        on shadow_proof.id = recovery.replacement_shadow_proof_request_id
       and shadow_proof.verification_job_id = recovery.replacement_shadow_verification_job_id
     where shadow_proof.original_expires_at is distinct from
           coalesce(root_job.original_expires_at, root_job.expires_at)
  ) then
    raise exception
      'An existing source-unavailable recovery has a noncanonical root expiry.';
  end if;
end;
$recovered_root_installation_preflight$;

do $install_recovered_root_source_recovery$
declare
  routine_oid oid;
  original_definition text;
  rewritten_definition text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
  old_occurrences integer;
  old_window constant text := $old_window$    or root_job.expires_at <= root_job.submitted_at
    or root_job.expires_at > root_job.submitted_at + interval '5 minutes'$old_window$;
  new_window constant text := $new_window$    or coalesce(root_job.original_expires_at, root_job.expires_at)
         <= root_job.submitted_at
    or coalesce(root_job.original_expires_at, root_job.expires_at)
         > root_job.submitted_at + interval '5 minutes'$new_window$;
  old_shadow_digest_expiry constant text := $old_shadow_digest_expiry$    replacement_shadow_job_id,
    root_job.expires_at,
    authorized_at,$old_shadow_digest_expiry$;
  new_shadow_digest_expiry constant text := $new_shadow_digest_expiry$    replacement_shadow_job_id,
    coalesce(root_job.original_expires_at, root_job.expires_at),
    authorized_at,$new_shadow_digest_expiry$;
  old_shadow_insert_expiry constant text := $old_shadow_insert_expiry$    source_profile.id,
    root_job.expires_at,
    authorized_at,$old_shadow_insert_expiry$;
  new_shadow_insert_expiry constant text := $new_shadow_insert_expiry$    source_profile.id,
    coalesce(root_job.original_expires_at, root_job.expires_at),
    authorized_at,$new_shadow_insert_expiry$;
  old_validator_digest_expiry constant text := $old_validator_digest_expiry$    shadow_proof.verification_job_id,
    root_job.expires_at,
    recovery.authorized_at,$old_validator_digest_expiry$;
  new_validator_digest_expiry constant text := $new_validator_digest_expiry$    shadow_proof.verification_job_id,
    coalesce(root_job.original_expires_at, root_job.expires_at),
    recovery.authorized_at,$new_validator_digest_expiry$;
  old_validator_child_shape constant text := $old_validator_child_shape$    and shadow_proof.recovery_reason_code = 'expired_pilot_recovery_no_credit'
    and shadow_proof.expires_at = recovery.recovery_expires_at$old_validator_child_shape$;
  new_validator_child_shape constant text := $new_validator_child_shape$    and shadow_proof.recovery_reason_code = 'expired_pilot_recovery_no_credit'
    and shadow_proof.original_expires_at =
        coalesce(root_job.original_expires_at, root_job.expires_at)
    and shadow_proof.expires_at = recovery.recovery_expires_at$new_validator_child_shape$;
begin
  routine_oid := pg_catalog.to_regprocedure(
    'app.recover_private_live_telebirr_source_to_shadow(uuid,uuid,uuid,uuid,uuid,text)'
  );

  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef;

  if original_definition is null then
    raise exception 'The source-unavailable recovery function changed shape.';
  end if;

  foreach rewritten_definition in array array[
    old_window,
    old_shadow_digest_expiry,
    old_shadow_insert_expiry
  ]
  loop
    old_occurrences := (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, rewritten_definition, ''))
    ) / pg_catalog.length(rewritten_definition);
    if old_occurrences <> 1 then
      raise exception 'A reviewed source-recovery fragment changed unexpectedly.';
    end if;
  end loop;

  if pg_catalog.strpos(original_definition, new_window) <> 0
    or pg_catalog.strpos(original_definition, new_shadow_digest_expiry) <> 0
    or pg_catalog.strpos(original_definition, new_shadow_insert_expiry) <> 0 then
    raise exception 'The recovered-root source-recovery rewrite is already partially installed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_window, new_window);
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_shadow_digest_expiry,
    new_shadow_digest_expiry
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_shadow_insert_expiry,
    new_shadow_insert_expiry
  );
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prokind = 'f'
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
       and pg_catalog.strpos(pg_catalog.pg_get_functiondef(routine.oid), old_window) = 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             old_shadow_digest_expiry
           ) = 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             old_shadow_insert_expiry
           ) = 0
       and pg_catalog.strpos(pg_catalog.pg_get_functiondef(routine.oid), new_window) > 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             new_shadow_digest_expiry
           ) > 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             new_shadow_insert_expiry
           ) > 0
  ) then
    raise exception 'The recovered-root source-recovery rewrite did not preserve its boundary.';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'
  );

  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef;

  if original_definition is null then
    raise exception 'The source-unavailable recovery validator changed shape.';
  end if;

  foreach rewritten_definition in array array[
    old_validator_digest_expiry,
    old_validator_child_shape
  ]
  loop
    old_occurrences := (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, rewritten_definition, ''))
    ) / pg_catalog.length(rewritten_definition);
    if old_occurrences <> 1 then
      raise exception 'A reviewed source-recovery validator fragment changed unexpectedly.';
    end if;
  end loop;

  if pg_catalog.strpos(original_definition, new_validator_digest_expiry) <> 0
    or pg_catalog.strpos(original_definition, new_validator_child_shape) <> 0 then
    raise exception 'The recovered-root validator rewrite is already partially installed.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_validator_digest_expiry,
    new_validator_digest_expiry
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_validator_child_shape,
    new_validator_child_shape
  );
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prokind = 'f'
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             old_validator_digest_expiry
           ) = 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             old_validator_child_shape
           ) = 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             new_validator_digest_expiry
           ) > 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_functiondef(routine.oid),
             new_validator_child_shape
           ) > 0
  ) then
    raise exception 'The recovered-root source-recovery validator rewrite failed.';
  end if;
end;
$install_recovered_root_source_recovery$;

comment on function app.recover_private_live_telebirr_source_to_shadow(
  uuid, uuid, uuid, uuid, uuid, text
) is
  'Postgres-only creation of one five-minute advisory shadow request for the exact reviewed terminal live source_unavailable lineage, including an append-only recovered root bound to its immutable original five-minute expiry. It creates no claim, reservation, settlement, execution job, or money movement.';

comment on function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid) is
  'Validates the immutable terminal live source_unavailable to shadow recovery lineage, including the recovered root original-expiry binding, without exposing the protected reference.';

commit;
