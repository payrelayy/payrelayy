-- The reviewed source-unavailable recovery function already admits an append-only expired-source
-- authorization for up to seven days, but the shadow proof table still rejects every recovery whose
-- recovered_at timestamp is 24 hours or more after the original proof submission. Align only that
-- structural timestamp cap with the function and validator. The created shadow request remains a
-- one-use five-minute machine lease bounded by the current pilot, receiver profile, and enrollment.
-- This migration does not enable a switch, create authority, grant login, reserve, settle, execute,
-- credit, or move money.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in access exclusive mode;

do $reviewed_expired_source_window_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
  recovery_definition text;
  validator_definition text;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'Reviewed expired-source compatibility requires inactive TeleBirr authority.';
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

  select pg_catalog.pg_get_functiondef(
           'app.recover_private_live_telebirr_source_to_shadow(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
         ),
         pg_catalog.pg_get_functiondef(
           'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'::regprocedure
         )
    into recovery_definition, validator_definition;

  if safe_switch_count <> 7
    or exact_disabled_companion_count <> 1
    or pg_catalog.strpos(
         recovery_definition,
         'source_proof.submitted_at + interval ''7 days'''
       ) = 0
    or pg_catalog.strpos(
         recovery_definition,
         'expired_source_authorization.expires_at'
       ) = 0
    or pg_catalog.strpos(
         recovery_definition,
         'coalesce(root_job.original_expires_at, root_job.expires_at)'
       ) = 0
    or pg_catalog.strpos(
         validator_definition,
         'source_proof.submitted_at + interval ''7 days'''
       ) = 0
    or pg_catalog.strpos(
         validator_definition,
         'expired_source_authorization.expires_at'
       ) = 0
    or pg_catalog.strpos(
         validator_definition,
         'coalesce(root_job.original_expires_at, root_job.expires_at)'
       ) = 0
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
      'Reviewed expired-source compatibility requires the complete no-money boundary.';
  end if;
end;
$reviewed_expired_source_window_preflight$;

do $align_reviewed_expired_source_window$
declare
  definition text;
  old_fragment constant text :=
    'recovered_at < (submitted_at + ''24:00:00''::interval)';
  new_fragment constant text :=
    'recovered_at < (submitted_at + ''7 days''::interval)';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;

  if definition is null then
    raise exception 'The TeleBirr shadow proof window constraint is unavailable.';
  end if;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_fragment, ''))
  ) / pg_catalog.length(new_fragment);

  if old_count = 1 and new_count = 0 then
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
    execute 'alter table app.private_telebirr_shadow_proof_requests '
         || 'drop constraint private_telebirr_shadow_proof_window_check';
    execute 'alter table app.private_telebirr_shadow_proof_requests '
         || 'add constraint private_telebirr_shadow_proof_window_check ' || definition;
  elsif old_count = 0 and new_count = 1 then
    null;
  else
    raise exception 'The reviewed expired-source shadow window constraint changed shape.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'app.private_telebirr_shadow_proof_requests'::regclass
       and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
       and constraint_row.contype = 'c'
       and constraint_row.convalidated
       and pg_catalog.strpos(
             pg_catalog.pg_get_constraintdef(constraint_row.oid),
             old_fragment
           ) = 0
       and pg_catalog.strpos(
             pg_catalog.pg_get_constraintdef(constraint_row.oid),
             new_fragment
           ) > 0
  ) then
    raise exception 'The reviewed expired-source shadow window was not installed.';
  end if;
end;
$align_reviewed_expired_source_window$;

comment on constraint private_telebirr_shadow_proof_window_check
  on app.private_telebirr_shadow_proof_requests is
  'Direct no-money proofs retain their reviewed window. A source-unavailable recovery explicitly authorized by the guarded recovery function may be created within seven days of the immutable source submission; its machine lease remains at most five minutes. Retry branches retain their separately reviewed caps.';

commit;
