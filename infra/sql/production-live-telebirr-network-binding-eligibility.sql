\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH
\getenv recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_diagnosis_contract
\gset
\if :exact_diagnosis_contract
\else
  \warn 'The redacted live TeleBirr eligibility contract is invalid.'
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
with pilot_jobs as materialized (
  select job.*
    from app.private_live_telebirr_verification_jobs job
   where job.pilot_revision_id = :'target_pilot_revision_id'::uuid
), linked_retries as materialized (
  select job.*, source_job.id as exact_source_job_id
    from pilot_jobs job
    join app.private_live_telebirr_verification_jobs source_job
      on source_job.id = job.network_retry_source_job_id
     and source_job.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and source_job.network_retry_source_job_id is null
   where job.network_retry_reason_code = 'official_receipt_network_unavailable'
), digest_retries as materialized (
  select job.*
    from linked_retries job
   where job.network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
), recovery_shape_retries as materialized (
  select job.*
    from digest_retries job
   where job.network_binding_recovery_request_key = :'recovery_request_key'::uuid
      or (
        job.network_binding_recovery_request_key is null
        and job.network_binding_original_expires_at is null
        and job.network_binding_recovered_at is null
        and job.network_binding_recovery_request_digest is null
        and job.network_binding_recovery_reason_code is null
      )
), expired_retries as materialized (
  select job.*
    from recovery_shape_retries job
   where job.expires_at <= pg_catalog.clock_timestamp()
), single_attempt_retries as materialized (
  select job.*
    from expired_retries job
   where (select count(*)
            from app.private_live_telebirr_verification_attempts attempt
           where attempt.verification_job_id = job.id) = 1
), expired_attempt_retries as materialized (
  select job.*
    from single_attempt_retries job
   where exists (
     select 1
       from app.private_live_telebirr_verification_attempts attempt
      where attempt.verification_job_id = job.id
        and attempt.attempt_number = 1
        and attempt.expires_at <= pg_catalog.clock_timestamp()
   )
), no_transcript_retries as materialized (
  select job.*
    from expired_attempt_retries job
   where not exists (
     select 1
       from app.private_live_telebirr_verification_attempts attempt
       join app.private_live_telebirr_assignment_transcripts transcript
         on transcript.verification_attempt_id = attempt.id
      where attempt.verification_job_id = job.id
   )
), no_delivery_retries as materialized (
  select job.*
    from no_transcript_retries job
   where not exists (
     select 1
       from app.private_live_telebirr_verification_attempts attempt
       join app.private_live_telebirr_assignment_deliveries delivery
         on delivery.verification_attempt_id = attempt.id
      where attempt.verification_job_id = job.id
   )
), no_evidence_retries as materialized (
  select job.*
    from no_delivery_retries job
   where not exists (
     select 1
       from app.private_live_telebirr_verification_attempts attempt
       join app.private_live_telebirr_device_evidence_staging evidence
         on evidence.verification_attempt_id = attempt.id
      where attempt.verification_job_id = job.id
   )
), no_observation_retries as materialized (
  select job.*
    from no_evidence_retries job
   where not exists (
     select 1
       from app.private_live_telebirr_verification_attempts attempt
       join app.private_live_telebirr_observation_transcripts observation
         on observation.verification_attempt_id = attempt.id
      where attempt.verification_job_id = job.id
   )
), no_outcome_retries as materialized (
  select job.*
    from no_observation_retries job
   where not exists (
     select 1 from app.private_live_telebirr_verification_outcomes outcome
      where outcome.verification_job_id = job.id
   )
), no_reservation_retries as materialized (
  select job.*
    from no_outcome_retries job
   where not exists (
     select 1 from app.private_live_deposit_pilot_reservations reservation
      where reservation.private_live_deposit_pilot_proof_id =
            job.private_live_deposit_pilot_proof_id
   )
), source_outcome_retries as materialized (
  select job.*
    from no_reservation_retries job
   where (select count(*)
            from app.private_live_telebirr_verification_outcomes source_outcome
           where source_outcome.verification_job_id = job.exact_source_job_id) = 1
     and exists (
       select 1
         from app.private_live_telebirr_verification_outcomes source_outcome
        where source_outcome.verification_job_id = job.exact_source_job_id
          and source_outcome.private_live_deposit_pilot_proof_id =
              job.private_live_deposit_pilot_proof_id
          and source_outcome.pilot_revision_id = :'target_pilot_revision_id'::uuid
          and source_outcome.disposition = 'review_required'
          and source_outcome.reason_code = 'source_unavailable'
     )
), source_binding_retries as materialized (
  select job.*
    from source_outcome_retries job
   where exists (
     select 1
       from app.private_live_telebirr_verification_outcomes source_outcome
       join app.private_live_telebirr_assignment_transcripts source_transcript
         on source_transcript.verification_attempt_id =
            source_outcome.verification_attempt_id
       join app.private_live_telebirr_assignment_reference_bindings binding
         on binding.reference_binding_digest =
            source_transcript.reference_binding_digest
        and binding.verification_job_id = job.exact_source_job_id
      where source_outcome.verification_job_id = job.exact_source_job_id
        and source_outcome.disposition = 'review_required'
        and source_outcome.reason_code = 'source_unavailable'
   )
), target_attempts as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join source_binding_retries job on job.id = attempt.verification_job_id
   where attempt.attempt_number = 1
), target_source_outcomes as materialized (
  select source_outcome.*, job.id as target_job_id
    from source_binding_retries job
    join app.private_live_telebirr_verification_outcomes source_outcome
      on source_outcome.verification_job_id = job.exact_source_job_id
     and source_outcome.disposition = 'review_required'
     and source_outcome.reason_code = 'source_unavailable'
), target_source_transcripts as materialized (
  select transcript.*, source_outcome.target_job_id
    from target_source_outcomes source_outcome
    join app.private_live_telebirr_assignment_transcripts transcript
      on transcript.verification_attempt_id = source_outcome.verification_attempt_id
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
         least((select count(*)
                  from pg_catalog.pg_stat_activity activity
                 where activity.usename =
                       'fetanagent_telebirr_assignment_broker_runtime'
                   and activity.query_start >
                       pg_catalog.clock_timestamp() - interval '15 seconds'
                   and exists (
                     select 1 from pg_catalog.pg_locks advisory_lock
                      where advisory_lock.pid = activity.pid
                        and advisory_lock.locktype = 'advisory'
                        and advisory_lock.database = (
                          select database.oid from pg_catalog.pg_database database
                           where database.datname = pg_catalog.current_database()
                        )
                        and advisory_lock.classid = 1178948673::integer
                        and advisory_lock.objid = 1413632594::integer
                        and advisory_lock.objsubid = 2
                        and advisory_lock.granted
                   )), 2)::integer as broker_lock_holders,
         exists (
           select 1
             from app.private_trusted_telebirr_activation_control activation_control
             join app.private_trusted_telebirr_activation_epochs authority
               on authority.epoch = activation_control.current_epoch
             join app.private_live_deposit_pilot_revisions pilot
               on pilot.id = authority.pilot_revision_id
            where activation_control.control_key =
                  'trusted_telebirr_financial_authority'
              and activation_control.current_epoch = :'target_activation_epoch'::bigint
              and authority.pilot_revision_id = :'target_pilot_revision_id'::uuid
              and authority.authority_state = 'active'
              and authority.revoked_at is null
              and pg_catalog.clock_timestamp() >= authority.active_from
              and pg_catalog.clock_timestamp() < authority.expires_at
              and not exists (
                select 1
                  from app.private_trusted_telebirr_emergency_disable_intents emergency
                 where emergency.expected_epoch = authority.epoch
              )
              and pilot.status = 'armed'
              and pilot.configuration_digest = authority.configuration_digest
              and pilot.active_from = authority.active_from
              and pilot.expires_at = authority.expires_at
              and (select count(*)
                     from app.feature_switches feature_switch
                    where feature_switch.feature_key in (
                      'cbe_birr_authoritative_verification',
                      'deposit_execution',
                      'payment_verification',
                      'private_live_deposit_pilot',
                      'telebirr_authoritative_verification'
                    )) = 5
              and exists (
                select 1 from app.feature_switches feature_switch
                 where feature_switch.feature_key =
                       'cbe_birr_authoritative_verification'
                   and feature_switch.mode = 'disabled'
                   and feature_switch.settings = '{}'::jsonb
              )
              and (select count(*)
                     from app.feature_switches feature_switch
                    where feature_switch.feature_key in (
                      'deposit_execution',
                      'payment_verification',
                      'telebirr_authoritative_verification'
                    )
                      and feature_switch.mode = 'live'
                      and feature_switch.settings = '{}'::jsonb) = 3
              and exists (
                select 1 from app.feature_switches feature_switch
                 where feature_switch.feature_key = 'private_live_deposit_pilot'
                   and feature_switch.mode = 'live'
                   and feature_switch.settings = pg_catalog.jsonb_build_object(
                     'contract_version', 1,
                     'pilot_revision_id', pilot.id,
                     'configuration_digest', pilot.configuration_digest
                   )
              )
         ) as active_epoch_matches,
         app.is_private_live_deposit_pilot_enforced() as pilot_enforced,
         exists (
           select 1 from app.feature_switches provider_switch
            where provider_switch.feature_key = 'telebirr_authoritative_verification'
              and provider_switch.mode = 'live'
         ) as provider_live
), readiness as materialized (
  select exists (
           select 1
             from source_binding_retries job
             join app.private_trusted_telebirr_activation_epochs authority
               on authority.epoch = :'target_activation_epoch'::bigint
              and authority.pilot_revision_id = :'target_pilot_revision_id'::uuid
              and authority.authority_state = 'active'
              and authority.revoked_at is null
             join app.private_live_deposit_pilot_revisions pilot
               on pilot.id = job.pilot_revision_id
              and pilot.status = 'armed'
              and pilot.configuration_digest = authority.configuration_digest
              and job.pilot_configuration_digest = pilot.configuration_digest
            where job.provider_code = 'telebirr'
         ) as authority_ready,
         exists (
           select 1
             from source_binding_retries job
             join app.private_live_deposit_pilot_proofs proof
               on proof.id = job.private_live_deposit_pilot_proof_id
              and proof.pilot_revision_id = :'target_pilot_revision_id'::uuid
              and proof.provider_code_snapshot = 'telebirr'
            where pg_catalog.clock_timestamp() <
                  proof.submitted_at + interval '24 hours'
              and pg_catalog.clock_timestamp() <
                  job.network_retry_authorized_at + interval '24 hours'
         ) as proof_window_ready,
         exists (
           select 1
             from source_binding_retries job
             join app.private_live_telebirr_receiver_profiles profile
               on profile.id = job.receiver_profile_id
              and profile.pilot_revision_id = :'target_pilot_revision_id'::uuid
            where pg_catalog.clock_timestamp() >= profile.valid_from
              and pg_catalog.clock_timestamp() < profile.valid_until
         ) as profile_ready,
         exists (
           select 1
             from source_binding_retries job
             join target_attempts attempt on attempt.verification_job_id = job.id
             join app.private_live_telebirr_receiver_profiles profile
               on profile.id = job.receiver_profile_id
             join app.private_live_telebirr_device_enrollments enrollment
               on enrollment.id = attempt.device_enrollment_id
              and enrollment.pilot_revision_id = :'target_pilot_revision_id'::uuid
              and enrollment.receiver_profile_id = profile.id
            where pg_catalog.clock_timestamp() >= enrollment.valid_from
              and pg_catalog.clock_timestamp() < enrollment.valid_until
              and not exists (
                select 1 from app.private_live_telebirr_device_revocations revocation
                 where revocation.device_enrollment_id = enrollment.id
                   and revocation.revoked_at <= pg_catalog.clock_timestamp()
              )
         ) as enrollment_ready,
         exists (
           select 1
             from target_attempts attempt
             join app.private_live_telebirr_device_heartbeats heartbeat
               on heartbeat.device_enrollment_id = attempt.device_enrollment_id
            where heartbeat.runtime_state = 'ready'
              and heartbeat.status_code = 'no_assignment'
              and heartbeat.last_seen_at >
                  pg_catalog.clock_timestamp() - interval '6 minutes'
         ) as heartbeat_ready,
         exists (
           select 1
             from target_source_transcripts source_transcript
             join app.private_live_telebirr_assignment_signers signer
               on signer.id = source_transcript.assignment_signer_id
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
  select least((select count(*) from pilot_jobs), 2)::integer as pilot_jobs,
         least((select count(*) from linked_retries), 2)::integer as linked_retries,
         least((select count(*) from digest_retries), 2)::integer as digest_retries,
         least((select count(*) from recovery_shape_retries), 2)::integer
           as recovery_shape_retries,
         least((select count(*) from expired_retries), 2)::integer as expired_retries,
         least((select count(*) from single_attempt_retries), 2)::integer
           as single_attempt_retries,
         least((select count(*) from expired_attempt_retries), 2)::integer
           as expired_attempt_retries,
         least((select count(*) from no_transcript_retries), 2)::integer
           as no_transcript_retries,
         least((select count(*) from no_delivery_retries), 2)::integer
           as no_delivery_retries,
         least((select count(*) from no_evidence_retries), 2)::integer
           as no_evidence_retries,
         least((select count(*) from no_observation_retries), 2)::integer
           as no_observation_retries,
         least((select count(*) from no_outcome_retries), 2)::integer
           as no_outcome_retries,
         least((select count(*) from no_reservation_retries), 2)::integer
           as no_reservation_retries,
         least((select count(*) from source_outcome_retries), 2)::integer
           as source_outcome_retries,
         least((select count(*) from source_binding_retries), 2)::integer
           as target_count,
         runtime.*,
         readiness.*
    from runtime cross join readiness
), classified as materialized (
  select summary.*,
         case
           when summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
             then 'kemerbet_boundary_not_inert'
           when summary.pilot_jobs = 0 then 'pilot_scope_missing'
           when summary.linked_retries = 0 then 'network_retry_lineage_missing'
           when summary.digest_retries = 0 then 'network_retry_digest_invalid'
           when summary.recovery_shape_retries = 0 then 'recovery_shape_conflict'
           when summary.expired_retries = 0 then 'retry_not_expired'
           when summary.single_attempt_retries = 0 then 'attempt_cardinality_invalid'
           when summary.expired_attempt_retries = 0 then 'attempt_not_expired'
           when summary.no_transcript_retries = 0 then 'replacement_transcript_exists'
           when summary.no_delivery_retries = 0 then 'replacement_delivery_exists'
           when summary.no_evidence_retries = 0 then 'replacement_evidence_exists'
           when summary.no_observation_retries = 0 then 'replacement_observation_exists'
           when summary.no_outcome_retries = 0 then 'replacement_outcome_exists'
           when summary.no_reservation_retries = 0 then 'proof_reservation_exists'
           when summary.source_outcome_retries = 0 then 'source_outcome_invalid'
           when summary.target_count = 0 then 'source_binding_missing'
           when summary.target_count <> 1 then 'eligible_target_ambiguous'
           when not summary.active_epoch_matches then 'activation_epoch_mismatch'
           when not summary.authority_ready then 'pilot_authority_unavailable'
           when not summary.proof_window_ready then 'proof_window_unavailable'
           when not summary.profile_ready then 'receiver_profile_unavailable'
           when not summary.enrollment_ready then 'device_enrollment_unavailable'
           when not summary.heartbeat_ready then 'device_heartbeat_unavailable'
           when not summary.signer_ready then 'assignment_signer_unavailable'
           when not summary.pilot_enforced or not summary.provider_live
             then 'verification_policy_unavailable'
           when summary.broker_sessions <> 1 or summary.broker_lock_holders <> 1
             then 'assignment_broker_unavailable'
           else 'eligible'
         end as reason_code
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_network_binding_eligibility',
  'deploymentTarget', 'production',
  'eligibilityState', case
    when classified.reason_code = 'eligible' then 'eligible'
    else 'ineligible'
  end,
  'reasonCode', classified.reason_code,
  'pilotJobs', classified.pilot_jobs,
  'linkedRetries', classified.linked_retries,
  'digestRetries', classified.digest_retries,
  'recoveryShapeRetries', classified.recovery_shape_retries,
  'expiredRetries', classified.expired_retries,
  'singleAttemptRetries', classified.single_attempt_retries,
  'expiredAttemptRetries', classified.expired_attempt_retries,
  'noTranscriptRetries', classified.no_transcript_retries,
  'noDeliveryRetries', classified.no_delivery_retries,
  'noEvidenceRetries', classified.no_evidence_retries,
  'noObservationRetries', classified.no_observation_retries,
  'noOutcomeRetries', classified.no_outcome_retries,
  'noReservationRetries', classified.no_reservation_retries,
  'sourceOutcomeRetries', classified.source_outcome_retries,
  'targetCount', classified.target_count,
  'activeEpochMatches', classified.active_epoch_matches,
  'authorityReady', classified.authority_ready,
  'proofWindowReady', classified.proof_window_ready,
  'receiverProfileReady', classified.profile_ready,
  'deviceEnrollmentReady', classified.enrollment_ready,
  'deviceHeartbeatReady', classified.heartbeat_ready,
  'assignmentSignerReady', classified.signer_ready,
  'verificationPolicyReady', classified.pilot_enforced and classified.provider_live,
  'assignmentBrokerSessions', classified.broker_sessions,
  'assignmentBrokerLockHolders', classified.broker_lock_holders,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
