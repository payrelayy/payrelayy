\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv pilot_revision_id PILOT_REVISION_ID
\getenv source_authority_retry_request_key SOURCE_AUTHORITY_RETRY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The workflow-supplied production project assertion is missing or incorrect.'
  select 1 / 0 as rejected;
\endif

select :'pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'source_authority_retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The assessment-clock preflight identifiers are invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level repeatable read read only;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '20s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

with authority_at as materialized (
  select pg_catalog.clock_timestamp() as value
), source_authority_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_authority_deadline_retries retry
   where retry.retry_request_key = :'source_authority_retry_request_key'::uuid
     and retry.pilot_revision_id = :'pilot_revision_id'::uuid
), source_proof as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join source_authority_retry retry
      on retry.replacement_shadow_proof_request_id = proof.id
     and retry.replacement_shadow_verification_job_id = proof.verification_job_id
), original_proof as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join source_authority_retry retry
      on retry.source_shadow_proof_request_id = proof.id
     and retry.source_shadow_verification_job_id = proof.verification_job_id
), source_outcome as materialized (
  select outcome.*
    from app.private_telebirr_shadow_verification_outcomes outcome
    join source_proof proof on proof.id = outcome.shadow_proof_request_id
), source_attempts as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join source_proof proof
      on proof.id = attempt.shadow_proof_request_id
     and proof.verification_job_id = attempt.verification_job_id
), source_staged as materialized (
  select staged.*
    from app.private_telebirr_shadow_device_evidence_staging staged
    join source_attempts attempt on attempt.id = staged.verification_attempt_id
), source_quarantines as materialized (
  select quarantine.*
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join source_attempts attempt on attempt.id = quarantine.verification_attempt_id
), source_recovery as materialized (
  select recovery.*
    from app.private_live_telebirr_source_recoveries recovery
    join source_authority_retry retry
      on retry.source_recovery_request_key = recovery.recovery_request_key
), pilot as materialized (
  select candidate.*
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = :'pilot_revision_id'::uuid
), profile as materialized (
  select candidate.*
    from app.private_live_telebirr_receiver_profiles candidate
    join source_proof proof on proof.receiver_profile_id = candidate.id
), live_trusted_authority as materialized (
  -- Reproduce the current-authority predicate with plain reads. The canonical
  -- authority helper intentionally takes row locks and therefore cannot be called
  -- by this read-only preflight.
  select authority.epoch
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs authority
      on authority.epoch = activation_control.current_epoch
    join app.private_live_deposit_pilot_revisions authority_pilot
      on authority_pilot.id = authority.pilot_revision_id
    cross join authority_at
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
     and authority.authority_state = 'active'
     and authority.revoked_at is null
     and authority_at.value >= authority.active_from
     and authority_at.value < authority.expires_at
     and authority_pilot.status = 'armed'
     and authority_pilot.configuration_digest = authority.configuration_digest
     and authority_pilot.active_from = authority.active_from
     and authority_pilot.expires_at = authority.expires_at
     and not exists (
       select 1
         from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
        where emergency_intent.expected_epoch = authority.epoch
     )
     and (
       select pg_catalog.count(*)
         from app.feature_switches feature_switch
        where feature_switch.feature_key in (
          'cbe_birr_authoritative_verification',
          'deposit_execution',
          'payment_verification',
          'private_live_deposit_pilot',
          'telebirr_authoritative_verification'
        )
     ) = 5
     and exists (
       select 1
         from app.feature_switches feature_switch
        where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
          and feature_switch.mode = 'disabled'
          and feature_switch.settings = '{}'::jsonb
     )
     and (
       select pg_catalog.count(*)
         from app.feature_switches feature_switch
        where feature_switch.feature_key in (
          'deposit_execution',
          'payment_verification',
          'telebirr_authoritative_verification'
        )
          and feature_switch.mode = 'live'
          and feature_switch.settings = '{}'::jsonb
     ) = 3
     and exists (
       select 1
         from app.feature_switches feature_switch
        where feature_switch.feature_key = 'private_live_deposit_pilot'
          and feature_switch.mode = 'live'
          and feature_switch.settings = pg_catalog.jsonb_build_object(
            'contract_version', 1,
            'pilot_revision_id', authority_pilot.id,
            'configuration_digest', authority_pilot.configuration_digest
          )
     )
), financial_gates as materialized (
  select
    (select pg_catalog.count(*) = 6
       from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification',
        'deposit_execution',
        'payment_verification',
        'telebirr_authoritative_verification',
        'withdrawal_collection',
        'withdrawal_validation'
      )
        and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb
    ) as money_switches_disabled,
    (select pg_catalog.count(*) = 1
       from app.feature_switches feature_switch
       join pilot on true
      where feature_switch.feature_key = 'private_live_deposit_pilot'
        and feature_switch.mode = 'dry_run'
        and feature_switch.settings = pg_catalog.jsonb_build_object(
          'contract_version', 1,
          'pilot_revision_id', pilot.id,
          'configuration_digest', pilot.configuration_digest
        )
    ) as pilot_dry_run,
    (select pg_catalog.count(*) = 1
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
    not exists (select 1 from live_trusted_authority) as trusted_authority_inactive,
    not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    ) as privileged_logins_disabled,
    not exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) as privileged_sessions_absent
), readiness as materialized (
  select
    (select pg_catalog.count(*) = 1 from source_authority_retry)
      as authority_retry_present,
    (select pg_catalog.count(*) = 1 from source_proof) as source_proof_present,
    (select pg_catalog.count(*) = 1 from original_proof) as original_proof_present,
    (select pg_catalog.count(*) = 1 from source_outcome) as source_outcome_present,
    coalesce((
      select retry.retry_request_digest =
             app.private_telebirr_shadow_authority_deadline_retry_digest(
               retry.retry_request_key,
               retry.source_shadow_proof_request_id,
               retry.source_shadow_verification_job_id,
               retry.source_recovery_request_key,
               retry.source_recovery_request_digest,
               retry.source_shadow_recovery_digest,
               retry.replacement_shadow_proof_request_id,
               retry.replacement_shadow_verification_job_id,
               retry.pilot_revision_id,
               retry.receiver_profile_id,
               retry.prior_attempt_count,
               retry.prior_attempt_history_digest,
               retry.prior_quarantine_count,
               retry.prior_quarantine_history_digest,
               retry.authorized_at,
               retry.retry_expires_at,
               retry.reviewed_main_commit_sha,
               retry.reason_code
             )
        from source_authority_retry retry
    ), false) as authority_retry_digest_valid,
    coalesce((
      select proof.authority_deadline_retry_source_id = original.id
         and proof.assessment_clock_retry_source_id is null
         and proof.submitted_at = retry.authorized_at
         and proof.expires_at = retry.retry_expires_at
         and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
        from source_proof proof
        join original_proof original on true
        join source_authority_retry retry on true
    ), false) as authority_retry_shape_exact,
    coalesce((
      select app.private_live_telebirr_source_recovery_history_is_valid(
               original.id,
               retry.source_recovery_request_key
             )
        from original_proof original
        join source_authority_retry retry on true
    ), false) as source_recovery_history_valid,
    coalesce((
      select original.submitted_at < proof.submitted_at
        from original_proof original
        join source_proof proof on true
    ), false) as original_assessment_clock_available,
    coalesce((
      select outcome.disposition = 'review_required'
         and outcome.reason_code = 'receipt_too_old'
         and (
           (
             outcome.protocol_disposition = 'would_review'
             and outcome.protocol_reason_code <> 'signed_evidence_verified'
           ) or (
             outcome.protocol_disposition = 'would_forward_signed_evidence'
             and outcome.protocol_reason_code = 'signed_evidence_verified'
           )
         )
         and not outcome.would_verify
         and outcome.principal_amount_minor is null
         and outcome.occurred_at is null
         and outcome.receiver_identity_digest is null
        from source_outcome outcome
    ), false) as exact_receipt_too_old_outcome,
    coalesce((
      select outcome.created_at >= retry.authorized_at
         and outcome.created_at < retry.retry_expires_at
        from source_outcome outcome
        join source_authority_retry retry on true
    ), false) as source_outcome_inside_prior_window,
    (select pg_catalog.count(*) between 1 and 99 from source_attempts)
      as attempts_bounded,
    (select pg_catalog.count(*) from source_staged) =
      (select pg_catalog.count(*) from source_attempts) as every_attempt_staged,
    (select pg_catalog.count(*) = 0 from source_quarantines) as no_quarantines,
    not exists (
      select 1
        from app.provider_payment_evidence evidence
        join source_proof proof
          on proof.payment_provider_id = evidence.payment_provider_id
         and proof.candidate_reference_fingerprint =
             evidence.canonical_reference_fingerprint
    ) as no_provider_evidence,
    not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
        join source_recovery recovery
          on recovery.source_live_proof_id =
             reservation.private_live_deposit_pilot_proof_id
    ) as no_reservations,
    not exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
        join source_recovery recovery
          on receipt.verification_outcome_id in (
            recovery.root_live_outcome_id,
            recovery.terminal_live_outcome_id
          )
    ) as no_settlement_receipts,
    not exists (
      select 1
        from app.private_telebirr_shadow_assessment_clock_retries retry
        join source_proof proof
          on retry.source_shadow_proof_request_id = proof.id
    ) as not_already_retried,
    coalesce((
      select pilot.status = 'armed'
         and pilot.active_from <= authority_at.value
         and pilot.expires_at > authority_at.value + interval '1 hour'
        from pilot cross join authority_at
    ), false) as pilot_machine_window,
    coalesce((
      select profile.valid_from <= authority_at.value
         and profile.valid_until > authority_at.value + interval '1 hour'
        from profile cross join authority_at
    ), false) as profile_machine_window,
    (select pg_catalog.count(*) = 1
       from app.private_live_telebirr_device_enrollments enrollment
       join profile on profile.id = enrollment.receiver_profile_id
       join pilot on pilot.id = enrollment.pilot_revision_id
       cross join authority_at
      where enrollment.valid_from <= authority_at.value
        and enrollment.valid_until > authority_at.value + interval '1 hour'
        and not exists (
          select 1 from app.private_live_telebirr_device_revocations revocation
           where revocation.device_enrollment_id = enrollment.id
        )
    ) as enrollment_machine_window,
    (select pg_catalog.count(*) = 1
       from app.private_live_telebirr_assignment_signers signer
       cross join authority_at
      where signer.valid_from <= authority_at.value
        and signer.valid_until >= authority_at.value + interval '12 hours'
        and not exists (
          select 1
            from app.private_live_telebirr_assignment_signer_revocations revocation
           where revocation.assignment_signer_id = signer.id
        )
    ) as signer_twelve_hours,
    financial_gates.*
    from financial_gates
), classified as materialized (
  select readiness.*,
         readiness.authority_retry_present
           and readiness.source_proof_present
           and readiness.original_proof_present
           and readiness.source_outcome_present
           and readiness.authority_retry_digest_valid
           and readiness.authority_retry_shape_exact
           and readiness.source_recovery_history_valid
           and readiness.original_assessment_clock_available
           and readiness.exact_receipt_too_old_outcome
           and readiness.source_outcome_inside_prior_window
           and readiness.attempts_bounded
           and readiness.every_attempt_staged
           and readiness.no_quarantines
           and readiness.no_provider_evidence
           and readiness.no_reservations
           and readiness.no_settlement_receipts
           and readiness.not_already_retried
           and readiness.pilot_machine_window
           and readiness.profile_machine_window
           and readiness.enrollment_machine_window
           and readiness.signer_twelve_hours
           and readiness.money_switches_disabled
           and readiness.pilot_dry_run
           and readiness.companion_disabled
           and readiness.trusted_authority_inactive
           and readiness.privileged_logins_disabled
           and readiness.privileged_sessions_absent as ready
    from readiness
)
select pg_catalog.to_jsonb(classified) || pg_catalog.jsonb_build_object(
         'schemaVersion', 1,
         'operation', 'telebirr_shadow_assessment_clock_preflight',
         'deploymentTarget', 'production',
         'minimumReviewWindowHours', 12,
         'financialBoundary', 'dry_run',
         'kemerBetExecutionEnabled', false,
         'moneyMoved', false
       )
  from classified;

rollback;
