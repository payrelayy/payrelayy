\set ON_ERROR_STOP on
\set QUIET on
\getenv reviewed_main_commit_sha REVIEWED_MAIN_COMMIT_SHA

begin isolation level read committed;

create temp table reviewed_source_binding_window_retry_result
on commit drop
as
select *
  from app.retry_reviewed_private_telebirr_source_binding_shadow_window(
    :'reviewed_main_commit_sha',
    'reviewed_source_binding_shadow_window_retry_no_credit'
  );

do $validate_redacted_source_binding_window_retry_result$
begin
  if (select pg_catalog.count(*) from reviewed_source_binding_window_retry_result) <> 1
    or not exists (
      select 1
        from reviewed_source_binding_window_retry_result result
       where result.window_retry_count = 1
         and result.shadow_request_count = 1
         and result.source_shadow_attempt_count = 0
         and result.source_shadow_outcome_count = 0
         and result.replacement_shadow_attempt_count = 0
         and result.replacement_shadow_outcome_count = 0
         and result.configured_window_seconds = 43200
         and result.remaining_seconds between 42601 and 43205
         and not result.money_moved
    ) then
    raise exception 'The redacted source-binding window retry result is invalid.';
  end if;
end;
$validate_redacted_source_binding_window_retry_result$;

with exact_retry as materialized (
  select retry.*,
         source_recovery.source_live_proof_id,
         source_recovery.source_live_outcome_id
    from app.private_telebirr_shadow_source_binding_window_retries retry
    join app.private_live_telebirr_source_binding_shadow_recoveries source_recovery
      on source_recovery.recovery_request_key = retry.source_recovery_request_key
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.reason_code =
         'reviewed_source_binding_shadow_window_retry_no_credit'
     and retry.reviewed_main_commit_sha = :'reviewed_main_commit_sha'
     and proof.proof_status = 'verification_queued'
     and proof.expires_at > pg_catalog.clock_timestamp()
     and app.private_telebirr_shadow_source_binding_window_retry_is_valid(
           proof.id,
           retry.retry_request_key
         )
), money_state as materialized (
  select
    (select pg_catalog.count(*)
       from app.private_live_deposit_pilot_reservations reservation
       join exact_retry retry
         on retry.source_live_proof_id =
            reservation.private_live_deposit_pilot_proof_id) as reservations,
    (select pg_catalog.count(*)
       from app.private_live_telebirr_settlement_receipts receipt
       join exact_retry retry
         on retry.source_live_outcome_id = receipt.verification_outcome_id)
      as settlement_receipts,
    (select pg_catalog.count(*)
       from app.deposit_jobs job
       join app.private_live_telebirr_settlement_receipts receipt
         on receipt.execution_job_id = job.id
       join exact_retry retry
         on retry.source_live_outcome_id = receipt.verification_outcome_id)
      as deposit_jobs
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
         on pilot.id = retry.target_pilot_revision_id
      where feature_switch.feature_key = 'private_live_deposit_pilot'
        and feature_switch.mode = 'dry_run'
        and feature_switch.settings = pg_catalog.jsonb_build_object(
          'contract_version', 1,
          'pilot_revision_id', pilot.id,
          'configuration_digest', pilot.configuration_digest
        )) as dry_run_pilot_switches,
    (select pg_catalog.count(*)
       from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin) as kemerbet_login_roles,
    (select pg_catalog.count(*)
       from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      ) and activity.pid <> pg_catalog.pg_backend_pid()) as kemerbet_sessions,
    (select pg_catalog.count(*)
       from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and role.rolcanlogin) as verifier_login_roles,
    (select pg_catalog.count(*)
       from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and activity.pid <> pg_catalog.pg_backend_pid()) as verifier_sessions,
    (select pg_catalog.count(*)
       from app.agent_platform_companion_execution_control execution_control
      where execution_control.singleton
        and execution_control.control_state = 'disabled') as disabled_companion_controls,
    case when app.current_private_trusted_telebirr_activation_epoch() is null
      then 0 else 1 end as active_telebirr_epochs
), retry_state as materialized (
  select
    (select pg_catalog.count(*) from exact_retry) as retries,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_proof_requests proof
       join exact_retry retry
         on retry.replacement_shadow_proof_request_id = proof.id)
      as shadow_requests,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_attempts attempt
       join exact_retry retry
         on retry.source_shadow_proof_request_id = attempt.shadow_proof_request_id)
      as source_attempts,
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
        retry.target_pilot_revision_id,
        retry.target_receiver_profile_id,
        retry.device_enrollment_id,
        retry.assignment_signer_id,
        pg_catalog.clock_timestamp() + interval '5 minutes'
      )) as ready_enrollments
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'reviewed_source_binding_shadow_window_retry',
  'deploymentTarget', 'production',
  'created', result.created,
  'windowRetryCount', state.retries,
  'shadowRequestCount', state.shadow_requests,
  'sourceShadowAttemptCount', state.source_attempts,
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
  'kemerBetLoginRoles', boundary.kemerbet_login_roles,
  'kemerBetSessions', boundary.kemerbet_sessions,
  'verifierLoginRoles', boundary.verifier_login_roles,
  'verifierSessions', boundary.verifier_sessions,
  'reservations', money.reservations,
  'settlementReceipts', money.settlement_receipts,
  'depositJobs', money.deposit_jobs,
  'moneyMoved', result.money_moved,
  'identifiersRedacted', true
)::text
  from reviewed_source_binding_window_retry_result result
 cross join retry_state state
 cross join boundary
 cross join money_state money;

commit;
