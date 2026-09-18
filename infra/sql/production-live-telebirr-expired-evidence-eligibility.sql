\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_expired_activation_epoch TARGET_EXPIRED_ACTIVATION_EPOCH
\getenv network_binding_recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY
\getenv historical_completion_request_key HISTORICAL_COMPLETION_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_expired_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'network_binding_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'historical_completion_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'network_binding_recovery_request_key' <>
       :'historical_completion_request_key'
  as exact_eligibility_contract
\gset
\if :exact_eligibility_contract
\else
  \warn 'The redacted expired-evidence eligibility contract is invalid.'
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
), latest_evidence as materialized (
  select evidence.*
    from evidence
   order by evidence.staged_at desc, evidence.verification_attempt_id
   limit 1
), collisions as materialized (
  select distinct prior_observation.id
    from latest_evidence staged
    join target job on true
    join app.private_live_telebirr_source_document_bindings binding
      on binding.source_document_digest = staged.source_document_digest
     and binding.payment_provider_id = job.payment_provider_id
     and binding.candidate_reference_fingerprint =
         job.candidate_reference_fingerprint
    join app.private_live_telebirr_observation_transcripts prior_observation
      on prior_observation.source_document_digest = binding.source_document_digest
    join app.private_live_telebirr_verification_attempts prior_attempt
      on prior_attempt.id = prior_observation.verification_attempt_id
     and prior_attempt.verification_job_id <> job.id
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
), execution_jobs as materialized (
  select execution_job.*
    from app.deposit_jobs execution_job
    join settlement_receipts receipt on receipt.execution_job_id = execution_job.id
), runtime as materialized (
  select (select count(*)::integer from pg_catalog.pg_roles role
           where role.rolname in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           ) and role.rolcanlogin) as kemer_logins,
         (select count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           )) as kemer_sessions,
         (select count(*)::integer from pg_catalog.pg_roles role
           where role.rolname in (
             'fetanagent_trusted_telebirr_verifier',
             'fetanagent_trusted_telebirr_verifier_runtime'
           ) and role.rolcanlogin
             and (role.rolvaliduntil is null or
                  role.rolvaliduntil > pg_catalog.clock_timestamp()))
           as active_verifier_logins,
         (select count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_trusted_telebirr_verifier',
             'fetanagent_trusted_telebirr_verifier_runtime'
           )) as verifier_sessions
), summary as materialized (
  select (select count(*)::integer from target) as targets,
         (select count(*)::integer from attempts) as attempt_count,
         (select count(*)::integer from attempts attempt
           where attempt.expires_at <= pg_catalog.clock_timestamp()) as expired_attempt_count,
         (select count(*)::integer from transcripts) as transcript_count,
         (select count(*)::integer from deliveries) as delivery_count,
         (select count(*)::integer from evidence) as evidence_count,
         (select count(*)::integer from collisions) as collision_count,
         (select count(*)::integer from outcomes) as outcome_count,
         (select count(*)::integer from reservations) as reservation_count,
         (select count(*)::integer from settlement_receipts) as settlement_count,
         (select count(*)::integer from execution_jobs) as execution_job_count,
         (select count(*)::integer
            from latest_evidence staged
            join attempts attempt on attempt.id = staged.verification_attempt_id
           where staged.observed_at >= attempt.issued_at
             and staged.observed_at < attempt.expires_at
             and staged.staged_at < attempt.expires_at
             and staged.source_document_digest ~ '^sha256:[0-9a-f]{64}$')
           as on_time_evidence_count,
         (select count(*)::integer
            from app.private_live_telebirr_settlement_documents settled
            join latest_evidence staged
              on staged.source_document_digest = settled.source_document_digest)
           as settled_document_count,
         (select count(*)::integer
            from app.private_live_telebirr_verifier_evidence_quarantine quarantine
            join latest_evidence staged
              on quarantine.verification_attempt_id = staged.verification_attempt_id
              or quarantine.observation_body_digest = staged.observation_body_digest)
           as quarantine_count,
         (select count(*)::integer
            from app.provider_payment_evidence payment_evidence
            join target job
              on payment_evidence.payment_provider_id = job.payment_provider_id
             and payment_evidence.canonical_reference_fingerprint =
                 job.candidate_reference_fingerprint)
           as duplicate_payment_count,
         (select count(*)::integer
            from app.private_live_telebirr_historical_completion_authorities authority
            join target job on job.id = authority.verification_job_id)
           as historical_authority_count,
         (select count(*)::integer
            from app.private_trusted_telebirr_activation_control activation_control
            join app.private_trusted_telebirr_activation_epochs activation_epoch
              on activation_epoch.epoch = activation_control.current_epoch
            join target job
              on job.pilot_revision_id = activation_epoch.pilot_revision_id
            join app.private_live_deposit_pilot_revisions pilot
              on pilot.id = job.pilot_revision_id
            join latest_evidence staged on true
            left join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
              on emergency_intent.expected_epoch = activation_epoch.epoch
           where activation_control.control_key = 'trusted_telebirr_financial_authority'
             and activation_epoch.epoch = :'target_expired_activation_epoch'::bigint
             and activation_epoch.authority_state = 'active'
             and activation_epoch.configuration_digest = pilot.configuration_digest
             and activation_epoch.expires_at <= pg_catalog.clock_timestamp()
             and (
               (
                 activation_epoch.revoked_at is null
                 and emergency_intent.request_key is null
                 and pilot.status = 'armed'
               )
               or (
                 activation_epoch.revoked_at is not null
                 and activation_epoch.revocation_reason_code = 'execution_uncertainty'
                 and emergency_intent.request_key is not null
                 and emergency_intent.reason_code =
                     activation_epoch.revocation_reason_code
                 and emergency_intent.requested_at is not distinct from
                     activation_epoch.revoked_at
                 and activation_epoch.expires_at <= emergency_intent.requested_at
                 and pilot.status = 'stopped'
                 and pilot.stopped_at is not distinct from emergency_intent.requested_at
                 and pilot.stopped_by_admin_id is not distinct from
                     emergency_intent.requested_by_admin_id
                 and pilot.stop_reason_code is not distinct from
                     emergency_intent.reason_code
                 and pilot.expires_at <= emergency_intent.requested_at
                 and staged.observed_at < emergency_intent.requested_at
                 and staged.staged_at < emergency_intent.requested_at
                 and app.current_private_trusted_telebirr_activation_epoch() is null
               )
             ))
           as expired_authority_count,
         (select count(*)::integer
            from app.private_trusted_telebirr_activation_control activation_control
            join app.private_trusted_telebirr_activation_epochs activation_epoch
              on activation_epoch.epoch = activation_control.current_epoch
            join target job
              on job.pilot_revision_id = activation_epoch.pilot_revision_id
            join app.private_live_deposit_pilot_revisions pilot
              on pilot.id = job.pilot_revision_id
            join latest_evidence staged on true
            join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
              on emergency_intent.expected_epoch = activation_epoch.epoch
           where activation_control.control_key = 'trusted_telebirr_financial_authority'
             and activation_epoch.epoch = :'target_expired_activation_epoch'::bigint
             and activation_epoch.authority_state = 'active'
             and activation_epoch.configuration_digest = pilot.configuration_digest
             and activation_epoch.revoked_at is not null
             and activation_epoch.revocation_reason_code = 'execution_uncertainty'
             and emergency_intent.reason_code = activation_epoch.revocation_reason_code
             and emergency_intent.requested_at is not distinct from
                 activation_epoch.revoked_at
             and activation_epoch.expires_at <= emergency_intent.requested_at
             and pilot.status = 'stopped'
             and pilot.stopped_at is not distinct from emergency_intent.requested_at
             and pilot.stopped_by_admin_id is not distinct from
                 emergency_intent.requested_by_admin_id
             and pilot.stop_reason_code is not distinct from emergency_intent.reason_code
             and pilot.expires_at <= emergency_intent.requested_at
             and staged.observed_at < emergency_intent.requested_at
             and staged.staged_at < emergency_intent.requested_at
             and app.current_private_trusted_telebirr_activation_epoch() is null)
           as post_emergency_authority_count,
         (select count(*)::integer
            from app.private_live_deposit_pilot_revisions pilot
            join target job on job.pilot_revision_id = pilot.id
           where pilot.status in ('armed', 'stopped')
             and pilot.expires_at <= pg_catalog.clock_timestamp()) as expired_pilot_count,
         (select count(*)::integer
            from app.private_live_telebirr_receiver_profiles profile
            join target job on job.receiver_profile_id = profile.id
           where profile.valid_until <= pg_catalog.clock_timestamp()) as expired_profile_count,
         (select count(*)::integer
            from app.private_live_deposit_pilot_proofs proof
            join target job on job.private_live_deposit_pilot_proof_id = proof.id
           where proof.submitted_at + interval '24 hours' >
                 pg_catalog.clock_timestamp() + interval '8 minutes') as valid_proof_count,
         (select count(*)::integer from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'live') as live_switch_count,
         (select count(*)::integer from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'disabled'
             and feature_switch.settings = '{}'::jsonb)
           as disabled_recovery_switch_count,
         (select count(*)::integer from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'cbe_birr_authoritative_verification', 'withdrawal_collection',
             'withdrawal_validation'
           ) and feature_switch.mode = 'disabled'
             and feature_switch.settings = '{}'::jsonb) as disabled_switch_count,
         runtime.*
    from runtime
), classified as materialized (
  select summary.*,
         case
           when summary.targets <> 1 then 'target_not_exact'
           when summary.attempt_count <> 4 or summary.expired_attempt_count <> 4
             then 'attempt_shape_mismatch'
           when summary.transcript_count <> 2 or summary.delivery_count <> 2
             or summary.evidence_count <> 2 or summary.on_time_evidence_count <> 1
             then 'evidence_shape_mismatch'
           when summary.collision_count < 1 then 'same_reference_collision_missing'
           when summary.settled_document_count <> 0 then 'document_already_settled'
           when summary.duplicate_payment_count <> 0 then 'payment_already_used'
           when summary.quarantine_count <> 0 then 'evidence_quarantined'
           when summary.outcome_count <> 0 or summary.reservation_count <> 0
             or summary.settlement_count <> 0 or summary.execution_job_count <> 0
             then 'downstream_rows_present'
           when summary.historical_authority_count <> 0 then 'recovery_already_recorded'
           when summary.expired_authority_count <> 1 then 'expired_authority_not_exact'
           when summary.expired_pilot_count <> 1 then 'expired_pilot_not_exact'
           when summary.expired_profile_count <> 1 then 'expired_profile_not_exact'
           when summary.valid_proof_count <> 1 then 'proof_window_unavailable'
           when summary.disabled_switch_count <> 3
             or not (
               summary.live_switch_count = 4
               or (
                 summary.post_emergency_authority_count = 1
                 and
                 summary.live_switch_count = 0
                 and summary.disabled_recovery_switch_count = 4
               )
             )
             then 'switch_boundary_unavailable'
           when summary.active_verifier_logins <> 0 or summary.verifier_sessions <> 0
             then 'verifier_not_inert'
           when summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
             then 'kemerbet_enabled'
           else 'eligible'
         end as reason_code
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_expired_evidence_eligibility',
  'deploymentTarget', 'production',
  'eligibilityState', case when classified.reason_code = 'eligible'
    then 'eligible' else 'ineligible' end,
  'reasonCode', classified.reason_code,
  'targetCount', classified.targets,
  'attempts', classified.attempt_count,
  'expiredAttempts', classified.expired_attempt_count,
  'assignmentTranscripts', classified.transcript_count,
  'assignmentDeliveries', classified.delivery_count,
  'deviceEvidence', classified.evidence_count,
  'sameReferenceCollisions', classified.collision_count,
  'outcomes', classified.outcome_count,
  'reservations', classified.reservation_count,
  'settlementReceipts', classified.settlement_count,
  'depositExecutionJobs', classified.execution_job_count,
  'historicalAuthorities', classified.historical_authority_count,
  'activeVerifierLoginRoles', classified.active_verifier_logins,
  'trustedVerifierSessions', classified.verifier_sessions,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
