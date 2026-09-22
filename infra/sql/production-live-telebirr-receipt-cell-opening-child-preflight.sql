\set ON_ERROR_STOP on
\set QUIET on

begin isolation level repeatable read read only;

with assessment_clock as materialized (
  select pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) as assessed_at
), retry_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as retry_count
    from app.private_telebirr_shadow_receipt_cell_opening_retries
), retry_context as materialized (
  select
    retry.*,
    proof.id as shadow_proof_request_id,
    proof.verification_job_id,
    proof.payment_provider_id,
    proof.candidate_reference_fingerprint,
    proof.proof_status,
    proof.submitted_at,
    proof.not_before,
    proof.expires_at,
    proof.source_live_verification_job_id,
    proof.source_live_proof_id,
    proof.source_pilot_revision_id,
    proof.source_receiver_profile_id,
    proof.recovery_request_key,
    proof.retry_request_key as proof_retry_request_key,
    proof.infrastructure_retry_request_key,
    proof.runtime_retry_request_key
  from app.private_telebirr_shadow_receipt_cell_opening_retries retry
  join app.private_telebirr_shadow_proof_requests proof
    on proof.id = retry.replacement_shadow_proof_request_id
   and proof.verification_job_id = retry.replacement_shadow_verification_job_id
  where retry.reason_code = 'reviewed_receipt_cell_opening_retry_no_credit'
   order by retry.authorized_at desc, proof.id
   limit 1
), pilot_state as materialized (
  select pilot.*
    from app.private_live_deposit_pilot_revisions pilot
    join retry_context retry on retry.pilot_revision_id = pilot.id
), profile_state as materialized (
  select profile.*
    from app.private_live_telebirr_receiver_profiles profile
    join retry_context retry on retry.receiver_profile_id = profile.id
), lineage_state as materialized (
  select coalesce((
    select
      retry.retry_request_key is not null
      and retry.retry_request_digest =
          app.private_telebirr_shadow_receipt_cell_opening_retry_digest(
            retry.retry_request_key,
            retry.source_cell_binding_retry_request_key,
            retry.source_cell_binding_retry_request_digest,
            retry.source_shadow_proof_request_id,
            retry.source_shadow_verification_job_id,
            retry.source_shadow_outcome_id,
            retry.replacement_shadow_proof_request_id,
            retry.replacement_shadow_verification_job_id,
            retry.pilot_revision_id,
            retry.receiver_profile_id,
            retry.device_enrollment_id,
            retry.assignment_signer_id,
            retry.source_attempt_count,
            retry.source_attempt_history_digest,
            retry.source_staged_evidence_count,
            retry.source_evidence_history_digest,
            retry.source_receipt_cell_opening_review_count,
            retry.source_outcome_count,
            retry.authorized_at,
            retry.retry_expires_at,
            retry.reviewed_main_commit_sha,
            retry.reason_code
          )
      and retry.source_cell_binding_retry_request_digest =
          source_cell_binding.retry_request_digest
      and source_cell_binding.replacement_shadow_proof_request_id = source_proof.id
      and source_cell_binding.replacement_shadow_verification_job_id =
          source_proof.verification_job_id
      and app.private_tbirr_cell_binding_retry_history_is_valid(
            source_proof.id,
            source_cell_binding.retry_request_key
          )
      and source_proof.proof_status = 'verification_queued'
      and source_outcome.id is not null
      and source_outcome.verification_job_id = source_proof.verification_job_id
      and source_outcome.protocol_disposition = 'would_review'
      and source_outcome.protocol_reason_code = 'receipt_requires_review'
      and source_outcome.disposition = 'review_required'
      and source_outcome.reason_code = 'parser_uncertain'
      and source_outcome.principal_amount_minor is null
      and source_outcome.occurred_at is null
      and source_outcome.receiver_identity_digest is null
      and exists (
        select 1
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = source_proof.id
           and staged.observation_body_digest = source_outcome.observation_body_digest
           and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
               'unknown_layout_invoice_number'
      )
      and (
        select pg_catalog.count(*)::integer
          from app.private_telebirr_shadow_verification_attempts attempt
         where attempt.shadow_proof_request_id = source_proof.id
      ) = retry.source_attempt_count
      and app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id) =
          retry.source_attempt_history_digest
      and (
        select pg_catalog.count(*)::integer
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = source_proof.id
      ) = retry.source_staged_evidence_count
      and app.private_telebirr_shadow_layout_evidence_history_digest(source_proof.id) =
          retry.source_evidence_history_digest
      and (
        select pg_catalog.count(*)::integer
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = source_proof.id
           and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
               'unknown_layout_invoice_number'
      ) = retry.source_receipt_cell_opening_review_count
      and (
        select pg_catalog.count(*)::integer
          from app.private_telebirr_shadow_verification_outcomes outcome
         where outcome.shadow_proof_request_id = source_proof.id
      ) = retry.source_outcome_count
      and source_cell_binding.pilot_revision_id = source_proof.pilot_revision_id
      and source_cell_binding.receiver_profile_id = source_proof.receiver_profile_id
      and app.private_live_telebirr_shadow_pilot_contract_matches(
            source_cell_binding.pilot_revision_id,
            pilot.id
          )
      and app.private_live_telebirr_shadow_profile_contract_matches(
            source_cell_binding.receiver_profile_id,
            profile.id
          )
      and replacement.id = retry.replacement_shadow_proof_request_id
      and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
      and replacement.source_binding_layout_retry_source_id = source_proof.id
      and replacement.pilot_revision_id = pilot.id
      and replacement.receiver_profile_id = profile.id
      and replacement.submitting_customer_id = source_proof.submitting_customer_id
      and replacement.player_account_id = source_proof.player_account_id
      and replacement.payment_provider_id = source_proof.payment_provider_id
      and replacement.provider_code = source_proof.provider_code
      and replacement.pilot_configuration_digest = pilot.configuration_digest
      and replacement.origin_channel = source_proof.origin_channel
      and replacement.input_kind = source_proof.input_kind
      and replacement.candidate_reference_ciphertext =
          source_proof.candidate_reference_ciphertext
      and replacement.candidate_reference_fingerprint =
          source_proof.candidate_reference_fingerprint
      and replacement.candidate_reference_masked = source_proof.candidate_reference_masked
      and replacement.reference_encryption_key_version =
          source_proof.reference_encryption_key_version
      and replacement.reference_profile_version = source_proof.reference_profile_version
      and replacement.proof_status = 'verification_queued'
      and replacement.submitted_at = source_proof.submitted_at
      and replacement.not_before = source_proof.not_before
      and replacement.created_at = retry.authorized_at
      and replacement.expires_at = retry.retry_expires_at
      and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
      and retry.authorized_at <= clock.assessed_at
      and retry.retry_expires_at > clock.assessed_at + interval '5 minutes'
      and pilot.status = 'armed'
      and pilot.expires_at = pilot.active_from + interval '12 hours'
      and profile.pilot_revision_id = pilot.id
      and profile.valid_from <= clock.assessed_at
      and profile.valid_until > clock.assessed_at + interval '5 minutes'
    from retry_context retry
    join app.private_telebirr_shadow_receipt_cell_binding_retries source_cell_binding
      on source_cell_binding.retry_request_key =
         retry.source_cell_binding_retry_request_key
    join app.private_telebirr_shadow_proof_requests source_proof
      on source_proof.id = retry.source_shadow_proof_request_id
     and source_proof.verification_job_id = retry.source_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes source_outcome
      on source_outcome.id = retry.source_shadow_outcome_id
     and source_outcome.shadow_proof_request_id = source_proof.id
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
   cross join pilot_state pilot
   cross join profile_state profile
   cross join assessment_clock clock
  ), false) as lineage_ready
), enrollment_candidates as materialized (
  select enrollment.id as device_enrollment_id,
         signer.id as assignment_signer_id,
         heartbeat.last_seen_at
    from retry_context retry
    join app.private_live_telebirr_device_enrollments enrollment
      on enrollment.id = retry.device_enrollment_id
     and enrollment.pilot_revision_id = retry.pilot_revision_id
     and enrollment.receiver_profile_id = retry.receiver_profile_id
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
     and signer.id = retry.assignment_signer_id
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
   cross join assessment_clock clock
   where pairing.pilot_revision_id = retry.pilot_revision_id
     and pairing.receiver_profile_id = retry.receiver_profile_id
     and pairing.state = 'completed'
     and pairing.completed_at is not null
     and enrollment.valid_from <= clock.assessed_at
     and enrollment.valid_until > clock.assessed_at + interval '5 minutes'
     and pairing.certificate_valid_from <= clock.assessed_at
     and pairing.certificate_valid_until > clock.assessed_at + interval '5 minutes'
     and signer.valid_from <= clock.assessed_at
     and signer.valid_until > clock.assessed_at + interval '5 minutes'
     and heartbeat.runtime_state = 'ready'
     and heartbeat.status_code = 'no_assignment'
     and heartbeat.app_version = '0.5.9-evidence-only'
     and heartbeat.last_seen_at > retry.authorized_at
     and heartbeat.last_seen_at > clock.assessed_at - interval '5 minutes'
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= clock.assessed_at
     )
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= clock.assessed_at
     )
), enrollment_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as enrollment_count
    from enrollment_candidates
), child_state as materialized (
  select
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
         and attempt.verification_job_id = retry.verification_job_id
    ), 101) as attempt_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
         and attempt.verification_job_id = retry.verification_job_id
    ), 101) as staged_evidence_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
         and attempt.verification_job_id = retry.verification_job_id
       where attempt.device_enrollment_id = retry.device_enrollment_id
         and attempt.issued_at >= retry.authorized_at
         and attempt.issued_at < retry.retry_expires_at
         and staged.staged_at >= retry.authorized_at
         and staged.staged_at < retry.retry_expires_at
         and staged.staged_at < attempt.expires_at
         and staged.observed_at >= attempt.issued_at
         and staged.observed_at < attempt.expires_at
         and not exists (
           select 1
             from app.private_telebirr_shadow_evidence_quarantine quarantine
            where quarantine.verification_attempt_id = attempt.id
               or quarantine.observation_body_digest = staged.observation_body_digest
         )
    ), 101) as usable_staged_evidence_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
    ), 101) as quarantine_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_outcomes outcome
        join retry_context retry
          on outcome.shadow_proof_request_id = retry.shadow_proof_request_id
    ), 2) as outcome_count,
    least((
      select pg_catalog.count(*)::integer
        from app.telegram_telebirr_shadow_proof_receipts receipt
        join retry_context retry
          on receipt.shadow_proof_request_id = retry.shadow_proof_request_id
    ), 2) as receipt_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
       cross join assessment_clock clock
       where clock.assessed_at < attempt.expires_at
    ), 2) as active_assignment_count
), active_activation_epoch_state as materialized (
  select least(pg_catalog.count(*)::integer, 1) as active_epoch_count
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs activation_epoch
      on activation_epoch.epoch = activation_control.current_epoch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = activation_epoch.pilot_revision_id
   cross join assessment_clock clock
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
     and activation_epoch.authority_state = 'active'
     and activation_epoch.revoked_at is null
     and clock.assessed_at >= activation_epoch.active_from
     and clock.assessed_at < activation_epoch.expires_at
     and pilot.status = 'armed'
     and pilot.configuration_digest is not distinct from activation_epoch.configuration_digest
     and pilot.active_from is not distinct from activation_epoch.active_from
     and pilot.expires_at is not distinct from activation_epoch.expires_at
     and not exists (
       select 1
         from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
        where emergency_intent.expected_epoch = activation_epoch.epoch
     )
), boundary_state as materialized (
  select
    least((
      select pg_catalog.count(*)::integer
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
    ), 8) as switch_row_count,
    least((
      select pg_catalog.count(*)::integer
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
    ), 7) as disabled_financial_switch_count,
    least((
      select pg_catalog.count(*)::integer
        from app.feature_switches feature_switch
        join pilot_state pilot on true
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'dry_run'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ), 2) as dry_run_pilot_switch_count,
    activation.active_epoch_count as active_activation_epoch_count,
    least((
      select pg_catalog.count(*)::integer
        from app.agent_platform_companion_execution_control control
       where control.singleton
         and control.control_state = 'disabled'
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
    ), 2) as disabled_companion_control_count,
    least((
      select pg_catalog.count(*)::integer
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and (role.rolcanlogin or role.rolpassword is not null)
    ), 7) as execution_role_credential_count,
    least((
      select pg_catalog.count(*)::integer
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ), 7) as execution_session_count
  from active_activation_epoch_state activation
), money_state as materialized (
  select
    least((select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_reservations), 1) as reservation_count,
    least((select pg_catalog.count(*)::integer
             from app.private_live_telebirr_settlement_receipts), 1) as settlement_receipt_count,
    least((select pg_catalog.count(*)::integer from app.deposit_jobs), 1) as deposit_job_count,
    least((
      select pg_catalog.count(*)::integer
        from app.provider_payment_evidence evidence
        join retry_context retry
          on evidence.payment_provider_id = retry.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             retry.candidate_reference_fingerprint
    ), 1) as provider_evidence_count
), predicate_facts as materialized (
  select
    session_user = 'postgres' as caller_is_postgres,
    retry_count.retry_count,
    enrollment.enrollment_count,
    child.attempt_count,
    child.staged_evidence_count,
    child.usable_staged_evidence_count,
    child.quarantine_count,
    child.outcome_count,
    child.receipt_count,
    child.active_assignment_count,
    lineage.lineage_ready,
    boundary.switch_row_count,
    boundary.disabled_financial_switch_count,
    boundary.dry_run_pilot_switch_count,
    boundary.active_activation_epoch_count,
    boundary.disabled_companion_control_count,
    boundary.execution_role_credential_count,
    boundary.execution_session_count,
    money.reservation_count,
    money.settlement_receipt_count,
    money.deposit_job_count,
    money.provider_evidence_count,
    coalesce((
      select retry.proof_status = 'verification_queued'
         and retry.source_live_verification_job_id is null
         and retry.source_live_proof_id is null
         and retry.source_pilot_revision_id is null
         and retry.source_receiver_profile_id is null
         and retry.recovery_request_key is null
         and retry.proof_retry_request_key is null
         and retry.infrastructure_retry_request_key is null
         and retry.runtime_retry_request_key is null
         and retry.not_before <= clock.assessed_at
         and retry.expires_at = retry.retry_expires_at
         and retry.expires_at > clock.assessed_at + interval '5 minutes'
        from retry_context retry
       cross join assessment_clock clock
    ), false) as child_proof_ready,
    coalesce((
      select pilot.status = 'armed'
         and pilot.configuration_digest is not null
         and pilot.expires_at is not distinct from pilot.active_from + interval '12 hours'
         and pilot.active_from <= clock.assessed_at
         and pilot.expires_at > clock.assessed_at + interval '1 hour'
        from pilot_state pilot
       cross join assessment_clock clock
    ), false) as pilot_window_ready,
    coalesce((
      select profile.valid_from <= clock.assessed_at
         and profile.valid_until > clock.assessed_at + interval '5 minutes'
        from profile_state profile
       cross join assessment_clock clock
    ), false) as profile_window_ready,
    coalesce((
      select app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
               retry.pilot_revision_id,
               retry.receiver_profile_id,
               retry.device_enrollment_id,
               retry.assignment_signer_id,
               clock.assessed_at + interval '5 minutes'
             )
        from retry_context retry
       cross join assessment_clock clock
    ), false) as enrollment_authority_ready,
    child.attempt_count between 1 and 100
      and child.usable_staged_evidence_count between 1 and child.staged_evidence_count
      and child.quarantine_count = 0 as evidence_ready,
    boundary.disabled_financial_switch_count = 6
      and boundary.dry_run_pilot_switch_count = 1
      and boundary.active_activation_epoch_count = 0
      and boundary.disabled_companion_control_count = 1
      and boundary.execution_role_credential_count = 0
      and boundary.execution_session_count = 0 as no_money_boundary_ready,
    coalesce((
      select greatest(
               0,
               least(
                 43205,
                 extract(epoch from (pilot.expires_at - clock.assessed_at))::integer
               )
             )
        from pilot_state pilot
       cross join assessment_clock clock
    ), 0) as remaining_seconds
  from retry_state retry_count
 cross join enrollment_state enrollment
 cross join child_state child
 cross join lineage_state lineage
 cross join boundary_state boundary
 cross join money_state money
), predicate_matrix as materialized (
  select facts.*,
    facts.caller_is_postgres
      and facts.retry_count = 1
      and facts.enrollment_count = 1
      and facts.lineage_ready
      and facts.child_proof_ready
      and facts.pilot_window_ready
      and facts.profile_window_ready
      and facts.enrollment_authority_ready
      and facts.switch_row_count = 7
      and facts.disabled_financial_switch_count = 6
      and facts.dry_run_pilot_switch_count = 1
      and facts.active_activation_epoch_count = 0
      and facts.disabled_companion_control_count = 1
      and facts.execution_role_credential_count = 0
      and facts.execution_session_count = 0
      and facts.outcome_count = 0
      and facts.receipt_count = 0
      and facts.reservation_count = 0
      and facts.settlement_receipt_count = 0
      and facts.deposit_job_count = 0
      and facts.provider_evidence_count = 0
      and facts.remaining_seconds > 3600 as all_non_evidence_predicates_ready
  from predicate_facts facts
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'receipt_cell_opening_child_preflight',
  'deploymentTarget', 'production',
  'readOnly', true,
  'identifiersRedacted', true,
  'callerIsPostgres', predicates.caller_is_postgres,
  'retryCount', predicates.retry_count,
  'enrollmentCount', predicates.enrollment_count,
  'attemptCount', predicates.attempt_count,
  'stagedEvidenceCount', predicates.staged_evidence_count,
  'usableStagedEvidenceCount', predicates.usable_staged_evidence_count,
  'quarantineCount', predicates.quarantine_count,
  'outcomeCount', predicates.outcome_count,
  'receiptCount', predicates.receipt_count,
  'activeAssignmentCount', predicates.active_assignment_count,
  'lineageReady', predicates.lineage_ready,
  'switchRowCount', predicates.switch_row_count,
  'disabledFinancialSwitchCount', predicates.disabled_financial_switch_count,
  'dryRunPilotSwitchCount', predicates.dry_run_pilot_switch_count,
  'activeActivationEpochCount', predicates.active_activation_epoch_count,
  'disabledCompanionControlCount', predicates.disabled_companion_control_count,
  'executionRoleCredentialCount', predicates.execution_role_credential_count,
  'executionSessionCount', predicates.execution_session_count,
  'reservationCount', predicates.reservation_count,
  'settlementReceiptCount', predicates.settlement_receipt_count,
  'depositJobCount', predicates.deposit_job_count,
  'providerEvidenceCount', predicates.provider_evidence_count,
  'remainingSeconds', predicates.remaining_seconds,
  'childProofReady', predicates.child_proof_ready,
  'pilotWindowReady', predicates.pilot_window_ready,
  'profileWindowReady', predicates.profile_window_ready,
  'enrollmentAuthorityReady', predicates.enrollment_authority_ready,
  'evidenceReady', predicates.evidence_ready,
  'noMoneyBoundaryReady', predicates.no_money_boundary_ready,
  'allNonEvidencePredicatesReady', predicates.all_non_evidence_predicates_ready,
  'allReady', predicates.all_non_evidence_predicates_ready and predicates.evidence_ready,
  'moneyMoved', false
)::text
  from predicate_matrix predicates;

commit;
