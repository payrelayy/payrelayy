\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv historical_completion_request_key HISTORICAL_COMPLETION_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'historical_completion_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_status_contract
\gset
\if :exact_status_contract
\else
  \warn 'The expired-evidence status contract is invalid.'
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
with authority as materialized (
  select recovery.*
    from app.private_live_telebirr_historical_completion_authorities recovery
   where recovery.request_key = :'historical_completion_request_key'::uuid
     and recovery.pilot_revision_id = :'target_pilot_revision_id'::uuid
), target as materialized (
  select job.*
    from app.private_live_telebirr_verification_jobs job
    join authority recovery on recovery.verification_job_id = job.id
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
), consumptions as materialized (
  select consumption.*
    from app.private_live_telebirr_historical_completion_consumptions consumption
    join authority recovery on recovery.request_key = consumption.request_key
), closures as materialized (
  select closure.*
    from app.private_live_telebirr_historical_completion_closures closure
    join authority recovery on recovery.request_key = closure.request_key
), reservations as materialized (
  select reservation.*
    from app.private_live_deposit_pilot_reservations reservation
    join target job
      on job.private_live_deposit_pilot_proof_id =
         reservation.private_live_deposit_pilot_proof_id
), settlement_receipts as materialized (
  select receipt.*
    from app.private_live_telebirr_settlement_receipts receipt
    join outcomes outcome on outcome.id = receipt.verification_outcome_id
), settlement_documents as materialized (
  select settled.*
    from app.private_live_telebirr_settlement_documents settled
    join outcomes outcome on outcome.id = settled.verification_outcome_id
), execution_jobs as materialized (
  select execution_job.*
    from app.deposit_jobs execution_job
    join settlement_receipts receipt on receipt.execution_job_id = execution_job.id
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
), runtime as materialized (
  select (select count(*)::integer from pg_catalog.pg_roles role
           where role.rolname in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           ) and role.rolcanlogin) as kemer_logins,
         (select count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           )) as kemer_sessions,
         (select count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_trusted_telebirr_verifier',
             'fetanagent_trusted_telebirr_verifier_runtime'
           )) as verifier_sessions
), summary as materialized (
  select (select count(*)::integer from authority) as authorities,
         (select count(*)::integer from target) as targets,
         (select count(*)::integer from attempts) as attempt_count,
         (select count(*)::integer from transcripts) as transcript_count,
         (select count(*)::integer from deliveries) as delivery_count,
         (select count(*)::integer from evidence) as evidence_count,
         (select count(*)::integer from observations) as observation_count,
         (select count(*)::integer from outcomes) as outcome_count,
         (select count(*)::integer from consumptions) as consumption_count,
         (select count(*)::integer from closures) as closure_count,
         (select count(*)::integer from reservations) as reservation_count,
         (select count(*)::integer from settlement_receipts) as settlement_count,
         (select count(*)::integer from settlement_documents) as document_count,
         (select count(*)::integer from execution_jobs) as execution_job_count,
         (select count(*)::integer from queued_jobs) as queued_job_count,
         (select outcome.disposition from outcomes outcome limit 1) as disposition,
         (select outcome.reason_code from outcomes outcome limit 1) as reason_code,
         (select recovery.expires_at from authority recovery limit 1) as expires_at,
         runtime.*
    from runtime
), classified as materialized (
  select summary.*,
         case
           when summary.authorities <> 1 or summary.targets <> 1
             or summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
             or summary.attempt_count <> 4
             or summary.transcript_count <> 2
             or summary.delivery_count <> 2
             or summary.evidence_count <> 2
             or summary.observation_count not between 0 and 1
             or summary.outcome_count not between 0 and 1
             or summary.consumption_count not between 0 and 1
             or summary.closure_count not between 0 and 1
             or summary.reservation_count not between 0 and 1
             or summary.settlement_count not between 0 and 1
             or summary.document_count not between 0 and 1
             or summary.execution_job_count not between 0 and 1
             or summary.queued_job_count not between 0 and 1
             then 'invalid'
           when summary.outcome_count = 0
             and summary.expires_at <= pg_catalog.clock_timestamp() then 'expired'
           when summary.outcome_count = 0 then 'waiting'
           when summary.disposition = 'settlement_candidate'
             and summary.reason_code = 'exact_proof_match'
             and summary.consumption_count = 1
             and summary.observation_count = 1
             and summary.reservation_count = 1
             and summary.settlement_count = 1
             and summary.document_count = 1
             and summary.execution_job_count = 1
             and summary.queued_job_count = 1 then 'queued'
           when summary.disposition = 'review_required'
             and summary.consumption_count = 1
             and summary.observation_count = 1
             and summary.reservation_count = 0
             and summary.settlement_count = 0
             and summary.document_count = 0
             and summary.execution_job_count = 0 then 'review_required'
           when summary.disposition = 'definite_reject'
             and summary.consumption_count = 1
             and summary.observation_count = 1
             and summary.reservation_count = 0
             and summary.settlement_count = 0
             and summary.document_count = 0
             and summary.execution_job_count = 0 then 'definite_reject'
           else 'invalid'
         end as verification_state
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_expired_evidence_status',
  'deploymentTarget', 'production',
  'targetCount', classified.targets,
  'verificationState', classified.verification_state,
  'outcomeReasonCode', coalesce(classified.reason_code, 'pending'),
  'remainingSeconds', coalesce(greatest(0, floor(extract(epoch from (
    classified.expires_at - pg_catalog.clock_timestamp()
  )))::integer), 0),
  'attempts', classified.attempt_count,
  'assignmentTranscripts', classified.transcript_count,
  'assignmentDeliveries', classified.delivery_count,
  'deviceEvidence', classified.evidence_count,
  'observations', classified.observation_count,
  'outcomes', classified.outcome_count,
  'authorityConsumptions', classified.consumption_count,
  'authorityClosures', classified.closure_count,
  'reservations', classified.reservation_count,
  'settlementReceipts', classified.settlement_count,
  'settlementDocuments', classified.document_count,
  'depositExecutionJobs', classified.execution_job_count,
  'queuedDepositJobs', classified.queued_job_count,
  'trustedVerifierSessions', classified.verifier_sessions,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0
)::text
from classified;

commit;
