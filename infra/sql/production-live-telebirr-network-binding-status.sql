\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_status_contract
\gset
\if :exact_status_contract
\else
  \warn 'The redacted live TeleBirr status contract is invalid.'
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
   where job.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and job.network_retry_reason_code = 'official_receipt_network_unavailable'
     and job.network_binding_recovery_request_key = :'recovery_request_key'::uuid
     and job.network_binding_recovery_reason_code =
         'network_retry_reference_binding_registry'
), attempts as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join target job on job.id = attempt.verification_job_id
), assignment_transcripts as materialized (
  select transcript.*
    from app.private_live_telebirr_assignment_transcripts transcript
    join attempts attempt on attempt.id = transcript.verification_attempt_id
), assignment_deliveries as materialized (
  select delivery.*
    from app.private_live_telebirr_assignment_deliveries delivery
    join attempts attempt on attempt.id = delivery.verification_attempt_id
), device_evidence as materialized (
  select evidence.*
    from app.private_live_telebirr_device_evidence_staging evidence
    join attempts attempt on attempt.id = evidence.verification_attempt_id
), observations as materialized (
  select observation.*
    from app.private_live_telebirr_observation_transcripts observation
    join attempts attempt on attempt.id = observation.verification_attempt_id
), outcomes as materialized (
  select outcome.*
    from app.private_live_telebirr_verification_outcomes outcome
    join target job on job.id = outcome.verification_job_id
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
), queued_deposit_jobs as materialized (
  select deposit_job.*
    from app.deposit_jobs deposit_job
    join settlement_receipts receipt on receipt.execution_job_id = deposit_job.id
   where deposit_job.status = 'queued'
     and deposit_job.attempt_count = 0
     and deposit_job.lease_token is null
     and deposit_job.leased_by is null
     and deposit_job.lease_expires_at is null
     and deposit_job.completed_at is null
), kemer_login_roles as materialized (
  select role.oid
    from pg_catalog.pg_roles role
   where role.rolname in (
     'fetanagent_deposit_executor',
     'fetanagent_deposit_executor_runtime'
   ) and role.rolcanlogin
), kemer_sessions as materialized (
  select activity.pid
    from pg_catalog.pg_stat_activity activity
   where activity.usename in (
     'fetanagent_deposit_executor',
     'fetanagent_deposit_executor_runtime'
   )
), summary as materialized (
  select (select count(*)::integer from target) as target_count,
         (select count(*)::integer from attempts) as attempts,
         (select count(*)::integer from assignment_transcripts) as transcripts,
         (select count(*)::integer from assignment_deliveries) as deliveries,
         (select count(*)::integer from device_evidence) as evidence,
         (select count(*)::integer from observations) as observations,
         (select count(*)::integer from outcomes) as outcomes,
         (select count(*)::integer from reservations) as reservations,
         (select count(*)::integer from settlement_receipts) as settlements,
         (select count(*)::integer from queued_deposit_jobs) as queued_jobs,
         (select count(*)::integer from kemer_login_roles) as kemer_logins,
         (select count(*)::integer from kemer_sessions) as kemer_sessions,
         (select outcome.disposition from outcomes outcome limit 1) as disposition,
         (select outcome.reason_code from outcomes outcome limit 1) as reason_code,
         (select job.expires_at from target job limit 1) as expires_at,
         coalesce((
           select pg_catalog.bool_and(
             job.network_retry_source_job_id is not null
             and job.network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
             and job.network_binding_original_expires_at is not null
             and job.network_binding_recovered_at is not null
             and job.network_binding_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
             and job.network_binding_recovery_reason_code =
                 'network_retry_reference_binding_registry'
           ) from target job
         ), false) as recovery_shape_valid
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_network_binding_status',
  'deploymentTarget', 'production',
  'targetCount', summary.target_count,
  'verificationState', case
    when summary.target_count <> 1
      or not summary.recovery_shape_valid
      or summary.kemer_logins <> 0
      or summary.kemer_sessions <> 0
      or summary.attempts not between 2 and 3
      or summary.transcripts not between 0 and 1
      or summary.deliveries not between 0 and 1
      or summary.evidence not between 0 and 1
      or summary.observations not between 0 and 1
      or summary.outcomes not between 0 and 1
      or summary.reservations not between 0 and 1
      or summary.settlements not between 0 and 1
      or summary.queued_jobs not between 0 and 1
      then 'invalid'
    when summary.outcomes = 0 and summary.expires_at <= pg_catalog.clock_timestamp()
      then 'expired'
    when summary.outcomes = 0
      then 'waiting'
    when summary.disposition = 'settlement_candidate'
      and summary.reason_code = 'exact_proof_match'
      and summary.attempts = 3
      and summary.transcripts = 1
      and summary.deliveries = 1
      and summary.evidence = 1
      and summary.observations = 1
      and summary.reservations = 1
      and summary.settlements = 1
      and summary.queued_jobs = 1
      then 'queued'
    when summary.disposition = 'review_required'
      and summary.reservations = 0
      and summary.settlements = 0
      and summary.queued_jobs = 0
      then 'review_required'
    when summary.disposition = 'definite_reject'
      and summary.reservations = 0
      and summary.settlements = 0
      and summary.queued_jobs = 0
      then 'definite_reject'
    else 'invalid'
  end,
  'outcomeReasonCode', coalesce(summary.reason_code, 'pending'),
  'remainingSeconds', greatest(
    0,
    floor(extract(epoch from (
      summary.expires_at - pg_catalog.clock_timestamp()
    )))::integer
  ),
  'attempts', summary.attempts,
  'assignmentTranscripts', summary.transcripts,
  'assignmentDeliveries', summary.deliveries,
  'deviceEvidence', summary.evidence,
  'observations', summary.observations,
  'outcomes', summary.outcomes,
  'reservations', summary.reservations,
  'settlementReceipts', summary.settlements,
  'queuedDepositJobs', summary.queued_jobs,
  'kemerBetLoginRoles', summary.kemer_logins,
  'kemerBetSessions', summary.kemer_sessions,
  'executionEnabled', summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
)::text
from summary;

commit;
