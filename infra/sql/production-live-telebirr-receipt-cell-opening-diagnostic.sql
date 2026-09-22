\set ON_ERROR_STOP on
\set QUIET on

begin isolation level repeatable read read only;

with assessment_clock as materialized (
  select pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) as assessed_at
), existing_retry_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as retry_count
    from app.private_telebirr_shadow_receipt_cell_opening_retries
), source_candidates as materialized (
  select
    cell_binding_retry.retry_request_key,
    cell_binding_retry.pilot_revision_id as source_pilot_revision_id,
    cell_binding_retry.receiver_profile_id as source_receiver_profile_id,
    proof.id as source_shadow_proof_request_id,
    proof.verification_job_id as source_shadow_verification_job_id,
    proof.payment_provider_id,
    proof.candidate_reference_fingerprint,
    outcome.id as source_shadow_outcome_id,
    outcome.protocol_disposition,
    outcome.protocol_reason_code,
    outcome.disposition,
    outcome.reason_code,
    outcome.principal_amount_minor,
    outcome.occurred_at,
    outcome.receiver_identity_digest
  from app.private_telebirr_shadow_receipt_cell_binding_retries cell_binding_retry
  join app.private_telebirr_shadow_proof_requests proof
    on proof.id = cell_binding_retry.replacement_shadow_proof_request_id
   and proof.verification_job_id = cell_binding_retry.replacement_shadow_verification_job_id
  join app.private_telebirr_shadow_verification_outcomes outcome
    on outcome.shadow_proof_request_id = proof.id
  left join app.private_telebirr_shadow_receipt_cell_opening_retries cell_opening_retry
    on cell_opening_retry.source_cell_binding_retry_request_key =
       cell_binding_retry.retry_request_key
  where cell_opening_retry.retry_request_key is null
    and cell_binding_retry.reason_code =
        'reviewed_receipt_cell_binding_retry_no_credit'
    and proof.proof_status = 'verification_queued'
    and outcome.protocol_disposition = 'would_review'
    and outcome.protocol_reason_code = 'receipt_requires_review'
    and outcome.disposition = 'review_required'
    and outcome.reason_code = 'parser_uncertain'
    and exists (
      select 1
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = proof.id
         and staged.observation_body_digest = outcome.observation_body_digest
         and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
             'unknown_layout_invoice_number'
    )
    and app.private_tbirr_cell_binding_retry_history_is_valid(
          proof.id,
          cell_binding_retry.retry_request_key
        )
), source_candidate_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as candidate_count
    from source_candidates
), source_context as materialized (
  select candidate.*
    from source_candidates candidate
   order by candidate.source_shadow_proof_request_id
   limit 1
), source_pilot as materialized (
  select pilot.*
    from app.private_live_deposit_pilot_revisions pilot
    join source_context source
      on source.source_pilot_revision_id = pilot.id
), source_profile as materialized (
  select profile.*
    from app.private_live_telebirr_receiver_profiles profile
    join source_context source
      on source.source_receiver_profile_id = profile.id
), target_pilot_candidates as materialized (
  select pilot.*
    from app.private_live_deposit_pilot_revisions pilot
   cross join assessment_clock clock
   cross join source_pilot source
   where pilot.status = 'armed'
     and pilot.id <> source.id
     and pilot.active_from <= clock.assessed_at
     and pilot.expires_at > clock.assessed_at + interval '1 hour'
), target_pilot_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as pilot_count
    from target_pilot_candidates
), target_pilot as materialized (
  select pilot.*
    from target_pilot_candidates pilot
   order by pilot.active_from desc, pilot.id
   limit 1
), target_profile_candidates as materialized (
  select profile.*
    from app.private_live_telebirr_receiver_profiles profile
    join target_pilot pilot
      on profile.pilot_revision_id = pilot.id
   cross join source_profile source
   where app.private_live_telebirr_shadow_profile_contract_matches(
           source.id,
           profile.id
         )
), target_profile_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as profile_count
    from target_profile_candidates
), target_profile as materialized (
  select profile.*
    from target_profile_candidates profile
   order by profile.valid_from desc, profile.id
   limit 1
), structural_enrollments as materialized (
  select enrollment.id as device_enrollment_id, signer.id as assignment_signer_id,
         heartbeat.last_seen_at
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
    join target_pilot pilot
      on enrollment.pilot_revision_id = pilot.id
    join target_profile profile
      on enrollment.receiver_profile_id = profile.id
   cross join assessment_clock clock
   where pairing.pilot_revision_id = pilot.id
     and pairing.receiver_profile_id = profile.id
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
), structural_enrollment_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as enrollment_count
    from structural_enrollments
), structural_enrollment as materialized (
  select enrollment.*
    from structural_enrollments enrollment
   order by enrollment.last_seen_at desc, enrollment.device_enrollment_id
   limit 1
), recent_enrollment_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as enrollment_count
    from structural_enrollments enrollment
   cross join assessment_clock clock
   where enrollment.last_seen_at > clock.assessed_at - interval '5 minutes'
), source_metrics as materialized (
  select
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
        join source_context source
          on attempt.shadow_proof_request_id = source.source_shadow_proof_request_id
    ), 101) as attempt_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
        join source_context source
          on attempt.shadow_proof_request_id = source.source_shadow_proof_request_id
    ), 101) as staged_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
        join source_context source
          on attempt.shadow_proof_request_id = source.source_shadow_proof_request_id
       where staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
             'unknown_layout_invoice_number'
    ), 101) as receipt_cell_opening_review_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_outcomes outcome
        join source_context source
          on outcome.shadow_proof_request_id = source.source_shadow_proof_request_id
    ), 101) as outcome_count,
    coalesce((
      select app.private_telebirr_shadow_retry_attempt_history_digest(
               source.source_shadow_proof_request_id
             ) ~ '^sha256:[0-9a-f]{64}$'
        from source_context source
    ), false) as attempt_history_digest_valid,
    coalesce((
      select app.private_telebirr_shadow_layout_evidence_history_digest(
               source.source_shadow_proof_request_id
             ) ~ '^sha256:[0-9a-f]{64}$'
        from source_context source
    ), false) as evidence_history_digest_valid
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
     and pilot.configuration_digest is not distinct from
         activation_epoch.configuration_digest
     and pilot.active_from is not distinct from activation_epoch.active_from
     and pilot.expires_at is not distinct from activation_epoch.expires_at
     and not exists (
       select 1
         from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
        where emergency_intent.expected_epoch = activation_epoch.epoch
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
            'pilot_revision_id', pilot.id,
            'configuration_digest', pilot.configuration_digest
          )
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
        join target_pilot pilot on true
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'dry_run'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ), 2) as dry_run_pilot_switch_count,
    active_epoch.active_epoch_count as active_activation_epoch_count,
    least((
      select pg_catalog.count(*)::integer
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
         and role.rolcanlogin
    ), 7) as execution_login_role_count,
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
  from active_activation_epoch_state active_epoch
), money_state as materialized (
  select
    least((
      select pg_catalog.count(*)::integer
        from app.private_live_deposit_pilot_reservations
    ), 1) as reservation_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_live_telebirr_settlement_receipts
    ), 1) as settlement_receipt_count,
    least((
      select pg_catalog.count(*)::integer
        from app.deposit_jobs
    ), 1) as deposit_job_count,
    least((
      select pg_catalog.count(*)::integer
        from app.provider_payment_evidence evidence
        join source_context source
          on evidence.payment_provider_id = source.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source.candidate_reference_fingerprint
    ), 1) as provider_evidence_count
), predicate_facts as materialized (
  select
    session_user = 'postgres' as caller_is_postgres,
    existing.retry_count,
    source_state.candidate_count as source_candidate_count,
    target_pilot_state.pilot_count as target_pilot_count,
    target_profile_state.profile_count as target_profile_count,
    structural_state.enrollment_count as structural_enrollment_count,
    recent_state.enrollment_count as recent_enrollment_count,
    metrics.attempt_count,
    metrics.staged_count,
    metrics.receipt_cell_opening_review_count,
    metrics.outcome_count,
    boundary.switch_row_count,
    boundary.disabled_financial_switch_count,
    boundary.dry_run_pilot_switch_count,
    boundary.active_activation_epoch_count,
    boundary.disabled_companion_control_count,
    boundary.execution_login_role_count,
    boundary.execution_session_count,
    money.reservation_count,
    money.settlement_receipt_count,
    money.deposit_job_count,
    money.provider_evidence_count,
    coalesce((
      select source.protocol_disposition = 'would_review'
         and source.protocol_reason_code = 'receipt_requires_review'
         and source.disposition = 'review_required'
         and source.reason_code = 'parser_uncertain'
         and source.principal_amount_minor is null
         and source.occurred_at is null
         and source.receiver_identity_digest is null
        from source_context source
    ), false) as source_outcome_shape_ready,
    metrics.attempt_count between 1 and 100
      and metrics.staged_count = metrics.attempt_count
      and metrics.receipt_cell_opening_review_count = metrics.attempt_count
      and metrics.outcome_count = 1
      and metrics.attempt_history_digest_valid
      and metrics.evidence_history_digest_valid as source_history_ready,
    coalesce((
      select pilot.status = 'armed'
         and pilot.expires_at is not distinct from pilot.active_from + interval '12 hours'
         and pilot.active_from <= clock.assessed_at
         and pilot.expires_at > clock.assessed_at + interval '1 hour'
        from target_pilot pilot
       cross join assessment_clock clock
    ), false) as target_pilot_window_ready,
    coalesce((
      select profile.valid_from <= clock.assessed_at
         and profile.valid_until > clock.assessed_at + interval '5 minutes'
        from target_profile profile
       cross join assessment_clock clock
    ), false) as target_profile_window_ready,
    coalesce((
      select app.private_live_telebirr_shadow_pilot_contract_matches(
               source.id,
               target.id
             )
        from source_pilot source
       cross join target_pilot target
    ), false) as pilot_contract_ready,
    coalesce((
      select app.private_live_telebirr_shadow_profile_contract_matches(
               source.id,
               target.id
             )
        from source_profile source
       cross join target_profile target
    ), false) as profile_contract_ready,
    coalesce((
      select app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
               pilot.id,
               profile.id,
               enrollment.device_enrollment_id,
               enrollment.assignment_signer_id,
               clock.assessed_at + interval '5 minutes'
             )
        from target_pilot pilot
       cross join target_profile profile
       cross join structural_enrollment enrollment
       cross join assessment_clock clock
    ), false) as enrollment_authority_ready,
    boundary.disabled_financial_switch_count = 6
      and boundary.dry_run_pilot_switch_count = 1
      and boundary.active_activation_epoch_count = 0
      and boundary.disabled_companion_control_count = 1
      and boundary.execution_login_role_count = 0
      and boundary.execution_session_count = 0
      and coalesce((
        select pilot.status = 'armed'
           and pilot.configuration_digest is not null
           and clock.assessed_at >= pilot.active_from
           and clock.assessed_at < pilot.expires_at
          from target_pilot pilot
         cross join assessment_clock clock
      ), false) as no_money_boundary_ready,
    coalesce((
      select greatest(
               0,
               least(
                 43205,
                 extract(epoch from (pilot.expires_at - clock.assessed_at))::integer
               )
             )
        from target_pilot pilot
       cross join assessment_clock clock
    ), 0) as remaining_seconds
  from existing_retry_state existing
 cross join source_candidate_state source_state
 cross join target_pilot_state
 cross join target_profile_state
 cross join structural_enrollment_state structural_state
 cross join recent_enrollment_state recent_state
 cross join source_metrics metrics
 cross join boundary_state boundary
 cross join money_state money
), predicate_matrix as materialized (
  select facts.*,
    facts.caller_is_postgres
      and facts.retry_count = 0
      and facts.source_candidate_count = 1
      and facts.target_pilot_count = 1
      and facts.target_profile_count = 1
      and facts.structural_enrollment_count = 1
      and facts.source_outcome_shape_ready
      and facts.source_history_ready
      and facts.target_pilot_window_ready
      and facts.target_profile_window_ready
      and facts.pilot_contract_ready
      and facts.profile_contract_ready
      and facts.enrollment_authority_ready
      and facts.no_money_boundary_ready
      and facts.switch_row_count = 7
      and facts.disabled_financial_switch_count = 6
      and facts.dry_run_pilot_switch_count = 1
      and facts.active_activation_epoch_count = 0
      and facts.disabled_companion_control_count = 1
      and facts.execution_login_role_count = 0
      and facts.execution_session_count = 0
      and facts.reservation_count = 0
      and facts.settlement_receipt_count = 0
      and facts.deposit_job_count = 0
      and facts.provider_evidence_count = 0 as all_non_heartbeat_predicates_ready,
    facts.recent_enrollment_count = 1 as heartbeat_recent
  from predicate_facts facts
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'receipt_cell_opening_safety_diagnostic',
  'deploymentTarget', 'production',
  'readOnly', true,
  'identifiersRedacted', true,
  'callerIsPostgres', predicates.caller_is_postgres,
  'existingRetryCount', predicates.retry_count,
  'sourceCandidateCount', predicates.source_candidate_count,
  'targetPilotCount', predicates.target_pilot_count,
  'targetProfileCount', predicates.target_profile_count,
  'structuralEnrollmentCount', predicates.structural_enrollment_count,
  'recentEnrollmentCount', predicates.recent_enrollment_count,
  'sourceAttemptCount', predicates.attempt_count,
  'sourceStagedEvidenceCount', predicates.staged_count,
  'sourceReceiptCellOpeningReviewCount', predicates.receipt_cell_opening_review_count,
  'sourceOutcomeCount', predicates.outcome_count,
  'switchRowCount', predicates.switch_row_count,
  'disabledFinancialSwitchCount', predicates.disabled_financial_switch_count,
  'dryRunPilotSwitchCount', predicates.dry_run_pilot_switch_count,
  'activeActivationEpochCount', predicates.active_activation_epoch_count,
  'disabledCompanionControlCount', predicates.disabled_companion_control_count,
  'executionLoginRoleCount', predicates.execution_login_role_count,
  'executionSessionCount', predicates.execution_session_count,
  'reservationCount', predicates.reservation_count,
  'settlementReceiptCount', predicates.settlement_receipt_count,
  'depositJobCount', predicates.deposit_job_count,
  'providerEvidenceCount', predicates.provider_evidence_count,
  'remainingSeconds', predicates.remaining_seconds,
  'sourceOutcomeShapeReady', predicates.source_outcome_shape_ready,
  'sourceHistoryReady', predicates.source_history_ready,
  'targetPilotWindowReady', predicates.target_pilot_window_ready,
  'targetProfileWindowReady', predicates.target_profile_window_ready,
  'pilotContractReady', predicates.pilot_contract_ready,
  'profileContractReady', predicates.profile_contract_ready,
  'enrollmentAuthorityReady', predicates.enrollment_authority_ready,
  'noMoneyBoundaryReady', predicates.no_money_boundary_ready,
  'allNonHeartbeatPredicatesReady', predicates.all_non_heartbeat_predicates_ready,
  'heartbeatRecent', predicates.heartbeat_recent,
  'heartbeatRecencySoleFailure',
    predicates.all_non_heartbeat_predicates_ready and not predicates.heartbeat_recent,
  'allReady', predicates.all_non_heartbeat_predicates_ready and predicates.heartbeat_recent,
  'moneyMoved', false
)::text
  from predicate_matrix predicates;

commit;
