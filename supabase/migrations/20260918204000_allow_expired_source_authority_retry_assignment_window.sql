-- Permit the reviewed authority-deadline retry to rely on the immutable historical validity of
-- its expired source-recovery lineage. The new child still receives an exact twelve-hour human
-- review window, while the unchanged pilot, receiver profile, and paired device must remain valid
-- for the immediate five-minute machine assignment window. This does not enable a feature switch,
-- grant a login, create financial authority, reserve, settle, credit, execute, or move money.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_live_telebirr_receiver_profiles in share row exclusive mode;
lock table app.private_live_telebirr_device_enrollments in share row exclusive mode;
lock table app.private_live_telebirr_source_recoveries in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_telebirr_shadow_authority_deadline_retries in share row exclusive mode;

do $authority_retry_assignment_window_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Historical source recovery requires inactive TeleBirr financial authority.';
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
      'Historical source recovery requires the complete no-money boundary.';
  end if;
end;
$authority_retry_assignment_window_preflight$;

do $install_historical_source_recovery_validator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'
  );
  old_name constant text :=
    'app.private_live_telebirr_source_recovery_is_valid';
  new_name constant text :=
    'app.private_live_telebirr_source_recovery_history_is_valid';
  old_deadline constant text :=
    'and recovery.authorized_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '    and recovery.authorized_at + interval ''12 hours'' >'
    || ' pg_catalog.clock_timestamp()';
  new_deadline constant text :=
    'and recovery.authorized_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '    and recovery.recovery_expires_at > recovery.authorized_at';
  old_authority constant text :=
    'app.current_private_trusted_telebirr_activation_epoch() is null';
  old_mode constant text :=
    'app.private_telebirr_shadow_mode_is_ready(recovery.target_pilot_revision_id)';
  original_definition text;
  rewritten_definition text;
begin
  if pg_catalog.to_regprocedure(
       'app.private_live_telebirr_source_recovery_history_is_valid(uuid,uuid)'
     ) is not null then
    raise exception 'The historical source-recovery validator already exists.';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid)
    into original_definition
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.pronargs = 2
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_name, ''))
    ) / pg_catalog.length(old_name) <> 1
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_deadline, ''))
    ) / pg_catalog.length(old_deadline) <> 1
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_authority, ''))
    ) / pg_catalog.length(old_authority) <> 1
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_mode, ''))
    ) / pg_catalog.length(old_mode) <> 1 then
    raise exception 'The source-recovery validator changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_name, new_name);
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_deadline,
    new_deadline
  );
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_authority, 'true');
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_mode, 'true');
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = pg_catalog.to_regprocedure(
             'app.private_live_telebirr_source_recovery_history_is_valid(uuid,uuid)'
           )
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.provolatile = 's'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and pg_catalog.strpos(routine.prosrc, old_deadline) = 0
       and pg_catalog.strpos(routine.prosrc, new_deadline) > 0
       and pg_catalog.strpos(routine.prosrc, old_authority) = 0
       and pg_catalog.strpos(routine.prosrc, old_mode) = 0
  ) then
    raise exception 'The historical source-recovery validator was not installed exactly.';
  end if;
end;
$install_historical_source_recovery_validator$;

alter function app.private_live_telebirr_source_recovery_history_is_valid(uuid, uuid)
  owner to postgres;
revoke all on function
  app.private_live_telebirr_source_recovery_history_is_valid(uuid, uuid)
from public;

do $bind_authority_retry_to_historical_source$
declare
  routine_oid oid;
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
  old_validator constant text :=
    'app.private_live_telebirr_source_recovery_is_valid';
  new_validator constant text :=
    'app.private_live_telebirr_source_recovery_history_is_valid';
  old_enrollment_window constant text :=
    'enrollment.valid_until >= retry_until';
  new_enrollment_window constant text :=
    'enrollment.valid_until > authorized_at + interval ''5 minutes''';
  old_pilot_window constant text := 'pilot.expires_at < retry_until';
  new_pilot_window constant text :=
    'pilot.expires_at <= authorized_at + interval ''5 minutes''';
  old_profile_window constant text := 'profile.valid_until < retry_until';
  new_profile_window constant text :=
    'profile.valid_until <= authorized_at + interval ''5 minutes''';
begin
  routine_oid := pg_catalog.to_regprocedure(
    'app.guard_private_telebirr_shadow_authority_deadline_retry_insert()'
  );
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
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

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_validator, ''))
    ) / pg_catalog.length(old_validator) <> 1 then
    raise exception 'The authority-retry insert guard changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_validator,
    new_validator
  );
  rewritten_source := pg_catalog.replace(original_source, old_validator, new_validator);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The authority-retry insert guard lost its reviewed properties.';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'app.retry_private_telebirr_shadow_after_authority_deadline_fix(uuid,uuid,uuid,uuid,text,text)'
  );
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
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

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_validator, ''))
    ) / pg_catalog.length(old_validator) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_enrollment_window, ''))
    ) / pg_catalog.length(old_enrollment_window) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_pilot_window, ''))
    ) / pg_catalog.length(old_pilot_window) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_profile_window, ''))
    ) / pg_catalog.length(old_profile_window) <> 1 then
    raise exception 'The authority-retry function changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(
    original_definition,
    old_validator,
    new_validator
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_enrollment_window,
    new_enrollment_window
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_pilot_window,
    new_pilot_window
  );
  rewritten_definition := pg_catalog.replace(
    rewritten_definition,
    old_profile_window,
    new_profile_window
  );
  rewritten_source := pg_catalog.replace(original_source, old_validator, new_validator);
  rewritten_source := pg_catalog.replace(
    rewritten_source,
    old_enrollment_window,
    new_enrollment_window
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source,
    old_pilot_window,
    new_pilot_window
  );
  rewritten_source := pg_catalog.replace(
    rewritten_source,
    old_profile_window,
    new_profile_window
  );
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The authority-retry function lost its reviewed properties.';
  end if;
end;
$bind_authority_retry_to_historical_source$;

comment on function
  app.private_live_telebirr_source_recovery_history_is_valid(uuid, uuid) is
  'Validates the immutable historical terminal source-unavailable recovery lineage without reviving its expired lease or granting current authority. Callers must independently enforce the current no-money boundary.';
comment on function app.retry_private_telebirr_shadow_after_authority_deadline_fix(
  uuid, uuid, uuid, uuid, text, text
) is
  'Postgres-only, idempotent creation of one exact twelve-hour no-money review child from immutable historical source-recovery lineage. The unchanged dry-run pilot, receiver profile, and paired device must still support the immediate five-minute machine assignment; no financial authority is created.';

commit;
