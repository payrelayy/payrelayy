\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv source_shadow_proof_request_id SOURCE_SHADOW_PROOF_REQUEST_ID
\getenv pilot_revision_id PILOT_REVISION_ID

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The workflow-supplied production project assertion is missing or incorrect.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level repeatable read read only;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '20s';

with authority_at as materialized (
  select pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) as value
), target_proof as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = :'source_shadow_proof_request_id'::uuid
     and proof.pilot_revision_id = :'pilot_revision_id'::uuid
), target_recovery as materialized (
  select recovery.*
    from app.private_live_telebirr_source_recoveries recovery
    join target_proof proof
      on recovery.recovery_request_key = proof.recovery_request_key
     and recovery.replacement_shadow_proof_request_id = proof.id
), target_pilot as materialized (
  select pilot.*
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = :'pilot_revision_id'::uuid
), target_profile as materialized (
  select profile.*
    from app.private_live_telebirr_receiver_profiles profile
    join target_proof proof on proof.receiver_profile_id = profile.id
), source_attempts as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join target_proof proof on proof.id = attempt.shadow_proof_request_id
), source_quarantines as materialized (
  select quarantine.*
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join source_attempts attempt on attempt.id = quarantine.verification_attempt_id
), staged_binding as materialized (
  select attempt.id,
         staged.verification_attempt_id is not null
           and staged.observed_at >= attempt.issued_at
           and staged.observed_at < attempt.expires_at
           and staged.staged_at < attempt.expires_at
           and staged.staged_at < proof.expires_at
           and quarantine.verification_attempt_id = attempt.id
           and quarantine.observation_body_digest = staged.observation_body_digest
           and quarantine.reason_code = 'trusted_evidence_invalid' as valid
    from source_attempts attempt
    join target_proof proof on proof.id = attempt.shadow_proof_request_id
    left join app.private_telebirr_shadow_device_evidence_staging staged
      on staged.verification_attempt_id = attempt.id
    left join app.private_telebirr_shadow_evidence_quarantine quarantine
      on quarantine.verification_attempt_id = attempt.id
), active_enrollments as materialized (
  select enrollment.id,
         enrollment.valid_until
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join target_pilot pilot on pilot.id = enrollment.pilot_revision_id
    join target_profile profile on profile.id = enrollment.receiver_profile_id
    cross join authority_at
   where enrollment.valid_from <= authority_at.value
     and enrollment.valid_until > authority_at.value
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
     )
), active_signers as materialized (
  select signer.id,
         signer.valid_until
    from app.private_live_telebirr_assignment_signers signer
    cross join authority_at
   where signer.valid_from <= authority_at.value
     and signer.valid_until > authority_at.value
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
     )
), safe_switches as materialized (
  select feature_switch.feature_key
    from app.feature_switches feature_switch
    left join target_pilot pilot on feature_switch.feature_key = 'private_live_deposit_pilot'
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
     and feature_switch.mode = 'dry_run'
     and feature_switch.settings = pg_catalog.jsonb_build_object(
       'contract_version', 1,
       'pilot_revision_id', pilot.id,
       'configuration_digest', pilot.configuration_digest
     )
   )
), gates as materialized (
  select
    (select count(*) from target_proof) = 1 as proof_present,
    (select count(*) from target_recovery) = 1 as recovery_present,
    coalesce((
      select proof.proof_status = 'verification_queued'
         and proof.provider_code = 'telebirr'
         and proof.source_live_verification_job_id is not null
         and proof.source_live_proof_id is not null
         and proof.source_pilot_revision_id is not null
         and proof.source_receiver_profile_id is not null
         and proof.recovery_request_key is not null
         and proof.recovery_request_digest is not null
         and proof.recovery_reason_code = 'expired_pilot_recovery_no_credit'
         and proof.retry_request_key is null
         and proof.infrastructure_retry_request_key is null
         and proof.runtime_retry_request_key is null
         and proof.source_unavailable_retry_source_id is null
         and proof.observation_clock_retry_source_id is null
         and proof.authority_deadline_retry_source_id is null
        from target_proof proof
    ), false) as proof_shape_exact,
    coalesce((
      select proof.expires_at <= authority_at.value
        from target_proof proof cross join authority_at
    ), false) as proof_expired,
    coalesce((
      select app.private_live_telebirr_source_recovery_is_valid(
        proof.id,
        proof.recovery_request_key
      ) from target_proof proof
    ), false) as source_recovery_valid,
    coalesce((
      select recovery.recovery_request_digest is not null
         and recovery.replacement_shadow_verification_job_id = proof.verification_job_id
        from target_recovery recovery
        join target_proof proof on true
    ), false) as source_recovery_shape_exact,
    (select count(*) from source_attempts) between 1 and 99 as attempts_bounded,
    coalesce((
      select app.private_telebirr_shadow_retry_attempt_history_digest(proof.id) is not null
        from target_proof proof
    ), false) as attempt_history_present,
    (select count(*) from source_attempts) =
      (select count(*) from source_quarantines) as every_attempt_quarantined,
    coalesce((
      select app.private_telebirr_shadow_quarantine_history_digest(proof.id) is not null
        from target_proof proof
    ), false) as quarantine_history_present,
    coalesce((select pg_catalog.bool_and(binding.valid) from staged_binding binding), false)
      as staged_bindings_valid,
    not exists (
      select 1
        from app.private_telebirr_shadow_verification_outcomes outcome
        join target_proof proof on proof.id = outcome.shadow_proof_request_id
    ) as no_shadow_outcome,
    not exists (
      select 1
        from app.provider_payment_evidence evidence
        join target_proof proof
          on proof.payment_provider_id = evidence.payment_provider_id
         and proof.candidate_reference_fingerprint =
             evidence.canonical_reference_fingerprint
    ) as no_provider_evidence,
    coalesce((
      select pilot.status = 'armed'
         and pilot.active_from <= authority_at.value
         and pilot.expires_at > authority_at.value
        from target_pilot pilot cross join authority_at
    ), false) as pilot_current,
    coalesce((
      select pilot.expires_at >= authority_at.value + interval '12 hours'
        from target_pilot pilot cross join authority_at
    ), false) as pilot_twelve_hours,
    coalesce((
      select pilot.configuration_digest = proof.pilot_configuration_digest
        from target_pilot pilot
        join target_proof proof on true
    ), false) as pilot_binding_valid,
    coalesce((
      select profile.valid_from <= authority_at.value
         and profile.valid_until > authority_at.value
        from target_profile profile cross join authority_at
    ), false) as profile_current,
    coalesce((
      select profile.valid_until >= authority_at.value + interval '12 hours'
        from target_profile profile cross join authority_at
    ), false) as profile_twelve_hours,
    coalesce((
      select profile.pilot_revision_id = pilot.id
         and profile.payment_provider_id = proof.payment_provider_id
         and profile.pilot_configuration_digest = pilot.configuration_digest
        from target_profile profile
        join target_pilot pilot on true
        join target_proof proof on true
    ), false) as profile_binding_valid,
    (select count(*) from active_enrollments) = 1 as enrollment_current,
    (select count(*) from active_enrollments enrollment cross join authority_at
      where enrollment.valid_until >= authority_at.value + interval '12 hours') = 1
      as enrollment_twelve_hours,
    (select count(*) from active_signers) = 1 as signer_current,
    (select count(*) from active_signers signer cross join authority_at
      where signer.valid_until >= authority_at.value + interval '12 hours') = 1
      as signer_twelve_hours,
    (select count(*) from safe_switches) = 7 as switches_safe,
    (select count(*) = 1
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
        and execution_control.disable_reason_code is null
    ) as companion_disabled,
    app.current_private_trusted_telebirr_activation_epoch() is null
      as trusted_authority_inactive,
    not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       ) and role.rolcanlogin
    ) as privileged_logins_disabled,
    not exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       ) and activity.pid <> pg_catalog.pg_backend_pid()
    ) as privileged_sessions_absent
), result as materialized (
  select gates.*,
         pg_catalog.to_jsonb(gates) @> pg_catalog.jsonb_build_object(
           'proof_present', true,
           'recovery_present', true,
           'proof_shape_exact', true,
           'proof_expired', true,
           'source_recovery_valid', true,
           'source_recovery_shape_exact', true,
           'attempts_bounded', true,
           'attempt_history_present', true,
           'every_attempt_quarantined', true,
           'quarantine_history_present', true,
           'staged_bindings_valid', true,
           'no_shadow_outcome', true,
           'no_provider_evidence', true,
           'pilot_current', true,
           'pilot_twelve_hours', true,
           'pilot_binding_valid', true,
           'profile_current', true,
           'profile_twelve_hours', true,
           'profile_binding_valid', true,
           'enrollment_current', true,
           'enrollment_twelve_hours', true,
           'signer_current', true,
           'signer_twelve_hours', true,
           'switches_safe', true,
           'companion_disabled', true,
           'trusted_authority_inactive', true,
           'privileged_logins_disabled', true,
           'privileged_sessions_absent', true
         ) as ready
    from gates
)
select pg_catalog.to_jsonb(result) || pg_catalog.jsonb_build_object(
         'schemaVersion', 1,
         'operation', 'telebirr_shadow_authority_deadline_preflight',
         'deploymentTarget', 'production',
         'minimumReviewWindowHours', 12,
         'financialBoundary', 'dry_run',
         'moneyMoved', false
       )
  from result;

rollback;
