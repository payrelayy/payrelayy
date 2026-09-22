\set ON_ERROR_STOP on
\set QUIET on
\getenv reviewed_main_commit_sha REVIEWED_MAIN_COMMIT_SHA

begin isolation level read committed;

create temp table reviewed_receipt_cell_opening_retry_result
on commit drop
as
select *
  from app.retry_reviewed_private_telebirr_receipt_cell_opening(
    :'reviewed_main_commit_sha',
    'reviewed_receipt_cell_opening_retry_no_credit'
  );

do $validate_redacted_receipt_cell_opening_retry_result$
begin
  if (select pg_catalog.count(*) from reviewed_receipt_cell_opening_retry_result) <> 1
    or not exists (
      select 1
        from reviewed_receipt_cell_opening_retry_result result
       where result.receipt_cell_opening_retry_count = 1
         and result.shadow_request_count = 1
         and result.source_shadow_attempt_count between 1 and 100
         and result.source_staged_evidence_count = result.source_shadow_attempt_count
         and result.source_receipt_cell_opening_review_count =
             result.source_shadow_attempt_count
         and result.source_shadow_outcome_count = 1
         and result.replacement_shadow_attempt_count = 0
         and result.replacement_shadow_outcome_count = 0
         and result.ready_enrollment_count = 1
         and result.configured_window_seconds = 43200
         and result.remaining_seconds between 42601 and 43205
         and not result.money_moved
    ) then
    raise exception 'The redacted receipt-cell-opening retry result is invalid.';
  end if;
end;
$validate_redacted_receipt_cell_opening_retry_result$;

with exact_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_receipt_cell_opening_retries retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.reason_code = 'reviewed_receipt_cell_opening_retry_no_credit'
     and retry.reviewed_main_commit_sha = :'reviewed_main_commit_sha'
     and proof.proof_status = 'verification_queued'
     and proof.expires_at > pg_catalog.clock_timestamp()
     and app.private_telebirr_shadow_receipt_cell_opening_retry_is_valid(
           proof.id,
           retry.retry_request_key
         )
), retry_state as materialized (
  select
    (select pg_catalog.count(*) from exact_retry) as retries,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_proof_requests proof
       join exact_retry retry
         on retry.replacement_shadow_proof_request_id = proof.id) as shadow_requests,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_attempts attempt
       join exact_retry retry
         on retry.source_shadow_proof_request_id = attempt.shadow_proof_request_id)
      as source_attempts,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_device_evidence_staging staged
       join app.private_telebirr_shadow_verification_attempts attempt
         on attempt.id = staged.verification_attempt_id
       join exact_retry retry
         on retry.source_shadow_proof_request_id = attempt.shadow_proof_request_id)
      as source_staged,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_device_evidence_staging staged
       join app.private_telebirr_shadow_verification_attempts attempt
         on attempt.id = staged.verification_attempt_id
       join exact_retry retry
         on retry.source_shadow_proof_request_id = attempt.shadow_proof_request_id
      where staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
            'unknown_layout_invoice_number') as source_receipt_cell_opening_reviews,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_retry retry
         on retry.source_shadow_proof_request_id = outcome.shadow_proof_request_id)
      as source_outcomes,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_attempts attempt
       join exact_retry retry
         on retry.replacement_shadow_proof_request_id = attempt.shadow_proof_request_id)
      as replacement_attempts,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_retry retry
         on retry.replacement_shadow_proof_request_id = outcome.shadow_proof_request_id)
      as replacement_outcomes,
    (select pg_catalog.count(*)
       from exact_retry retry
      where app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
        retry.pilot_revision_id,
        retry.receiver_profile_id,
        retry.device_enrollment_id,
        retry.assignment_signer_id,
        pg_catalog.clock_timestamp() + interval '5 minutes'
      )) as ready_enrollments
), boundary as materialized (
  select
    (select pg_catalog.count(*)
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
        and feature_switch.settings = '{}'::jsonb) as disabled_financial_switches,
    (select pg_catalog.count(*)
       from app.feature_switches feature_switch
       join exact_retry retry on true
       join app.private_live_deposit_pilot_revisions pilot
         on pilot.id = retry.pilot_revision_id
      where feature_switch.feature_key = 'private_live_deposit_pilot'
        and feature_switch.mode = 'dry_run'
        and feature_switch.settings = pg_catalog.jsonb_build_object(
          'contract_version', 1,
          'pilot_revision_id', pilot.id,
          'configuration_digest', pilot.configuration_digest
        )) as dry_run_pilot_switches,
    case when app.current_private_trusted_telebirr_activation_epoch() is null
      then 0 else 1 end as active_telebirr_epochs,
    (select pg_catalog.count(*)
       from app.agent_platform_companion_execution_control control
      where control.singleton and control.control_state = 'disabled')
      as disabled_companion_controls,
    (select pg_catalog.count(*) from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and role.rolcanlogin) as execution_login_roles,
    (select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and activity.pid <> pg_catalog.pg_backend_pid()) as execution_sessions
), money_state as materialized (
  select
    (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations)
      as reservations,
    (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts)
      as settlement_receipts,
    (select pg_catalog.count(*) from app.deposit_jobs) as deposit_jobs,
    (select pg_catalog.count(*)
       from app.provider_payment_evidence evidence
       join app.private_telebirr_shadow_proof_requests proof
         on proof.payment_provider_id = evidence.payment_provider_id
        and proof.candidate_reference_fingerprint =
            evidence.canonical_reference_fingerprint
       join exact_retry retry
         on retry.replacement_shadow_proof_request_id = proof.id) as provider_evidence
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'reviewed_receipt_cell_opening_retry',
  'deploymentTarget', 'production',
  'created', result.created,
  'cellOpeningRetryCount', state.retries,
  'shadowRequestCount', state.shadow_requests,
  'sourceShadowAttemptCount', state.source_attempts,
  'sourceStagedEvidenceCount', state.source_staged,
  'sourceReceiptCellOpeningReviewCount', state.source_receipt_cell_opening_reviews,
  'sourceShadowOutcomeCount', state.source_outcomes,
  'replacementShadowAttemptCount', state.replacement_attempts,
  'replacementShadowOutcomeCount', state.replacement_outcomes,
  'readyEnrollmentCount', state.ready_enrollments,
  'configuredWindowSeconds', result.configured_window_seconds,
  'remainingSeconds', result.remaining_seconds,
  'disabledFinancialSwitches', boundary.disabled_financial_switches,
  'dryRunPilotSwitches', boundary.dry_run_pilot_switches,
  'activeTelebirrEpochs', boundary.active_telebirr_epochs,
  'disabledCompanionControls', boundary.disabled_companion_controls,
  'executionLoginRoles', boundary.execution_login_roles,
  'executionSessions', boundary.execution_sessions,
  'reservations', money.reservations,
  'settlementReceipts', money.settlement_receipts,
  'depositJobs', money.deposit_jobs,
  'providerEvidence', money.provider_evidence,
  'moneyMoved', result.money_moved,
  'identifiersRedacted', true
)::text
  from reviewed_receipt_cell_opening_retry_result result
 cross join retry_state state
 cross join boundary
 cross join money_state money;

commit;
