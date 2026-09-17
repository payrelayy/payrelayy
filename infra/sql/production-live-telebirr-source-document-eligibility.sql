\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH
\getenv network_binding_recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY
\getenv source_document_recovery_request_key SOURCE_DOCUMENT_RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'network_binding_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'source_document_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_eligibility_contract
\gset
\if :exact_eligibility_contract
\else
  \warn 'The redacted live TeleBirr source-document eligibility contract is invalid.'
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
     and job.network_binding_recovery_request_key =
         :'network_binding_recovery_request_key'::uuid
     and job.network_binding_recovery_reason_code =
         'network_retry_reference_binding_registry'
     and (
       job.source_document_retry_request_key is null
       or job.source_document_retry_request_key =
          :'source_document_recovery_request_key'::uuid
     )
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
  select staged.*,
         staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
           as source_document_digest
    from app.private_live_telebirr_device_evidence_staging staged
    join attempts attempt on attempt.id = staged.verification_attempt_id
), collisions as materialized (
  select distinct evidence.verification_attempt_id
    from evidence
    join target job on true
    join app.private_live_telebirr_source_document_bindings binding
      on binding.source_document_digest = evidence.source_document_digest
     and binding.payment_provider_id = job.payment_provider_id
     and binding.candidate_reference_fingerprint =
         job.candidate_reference_fingerprint
    join app.private_live_telebirr_observation_transcripts observation
      on observation.source_document_digest = binding.source_document_digest
    join app.private_live_telebirr_verification_attempts prior_attempt
      on prior_attempt.id = observation.verification_attempt_id
     and prior_attempt.verification_job_id <> job.id
), settlement_documents as materialized (
  select settlement_document.source_document_digest
    from evidence
    join app.private_live_telebirr_settlement_documents settlement_document
      on settlement_document.source_document_digest = evidence.source_document_digest
), target_outcomes as materialized (
  select outcome.id
    from app.private_live_telebirr_verification_outcomes outcome
    join target job on job.id = outcome.verification_job_id
), target_reservations as materialized (
  select reservation.id
    from app.private_live_deposit_pilot_reservations reservation
    join target job
      on job.private_live_deposit_pilot_proof_id =
         reservation.private_live_deposit_pilot_proof_id
), runtime as materialized (
  select least((select count(*) from pg_catalog.pg_roles role
                 where role.rolname in (
                   'fetanagent_deposit_executor',
                   'fetanagent_deposit_executor_runtime'
                 ) and role.rolcanlogin), 2)::integer as kemer_logins,
         least((select count(*) from pg_catalog.pg_stat_activity activity
                 where activity.usename in (
                   'fetanagent_deposit_executor',
                   'fetanagent_deposit_executor_runtime'
                 )), 2)::integer as kemer_sessions,
         least((select count(*) from pg_catalog.pg_stat_activity activity
                 where activity.usename =
                       'fetanagent_telebirr_assignment_broker_runtime'), 2)::integer
           as broker_sessions,
         least((select count(*) from pg_catalog.pg_stat_activity activity
                 where activity.usename =
                       'fetanagent_trusted_telebirr_verifier_runtime'), 2)::integer
           as verifier_sessions
), readiness as materialized (
  select exists (
           select 1
             from target job
             join app.private_trusted_telebirr_activation_control control
               on control.control_key = 'trusted_telebirr_financial_authority'
              and control.current_epoch = :'target_activation_epoch'::bigint
             join app.private_trusted_telebirr_activation_epochs authority
               on authority.epoch = control.current_epoch
              and authority.pilot_revision_id = job.pilot_revision_id
             join app.private_live_deposit_pilot_revisions pilot
               on pilot.id = authority.pilot_revision_id
            where authority.authority_state = 'active'
              and authority.revoked_at is null
              and pg_catalog.clock_timestamp() >= authority.active_from
              and pg_catalog.clock_timestamp() < authority.expires_at
              and pilot.status = 'armed'
              and pilot.configuration_digest = authority.configuration_digest
              and job.pilot_configuration_digest = pilot.configuration_digest
              and not exists (
                select 1
                  from app.private_trusted_telebirr_emergency_disable_intents emergency
                 where emergency.expected_epoch = authority.epoch
              )
         ) as authority_ready,
         exists (
           select 1
             from target job
             join app.private_live_deposit_pilot_proofs proof
               on proof.id = job.private_live_deposit_pilot_proof_id
             join app.private_live_telebirr_receiver_profiles profile
               on profile.id = job.receiver_profile_id
            where pg_catalog.clock_timestamp() < proof.submitted_at + interval '24 hours'
              and pg_catalog.clock_timestamp() >= profile.valid_from
              and pg_catalog.clock_timestamp() < profile.valid_until
         ) as proof_profile_ready,
         exists (
           select 1
             from target job
             join attempts attempt on attempt.verification_job_id = job.id
             join app.private_live_telebirr_device_enrollments enrollment
               on enrollment.id = attempt.device_enrollment_id
              and enrollment.pilot_revision_id = job.pilot_revision_id
              and enrollment.receiver_profile_id = job.receiver_profile_id
             join app.private_live_telebirr_device_heartbeats heartbeat
               on heartbeat.device_enrollment_id = enrollment.id
            where pg_catalog.clock_timestamp() >= enrollment.valid_from
              and pg_catalog.clock_timestamp() < enrollment.valid_until
              and heartbeat.runtime_state = 'ready'
              and heartbeat.status_code = 'no_assignment'
              and heartbeat.last_seen_at >
                  pg_catalog.clock_timestamp() - interval '6 minutes'
              and not exists (
                select 1 from app.private_live_telebirr_device_revocations revocation
                 where revocation.device_enrollment_id = enrollment.id
                   and revocation.revoked_at <= pg_catalog.clock_timestamp()
              )
         ) as device_ready,
         exists (
           select 1
             from transcripts transcript
             join app.private_live_telebirr_assignment_signers signer
               on signer.id = transcript.assignment_signer_id
            where pg_catalog.clock_timestamp() >= signer.valid_from
              and pg_catalog.clock_timestamp() < signer.valid_until
              and not exists (
                select 1
                  from app.private_live_telebirr_assignment_signer_revocations revocation
                 where revocation.assignment_signer_id = signer.id
                   and revocation.revoked_at <= pg_catalog.clock_timestamp()
              )
         ) as signer_ready
), summary as materialized (
  select (select count(*)::integer from target) as targets,
         (select count(*)::integer from attempts) as attempt_count,
         (select count(*)::integer from attempts attempt
           where attempt.attempt_number between 1 and 4
             and attempt.expires_at <= pg_catalog.clock_timestamp()) as expired_attempts,
         (select count(*)::integer from transcripts) as transcript_count,
         (select count(*)::integer from deliveries) as delivery_count,
         (select count(*)::integer from evidence) as evidence_count,
         (select count(*)::integer from collisions) as collision_count,
         (select count(*)::integer from settlement_documents) as settled_documents,
         (select count(*)::integer from target_outcomes) as outcomes,
         (select count(*)::integer from target_reservations) as reservations,
         coalesce((select bool_and(
           evidence.source_document_digest ~ '^sha256:[0-9a-f]{64}$'
         ) from evidence), false) as evidence_digests_valid,
         coalesce((select job.source_document_retry_request_key is not null
                     from target job limit 1), false) as already_recovered,
         runtime.*,
         readiness.*
    from runtime cross join readiness
), classified as materialized (
  select summary.*,
         summary.targets = 1
           and summary.attempt_count = 4
           and summary.expired_attempts = 4
           and summary.transcript_count = 2
           and summary.delivery_count = 2
           and summary.evidence_count = 2
           and summary.evidence_digests_valid
           and summary.collision_count between 1 and 2
           and summary.settled_documents = 0
           and summary.outcomes = 0
           and summary.reservations = 0
           and summary.authority_ready
           and summary.proof_profile_ready
           and summary.device_ready
           and summary.signer_ready
           and summary.broker_sessions = 1
           and summary.verifier_sessions = 1
           and summary.kemer_logins = 0
           and summary.kemer_sessions = 0 as eligible
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_source_document_eligibility',
  'deploymentTarget', 'production',
  'eligibilityState', case when classified.eligible then 'eligible' else 'ineligible' end,
  'reasonCode', case
    when classified.targets <> 1 then 'target_not_exact'
    when classified.attempt_count <> 4 or classified.expired_attempts <> 4
      then 'attempt_shape_mismatch'
    when classified.transcript_count <> 2
      or classified.delivery_count <> 2
      or classified.evidence_count <> 2
      or not classified.evidence_digests_valid then 'evidence_shape_mismatch'
    when classified.collision_count not between 1 and 2
      then 'same_reference_collision_missing'
    when classified.settled_documents <> 0 then 'document_already_settled'
    when classified.outcomes <> 0 or classified.reservations <> 0
      then 'downstream_rows_present'
    when not classified.authority_ready then 'authority_unavailable'
    when not classified.proof_profile_ready then 'proof_profile_unavailable'
    when not classified.device_ready then 'device_unavailable'
    when not classified.signer_ready then 'signer_unavailable'
    when classified.broker_sessions <> 1 then 'broker_session_unavailable'
    when classified.verifier_sessions <> 1 then 'verifier_session_unavailable'
    when classified.kemer_logins <> 0 or classified.kemer_sessions <> 0
      then 'kemerbet_enabled'
    else 'eligible'
  end,
  'targetCount', classified.targets,
  'attempts', classified.attempt_count,
  'expiredAttempts', classified.expired_attempts,
  'assignmentTranscripts', classified.transcript_count,
  'assignmentDeliveries', classified.delivery_count,
  'deviceEvidence', classified.evidence_count,
  'sameReferenceCollisions', classified.collision_count,
  'settledDocuments', classified.settled_documents,
  'outcomes', classified.outcomes,
  'reservations', classified.reservations,
  'assignmentBrokerSessions', classified.broker_sessions,
  'trustedVerifierSessions', classified.verifier_sessions,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'alreadyRecovered', classified.already_recovered,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
