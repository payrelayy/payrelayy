\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_verification_job_id TARGET_VERIFICATION_JOB_ID
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_verification_job_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
  as exact_eligibility_contract
\gset
\if :exact_eligibility_contract
\else
  \warn 'The redacted staged-attempt eligibility contract is invalid.'
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
     and job.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and job.recovery_reason_code = 'assignment_runtime_unavailable'
     and job.recovered_at is not null
     and job.recovery_request_key is not null
), attempts as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join target job on job.id = attempt.verification_job_id
), transcripts as materialized (
  select transcript.* from app.private_live_telebirr_assignment_transcripts transcript
  join attempts attempt on attempt.id = transcript.verification_attempt_id
), deliveries as materialized (
  select delivery.* from app.private_live_telebirr_assignment_deliveries delivery
  join attempts attempt on attempt.id = delivery.verification_attempt_id
), evidence as materialized (
  select staged.*,
         staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
           as source_document_digest
    from app.private_live_telebirr_device_evidence_staging staged
    join attempts attempt on attempt.id = staged.verification_attempt_id
), outcomes as materialized (
  select outcome.* from app.private_live_telebirr_verification_outcomes outcome
  join target job on job.id = outcome.verification_job_id
), reservations as materialized (
  select reservation.* from app.private_live_deposit_pilot_reservations reservation
  join target job on job.private_live_deposit_pilot_proof_id =
                     reservation.private_live_deposit_pilot_proof_id
), settlement_receipts as materialized (
  select receipt.* from app.private_live_telebirr_settlement_receipts receipt
  join outcomes outcome on outcome.id = receipt.verification_outcome_id
), execution_jobs as materialized (
  select execution_job.* from app.deposit_jobs execution_job
  join settlement_receipts receipt on receipt.execution_job_id = execution_job.id
), summary as materialized (
  select
    (select count(*)::integer from target) as targets,
    (select count(*)::integer from attempts) as attempts,
    (select count(*)::integer from attempts attempt
      where attempt.expires_at <= pg_catalog.clock_timestamp()) as expired_attempts,
    (select count(*)::integer from transcripts) as transcripts,
    (select count(*)::integer from deliveries) as deliveries,
    (select count(*)::integer from evidence) as evidence,
    (select count(*)::integer from evidence staged join attempts attempt
       on attempt.id = staged.verification_attempt_id
      where staged.observed_at >= attempt.issued_at
        and staged.observed_at < attempt.expires_at
        and staged.staged_at < attempt.expires_at
        and staged.source_document_digest ~ '^sha256:[0-9a-f]{64}$') as on_time_evidence,
    (select count(*)::integer from outcomes) as outcomes,
    (select count(*)::integer from reservations) as reservations,
    (select count(*)::integer from settlement_receipts) as settlements,
    (select count(*)::integer from execution_jobs) as execution_jobs,
    (select count(*)::integer
       from app.private_live_telebirr_historical_completion_authorities authority
       join target job on job.id = authority.verification_job_id) as authorities,
    (select count(*)::integer
       from app.private_live_telebirr_verifier_evidence_quarantine quarantine
       join evidence staged on quarantine.verification_attempt_id = staged.verification_attempt_id
                            or quarantine.observation_body_digest = staged.observation_body_digest)
      as quarantines,
    (select count(*)::integer
       from app.private_live_telebirr_settlement_documents settled
       join evidence staged on staged.source_document_digest = settled.source_document_digest)
      as settled_documents,
    (select count(*)::integer
       from app.provider_payment_evidence payment_evidence
       join target job on payment_evidence.payment_provider_id = job.payment_provider_id
                      and payment_evidence.canonical_reference_fingerprint =
                          job.candidate_reference_fingerprint) as used_payments,
    (select count(*)::integer
       from target job
       join app.private_live_deposit_pilot_proofs proof
         on proof.id = job.private_live_deposit_pilot_proof_id
      where proof.submitted_at + interval '24 hours' >=
            pg_catalog.clock_timestamp() + interval '12 hours 5 minutes') as proof_windows,
    (select count(*)::integer
       from target job
       join app.private_live_deposit_pilot_revisions pilot on pilot.id = job.pilot_revision_id
      where pilot.status = 'armed'
        and pg_catalog.clock_timestamp() >= pilot.active_from
        and pg_catalog.clock_timestamp() < pilot.expires_at) as live_pilots,
    (select count(*)::integer
       from app.private_trusted_telebirr_activation_control control
       join app.private_trusted_telebirr_activation_epochs activation
         on activation.epoch = control.current_epoch
       join target job on job.pilot_revision_id = activation.pilot_revision_id
      where control.control_key = 'trusted_telebirr_financial_authority'
        and activation.epoch = :'target_activation_epoch'::bigint
        and activation.authority_state = 'active'
        and activation.revoked_at is null
        and activation.expires_at > pg_catalog.clock_timestamp()) as live_activations,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'deposit_execution', 'payment_verification',
        'private_live_deposit_pilot', 'telebirr_authoritative_verification'
      ) and feature_switch.mode = 'live') as live_switches,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation'
      ) and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb) as disabled_switches,
    (select count(*)::integer from pg_catalog.pg_roles role
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
), classified as materialized (
  select summary.*,
         case
           when targets <> 1 then 'target_not_exact'
           when attempts <> 1 or expired_attempts <> 1 or transcripts <> 1
             or deliveries <> 1 then 'attempt_shape_mismatch'
           when evidence <> 1 or on_time_evidence <> 1 then 'evidence_shape_mismatch'
           when outcomes <> 0 or reservations <> 0 or settlements <> 0
             or execution_jobs <> 0 then 'downstream_rows_present'
           when authorities <> 0 then 'recovery_already_recorded'
           when quarantines <> 0 then 'evidence_quarantined'
           when settled_documents <> 0 or used_payments <> 0 then 'payment_already_used'
           when proof_windows <> 1 then 'proof_window_unavailable'
           when live_pilots <> 1 or live_activations <> 1 then 'pilot_authority_unavailable'
           when live_switches <> 4 or disabled_switches <> 3 then 'switch_boundary_unavailable'
           when verifier_sessions <> 0 then 'verifier_not_inert'
           when kemer_logins <> 0 or kemer_sessions <> 0 then 'kemerbet_enabled'
           else 'eligible'
         end as reason_code
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_staged_attempt_eligibility',
  'deploymentTarget', 'production',
  'eligibilityState', case when classified.reason_code = 'eligible'
    then 'eligible' else 'ineligible' end,
  'reasonCode', classified.reason_code,
  'targetCount', classified.targets,
  'attempts', classified.attempts,
  'expiredAttempts', classified.expired_attempts,
  'assignmentTranscripts', classified.transcripts,
  'assignmentDeliveries', classified.deliveries,
  'deviceEvidence', classified.evidence,
  'outcomes', classified.outcomes,
  'reservations', classified.reservations,
  'settlementReceipts', classified.settlements,
  'depositExecutionJobs', classified.execution_jobs,
  'historicalAuthorities', classified.authorities,
  'trustedVerifierSessions', classified.verifier_sessions,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
