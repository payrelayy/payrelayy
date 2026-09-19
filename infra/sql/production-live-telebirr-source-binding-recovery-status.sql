\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_verification_job_id TARGET_VERIFICATION_JOB_ID
\getenv retry_request_key SOURCE_BINDING_RETRY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_verification_job_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_status_contract
\gset
\if :exact_status_contract
\else
  \warn 'The reviewed source-binding status contract is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed read only;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
with target as materialized (
  select job.*
    from app.private_live_telebirr_verification_jobs job
   where job.id = :'target_verification_job_id'::uuid
), attempts as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join target job on job.id = attempt.verification_job_id
), transcripts as materialized (
  select transcript.*
    from app.private_live_telebirr_assignment_transcripts transcript
    join attempts attempt on attempt.id = transcript.verification_attempt_id
), deliveries as materialized (
  select delivery.*
    from app.private_live_telebirr_assignment_deliveries delivery
    join attempts attempt on attempt.id = delivery.verification_attempt_id
), evidence as materialized (
  select staged.*
    from app.private_live_telebirr_device_evidence_staging staged
    join attempts attempt on attempt.id = staged.verification_attempt_id
), observations as materialized (
  select observation.*
    from app.private_live_telebirr_observation_transcripts observation
    join attempts attempt on attempt.id = observation.verification_attempt_id
), outcomes as materialized (
  select outcome.*
    from app.private_live_telebirr_verification_outcomes outcome
    join target job on job.id = outcome.verification_job_id
), retry as materialized (
  select recovery.*
    from app.private_live_telebirr_source_binding_recovery_retries recovery
    join target job on job.id = recovery.current_verification_job_id
   where recovery.retry_request_key = :'retry_request_key'::uuid
), retry_closure as materialized (
  select closure.*
    from app.private_live_telebirr_source_binding_recovery_closures closure
    join retry recovery on recovery.retry_request_key = closure.retry_request_key
), authority as materialized (
  select completion.*
    from app.private_live_telebirr_historical_completion_authorities completion
    join retry recovery
      on recovery.original_authority_request_key = completion.request_key
), consumptions as materialized (
  select consumption.*
    from app.private_live_telebirr_historical_completion_consumptions consumption
    join authority completion on completion.request_key = consumption.request_key
), reservations as materialized (
  select reservation.*
    from app.private_live_deposit_pilot_reservations reservation
    join target job on job.private_live_deposit_pilot_proof_id =
                       reservation.private_live_deposit_pilot_proof_id
), receipts as materialized (
  select receipt.*
    from app.private_live_telebirr_settlement_receipts receipt
    join outcomes outcome on outcome.id = receipt.verification_outcome_id
), documents as materialized (
  select document.*
    from app.private_live_telebirr_settlement_documents document
    join outcomes outcome on outcome.id = document.verification_outcome_id
), execution_jobs as materialized (
  select execution_job.*
    from app.deposit_jobs execution_job
    join receipts receipt on receipt.execution_job_id = execution_job.id
), queued_jobs as materialized (
  select execution_job.*
    from execution_jobs execution_job
   where execution_job.status = 'queued'
     and execution_job.attempt_count = 0
     and execution_job.lease_token is null
     and execution_job.leased_by is null
     and execution_job.lease_expires_at is null
     and execution_job.last_error_code is null
     and execution_job.completed_at is null
), live_to_shadow_recoveries as materialized (
  select recovery.*
    from app.private_live_telebirr_source_recoveries recovery
    join target job
      on job.private_live_deposit_pilot_proof_id = recovery.source_live_proof_id
), shadow_source_proofs as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join live_to_shadow_recoveries recovery
      on recovery.replacement_shadow_proof_request_id = proof.id
), shadow_retries as materialized (
  select shadow_retry.*
    from app.private_telebirr_shadow_source_unavailable_retries shadow_retry
    join shadow_source_proofs source_proof
      on source_proof.id = shadow_retry.source_shadow_proof_request_id
), shadow_proofs as materialized (
  select source_proof.* from shadow_source_proofs source_proof
  union
  select replacement.*
    from app.private_telebirr_shadow_proof_requests replacement
    join shadow_retries shadow_retry
      on shadow_retry.replacement_shadow_proof_request_id = replacement.id
), shadow_attempts as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join shadow_proofs proof on proof.id = attempt.shadow_proof_request_id
), shadow_outcomes as materialized (
  select outcome.*
    from app.private_telebirr_shadow_verification_outcomes outcome
    join shadow_proofs proof on proof.id = outcome.shadow_proof_request_id
), latest_shadow_outcome as materialized (
  select outcome.*
    from shadow_outcomes outcome
   order by outcome.created_at desc, outcome.id desc
   limit 1
), relevant_shadow_pilots as materialized (
  select distinct proof.pilot_revision_id, proof.receiver_profile_id
    from shadow_proofs proof
), relevant_pairing_challenges as materialized (
  select challenge.*
    from app.private_live_telebirr_device_pairing_challenges challenge
    join relevant_shadow_pilots pilot
      on pilot.pilot_revision_id = challenge.pilot_revision_id
     and pilot.receiver_profile_id = challenge.receiver_profile_id
), relevant_enrollments as materialized (
  select enrollment.*
    from app.private_live_telebirr_device_enrollments enrollment
    join relevant_shadow_pilots pilot
      on pilot.pilot_revision_id = enrollment.pilot_revision_id
     and pilot.receiver_profile_id = enrollment.receiver_profile_id
   where enrollment.valid_from <= pg_catalog.clock_timestamp()
     and enrollment.valid_until > pg_catalog.clock_timestamp()
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= pg_catalog.clock_timestamp()
     )
), ready_enrollments as materialized (
  select enrollment.*
    from relevant_enrollments enrollment
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
   where heartbeat.runtime_state = 'ready'
     and heartbeat.status_code = 'no_assignment'
     and heartbeat.last_seen_at > pg_catalog.clock_timestamp() - interval '6 minutes'
), summary as materialized (
  select
    (select count(*)::integer from target) as targets,
    (select count(*)::integer from attempts) as attempts,
    (select count(*)::integer from transcripts) as transcripts,
    (select count(*)::integer from deliveries) as deliveries,
    (select count(*)::integer from evidence) as evidence,
    (select count(*)::integer from observations) as observations,
    (select count(*)::integer from outcomes) as outcomes,
    (select count(*)::integer from retry) as retries,
    (select count(*)::integer from retry_closure) as retry_closures,
    (select count(*)::integer from authority) as authorities,
    (select count(*)::integer from consumptions) as consumptions,
    (select count(*)::integer from reservations) as reservations,
    (select count(*)::integer from receipts) as receipts,
    (select count(*)::integer from documents) as documents,
    (select count(*)::integer from execution_jobs) as execution_jobs,
    (select count(*)::integer from queued_jobs) as queued_jobs,
    (select count(*)::integer from live_to_shadow_recoveries) as live_to_shadow_recoveries,
    (select count(*)::integer from shadow_proofs) as shadow_proofs,
    (select count(*)::integer from shadow_retries) as shadow_retries,
    (select count(*)::integer from shadow_attempts) as shadow_attempts,
    (select count(*)::integer from shadow_outcomes) as shadow_outcomes,
    (select disposition from latest_shadow_outcome) as latest_shadow_disposition,
    (select reason_code from latest_shadow_outcome) as latest_shadow_reason_code,
    (select count(*)::integer from relevant_pairing_challenges
      where state = 'open' and expires_at > pg_catalog.clock_timestamp())
      as open_pairing_challenges,
    (select count(*)::integer from relevant_pairing_challenges
      where state = 'completed') as completed_pairing_challenges,
    (select count(*)::integer from relevant_enrollments) as valid_enrollments,
    (select count(*)::integer from ready_enrollments) as ready_enrollments,
    (select outcome.disposition from outcomes outcome limit 1) as disposition,
    (select outcome.reason_code from outcomes outcome limit 1) as reason_code,
    (select recovery.expires_at from retry recovery limit 1) as expires_at,
    (select count(*)::integer from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime'
      )) as verifier_sessions,
    (select count(*)::integer from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin) as kemer_logins,
    (select count(*)::integer from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      )) as kemer_sessions,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation'
      ) and feature_switch.mode = 'live') as live_financial_switches,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation'
      ) and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb) as disabled_financial_switches
), classified as materialized (
  select summary.*,
    case
      when targets <> 1 or attempts <> 1 or transcripts <> 1 or deliveries <> 1
        or evidence <> 1 or retries <> 1 or authorities <> 1
        or observations not between 0 and 1 or outcomes not between 0 and 1
        or consumptions not between 0 and 1 or retry_closures not between 0 and 1
        or reservations not between 0 and 1 or receipts not between 0 and 1
        or documents not between 0 and 1 or execution_jobs not between 0 and 1
        or queued_jobs not between 0 and 1 or kemer_logins <> 0 or kemer_sessions <> 0
        or live_financial_switches <> 0 or disabled_financial_switches <> 7
        then 'invalid'
      when outcomes = 0 and expires_at <= pg_catalog.clock_timestamp() then 'expired'
      when outcomes = 0 then 'waiting'
      when disposition = 'settlement_candidate' and reason_code = 'exact_proof_match'
        and consumptions = 1 and observations = 1 and reservations = 1
        and receipts = 1 and documents = 1 and execution_jobs = 1
        and queued_jobs = 1 then 'queued'
      when disposition = 'review_required' and consumptions = 1 and observations = 1
        and reservations = 0 and receipts = 0 and documents = 0
        and execution_jobs = 0 then 'review_required'
      when disposition = 'definite_reject' and consumptions = 1 and observations = 1
        and reservations = 0 and receipts = 0 and documents = 0
        and execution_jobs = 0 then 'definite_reject'
      else 'invalid'
    end as verification_state
  from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_source_binding_recovery_status',
  'deploymentTarget', 'production',
  'targetCount', classified.targets,
  'verificationState', classified.verification_state,
  'outcomeReasonCode', coalesce(classified.reason_code, 'pending'),
  'remainingSeconds', coalesce(greatest(0, floor(extract(epoch from (
    classified.expires_at - pg_catalog.clock_timestamp()
  )))::integer), 0),
  'attempts', classified.attempts,
  'assignmentTranscripts', classified.transcripts,
  'assignmentDeliveries', classified.deliveries,
  'deviceEvidence', classified.evidence,
  'observations', classified.observations,
  'outcomes', classified.outcomes,
  'sourceBindingRetries', classified.retries,
  'sourceBindingRetryClosures', classified.retry_closures,
  'authorityConsumptions', classified.consumptions,
  'reservations', classified.reservations,
  'settlementReceipts', classified.receipts,
  'settlementDocuments', classified.documents,
  'depositExecutionJobs', classified.execution_jobs,
  'queuedDepositJobs', classified.queued_jobs,
  'liveToShadowRecoveries', classified.live_to_shadow_recoveries,
  'shadowProofRequests', classified.shadow_proofs,
  'shadowSourceUnavailableRetries', classified.shadow_retries,
  'shadowAttempts', classified.shadow_attempts,
  'shadowOutcomes', classified.shadow_outcomes,
  'latestShadowDisposition', coalesce(classified.latest_shadow_disposition, 'none'),
  'latestShadowReasonCode', coalesce(classified.latest_shadow_reason_code, 'none'),
  'openPairingChallenges', classified.open_pairing_challenges,
  'completedPairingChallenges', classified.completed_pairing_challenges,
  'validVerifierEnrollments', classified.valid_enrollments,
  'readyVerifierEnrollments', classified.ready_enrollments,
  'trustedVerifierSessions', classified.verifier_sessions,
  'financialSwitchesLive', classified.live_financial_switches,
  'financialSwitchesDisabled', classified.disabled_financial_switches,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text from classified;

commit;
