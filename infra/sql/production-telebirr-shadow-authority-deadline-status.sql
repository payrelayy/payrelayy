\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv pilot_revision_id PILOT_REVISION_ID
\getenv retry_request_key AUTHORITY_DEADLINE_RETRY_REQUEST_KEY

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
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The exact authority-deadline status identifiers are invalid.'
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
), target_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_authority_deadline_retries retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.retry_request_key = :'retry_request_key'::uuid
     and retry.pilot_revision_id = :'pilot_revision_id'::uuid
     and proof.pilot_revision_id = retry.pilot_revision_id
), target_proof as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join target_retry retry
      on retry.replacement_shadow_proof_request_id = proof.id
     and retry.replacement_shadow_verification_job_id = proof.verification_job_id
), target_attempts as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join target_proof proof
      on proof.id = attempt.shadow_proof_request_id
     and proof.verification_job_id = attempt.verification_job_id
), target_staged as materialized (
  select staged.*,
         attempt.shadow_proof_request_id,
         attempt.verification_job_id,
         attempt.lease_request_key,
         attempt.device_enrollment_id as attempt_device_enrollment_id,
         attempt.issued_at,
         attempt.expires_at as attempt_expires_at
    from app.private_telebirr_shadow_device_evidence_staging staged
    join target_attempts attempt on attempt.id = staged.verification_attempt_id
), target_quarantines as materialized (
  select quarantine.*
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join target_attempts attempt on attempt.id = quarantine.verification_attempt_id
), target_outcomes as materialized (
  select outcome.*
    from app.private_telebirr_shadow_verification_outcomes outcome
    join target_proof proof on proof.id = outcome.shadow_proof_request_id
), loader_pick as materialized (
  select candidate.verification_attempt_id
    from app.load_next_private_telebirr_shadow_staged_evidence() candidate
   limit 1
), loader_pick_target as materialized (
  select loader_pick.verification_attempt_id
    from loader_pick
    join target_attempts attempt
      on attempt.id = loader_pick.verification_attempt_id
), target_loader_base_candidates as materialized (
  select staged.verification_attempt_id,
         staged.observation_body_digest
    from target_staged staged
    join target_proof proof
      on proof.id = staged.shadow_proof_request_id
     and proof.verification_job_id = staged.verification_job_id
    cross join authority_at
   where app.private_telebirr_shadow_mode_is_ready(proof.pilot_revision_id)
     and authority_at.value >= proof.not_before
     and authority_at.value < proof.submitted_at + interval '12 hours'
     and staged.staged_at < proof.expires_at
     and staged.staged_at < staged.attempt_expires_at
     and staged.observed_at >= staged.issued_at
     and staged.observed_at < staged.attempt_expires_at
     and exists (
       select 1
         from app.private_live_telebirr_receiver_profiles profile
        where profile.id = proof.receiver_profile_id
          and authority_at.value >= profile.valid_from
          and authority_at.value < profile.valid_until
     )
     and exists (
       select 1
         from app.private_live_telebirr_device_enrollments enrollment
        where enrollment.id = staged.attempt_device_enrollment_id
          and authority_at.value >= enrollment.valid_from
          and authority_at.value < enrollment.valid_until
          and not exists (
            select 1
              from app.private_live_telebirr_device_revocations revocation
             where revocation.device_enrollment_id = enrollment.id
               and revocation.revoked_at <= authority_at.value
          )
     )
     and exists (
       select 1
         from app.private_telebirr_shadow_assignment_transcripts transcript
         join app.private_live_telebirr_assignment_signers signer
           on signer.id = transcript.assignment_signer_id
        where transcript.verification_attempt_id = staged.verification_attempt_id
          and authority_at.value >= signer.valid_from
          and authority_at.value < signer.valid_until
          and not exists (
            select 1
              from app.private_live_telebirr_assignment_signer_revocations revocation
             where revocation.assignment_signer_id = signer.id
               and revocation.revoked_at <= authority_at.value
          )
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.verification_attempt_id = staged.verification_attempt_id
           or outcome.completion_request_key = staged.lease_request_key
           or outcome.shadow_proof_request_id = proof.id
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_evidence_quarantine quarantine
        where quarantine.verification_attempt_id = staged.verification_attempt_id
           or quarantine.observation_body_digest = staged.observation_body_digest
     )
), financial_gates as materialized (
  select
    not exists (
      select 1
        from app.private_trusted_telebirr_activation_control activation_control
        join app.private_trusted_telebirr_activation_epochs activation_epoch
          on activation_epoch.epoch = activation_control.current_epoch
        join app.private_live_deposit_pilot_revisions authority_pilot
          on authority_pilot.id = activation_epoch.pilot_revision_id
        cross join authority_at
       where activation_control.control_key = 'trusted_telebirr_financial_authority'
         and activation_epoch.authority_state = 'active'
         and activation_epoch.revoked_at is null
         and authority_at.value >= activation_epoch.active_from
         and authority_at.value < activation_epoch.expires_at
         and authority_pilot.status = 'armed'
         and authority_pilot.configuration_digest = activation_epoch.configuration_digest
    ) as trusted_authority_inactive,
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
), status as materialized (
  select
    (select pg_catalog.count(*) = 1 from target_retry) as retry_present,
    (select pg_catalog.count(*) = 1 from target_proof) as proof_present,
    coalesce((
      select app.private_telebirr_shadow_authority_deadline_retry_is_valid(
               proof.id,
               retry.retry_request_key
             )
        from target_retry retry
        join target_proof proof on true
    ), false) as retry_valid,
    coalesce((
      select authority_at.value >= retry.authorized_at
         and authority_at.value < retry.authorized_at + interval '12 hours'
        from target_retry retry
        cross join authority_at
    ), false) as review_window_open,
    coalesce((
      select app.private_telebirr_shadow_mode_is_ready(proof.pilot_revision_id)
        from target_proof proof
    ), false) as shadow_mode_ready,
    (select pg_catalog.count(*)::integer from target_attempts) as attempt_count,
    (select pg_catalog.count(*)::integer from target_staged) as staged_count,
    (select pg_catalog.count(*)::integer
       from target_staged staged
       join target_retry retry on staged.staged_at >= retry.authorized_at
    ) as staged_after_authorization_count,
    (select pg_catalog.count(*)::integer
       from target_staged staged
      where not exists (
        select 1 from target_quarantines quarantine
         where quarantine.verification_attempt_id = staged.verification_attempt_id
            or quarantine.observation_body_digest = staged.observation_body_digest
      )
    ) as unquarantined_staged_count,
    (select pg_catalog.count(*)::integer from target_quarantines) as quarantine_count,
    not exists (
      select 1 from target_quarantines quarantine
       where quarantine.reason_code <> 'trusted_evidence_invalid'
    ) as quarantine_reasons_expected,
    (select pg_catalog.count(*)::integer from target_outcomes) as outcome_count,
    coalesce((
      select case
        when outcome.disposition = 'settlement_candidate'
          and outcome.reason_code = 'exact_proof_match'
          and outcome.would_verify
          and outcome.protocol_disposition = 'would_forward_signed_evidence'
          and outcome.protocol_reason_code = 'signed_evidence_verified'
          and outcome.principal_amount_minor = 2500
          and outcome.occurred_at is not null
          and outcome.receiver_identity_digest ~ '^sha256:[0-9a-f]{64}$'
          then 'would_verify_exact_25_etb_match'
        when outcome.disposition = 'review_required'
          and not outcome.would_verify
          and outcome.reason_code in (
            'invalid_assessment_input', 'database_facts_unbound',
            'policy_unavailable', 'policy_contract_mismatch',
            'eligibility_unavailable', 'eligibility_ambiguous',
            'duplicate_check_unavailable', 'duplicate_check_ambiguous',
            'source_unavailable', 'source_ambiguous', 'source_uncertain',
            'source_unsupported', 'observation_version_unsupported',
            'parser_uncertain', 'receipt_pending', 'receipt_status_unknown',
            'transaction_type_unsupported', 'receiver_history_gap',
            'receiver_history_overlap', 'receiver_history_unavailable',
            'receiver_match_basis_unsupported', 'amount_out_of_range',
            'receipt_too_old', 'receipt_after_submission', 'future_skew_exceeded'
          )
          and outcome.principal_amount_minor is null
          and outcome.occurred_at is null
          and outcome.receiver_identity_digest is null
          then 'would_review'
        when outcome.disposition = 'definite_reject'
          and not outcome.would_verify
          and outcome.reason_code in (
            'player_ineligible', 'duplicate_reference_reused',
            'reference_not_found', 'provider_mismatch', 'reference_mismatch',
            'receipt_failed', 'currency_not_etb', 'receiver_mismatch'
          )
          and outcome.principal_amount_minor is null
          and outcome.occurred_at is null
          and outcome.receiver_identity_digest is null
          then 'would_reject'
        else 'inconsistent_shadow_outcome'
      end
        from target_outcomes outcome
    ), 'none') as outcome_class,
    coalesce((
      select case
        when outcome.reason_code in (
          'exact_proof_match', 'player_ineligible', 'duplicate_reference_reused',
          'reference_not_found', 'provider_mismatch', 'reference_mismatch',
          'receipt_failed', 'currency_not_etb', 'receiver_mismatch',
          'invalid_assessment_input', 'database_facts_unbound',
          'policy_unavailable', 'policy_contract_mismatch',
          'eligibility_unavailable', 'eligibility_ambiguous',
          'duplicate_check_unavailable', 'duplicate_check_ambiguous',
          'source_unavailable', 'source_ambiguous', 'source_uncertain',
          'source_unsupported', 'observation_version_unsupported',
          'parser_uncertain', 'receipt_pending', 'receipt_status_unknown',
          'transaction_type_unsupported', 'receiver_history_gap',
          'receiver_history_overlap', 'receiver_history_unavailable',
          'receiver_match_basis_unsupported', 'amount_out_of_range',
          'receipt_too_old', 'receipt_after_submission', 'future_skew_exceeded'
        ) then outcome.reason_code
        else 'unexpected_reason_code'
      end
        from target_outcomes outcome
    ), 'none') as outcome_reason_class,
    coalesce((
      select outcome.created_at >= retry.authorized_at
         and outcome.created_at < retry.authorized_at + interval '12 hours'
        from target_outcomes outcome
        join target_retry retry on true
    ), false) as outcome_created_inside_review_window,
    (select pg_catalog.count(*)::integer from target_loader_base_candidates)
      as target_loader_base_candidate_count,
    (select pg_catalog.count(*)::integer from loader_pick) as global_loader_row_count,
    exists (select 1 from loader_pick_target) as global_loader_returns_target,
    exists (select 1 from loader_pick)
      and not exists (select 1 from loader_pick_target) as global_loader_returns_other,
    financial_gates.*
    from financial_gates
), classified as materialized (
  select status.*,
         case
           when status.outcome_count = 1 then 'target_outcome_present'
           when status.staged_count > 0
             and status.unquarantined_staged_count = 0
             and status.quarantine_count > 0
             then 'all_target_evidence_quarantined'
           when status.target_loader_base_candidate_count = 0
             then 'target_loader_gates_closed'
           when status.global_loader_row_count = 0
             then 'global_loader_empty_despite_target_candidate'
           when status.global_loader_returns_other
             then 'different_global_candidate_precedes_target'
           when status.global_loader_returns_target
             then 'target_is_next_loader_candidate'
           else 'inconsistent_read_only_snapshot'
         end as loader_state
    from status
)
select pg_catalog.to_jsonb(classified) || pg_catalog.jsonb_build_object(
         'schemaVersion', 1,
         'operation', 'telebirr_shadow_authority_deadline_status',
         'deploymentTarget', 'production',
         'minimumReviewWindowHours', 12,
         'inspectionOnly', true,
         'financialBoundary', 'dry_run',
         'kemerBetExecutionEnabled', false,
         'moneyMoved', false
       )
  from classified;

rollback;
