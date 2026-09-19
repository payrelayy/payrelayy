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
  \warn 'The redacted reviewed source-binding eligibility contract is invalid.'
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
           as source_document_digest,
         staged.signed_observation -> 'body' ->> 'normalizedFactsDigest'
           as normalized_facts_digest
    from app.private_live_telebirr_device_evidence_staging staged
    join attempts attempt on attempt.id = staged.verification_attempt_id
), authority as materialized (
  select completion.*
    from app.private_live_telebirr_historical_completion_authorities completion
    join target job on job.id = completion.verification_job_id
), authority_closure as materialized (
  select closure.*
    from app.private_live_telebirr_historical_completion_closures closure
    join authority completion on completion.request_key = closure.request_key
), authority_consumption as materialized (
  select consumption.*
    from app.private_live_telebirr_historical_completion_consumptions consumption
    join authority completion on completion.request_key = consumption.request_key
), binding as materialized (
  select registered.*
    from app.private_live_telebirr_source_document_bindings registered
    join evidence staged
      on staged.source_document_digest = registered.source_document_digest
), prior_attempt as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join binding registered
      on registered.first_verification_attempt_id = attempt.id
), prior_job as materialized (
  select job.*
    from app.private_live_telebirr_verification_jobs job
    join prior_attempt attempt on attempt.verification_job_id = job.id
), prior_proof as materialized (
  select proof.*
    from app.private_live_deposit_pilot_proofs proof
    join prior_job job on job.private_live_deposit_pilot_proof_id = proof.id
), prior_observation as materialized (
  select observation.*
    from app.private_live_telebirr_observation_transcripts observation
    join prior_attempt attempt on attempt.id = observation.verification_attempt_id
    join binding registered
      on registered.source_document_digest = observation.source_document_digest
), prior_outcome as materialized (
  select outcome.*
    from app.private_live_telebirr_verification_outcomes outcome
    join prior_observation observation
      on observation.id = outcome.observation_transcript_id
), current_outcome as materialized (
  select outcome.*
    from app.private_live_telebirr_verification_outcomes outcome
    join target job on job.id = outcome.verification_job_id
), current_proof as materialized (
  select proof.*
    from app.private_live_deposit_pilot_proofs proof
    join target job on job.private_live_deposit_pilot_proof_id = proof.id
), reservations as materialized (
  select reservation.*
    from app.private_live_deposit_pilot_reservations reservation
   where reservation.private_live_deposit_pilot_proof_id in (
     select proof.id from current_proof proof
     union all
     select proof.id from prior_proof proof
   )
), receipts as materialized (
  select receipt.*
    from app.private_live_telebirr_settlement_receipts receipt
   where receipt.verification_outcome_id in (
     select outcome.id from current_outcome outcome
     union all
     select outcome.id from prior_outcome outcome
   )
), execution_jobs as materialized (
  select execution_job.*
    from app.deposit_jobs execution_job
    join receipts receipt on receipt.execution_job_id = execution_job.id
), retries as materialized (
  select retry.*
    from app.private_live_telebirr_source_binding_recovery_retries retry
    join target job on job.id = retry.current_verification_job_id
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
        and staged.source_document_digest ~ '^sha256:[0-9a-f]{64}$'
        and staged.normalized_facts_digest ~ '^sha256:[0-9a-f]{64}$') as on_time_evidence,
    (select count(*)::integer from authority) as authorities,
    (select count(*)::integer from authority_closure closure
      where closure.reason_code = 'operator_stop') as operator_closures,
    (select count(*)::integer from authority_consumption) as authority_consumptions,
    (select count(*)::integer from binding) as bindings,
    (select count(*)::integer from prior_job) as prior_jobs,
    (select count(*)::integer from prior_observation) as prior_observations,
    (select count(*)::integer from prior_outcome outcome
      where outcome.disposition = 'review_required'
        and outcome.reason_code = 'source_unavailable'
        and outcome.deposit_intent_id is null
        and outcome.deposit_submission_id is null
        and outcome.provider_payment_evidence_id is null
        and outcome.deposit_verification_attempt_id is null) as prior_nonfinancial_reviews,
    (select count(*)::integer
       from prior_job old_job
       join target new_job
         on new_job.payment_provider_id = old_job.payment_provider_id
        and new_job.submitting_customer_id = old_job.submitting_customer_id
        and new_job.player_account_id = old_job.player_account_id
        and new_job.receiver_account_id = old_job.receiver_account_id
        and new_job.receiver_account_version = old_job.receiver_account_version
        and new_job.receiver_identity_digest = old_job.receiver_identity_digest
        and new_job.expected_receiver_name_digest = old_job.expected_receiver_name_digest
        and new_job.candidate_reference_fingerprint <>
            old_job.candidate_reference_fingerprint
       join binding registered
         on registered.payment_provider_id = old_job.payment_provider_id
        and registered.candidate_reference_fingerprint =
            old_job.candidate_reference_fingerprint
      where old_job.recovery_reason_code = 'device_evidence_binding_mismatch')
      as exact_lineages,
    (select count(*)::integer
       from prior_observation observation
       join evidence staged
         on staged.normalized_facts_digest = observation.normalized_facts_digest)
      as matching_facts,
    (select count(*)::integer from current_outcome) as current_outcomes,
    (select count(*)::integer from reservations) as reservations,
    (select count(*)::integer from receipts) as receipts,
    (select count(*)::integer from execution_jobs) as execution_jobs,
    (select count(*)::integer from retries) as retries,
    (select count(*)::integer
       from app.private_live_telebirr_settlement_documents document
       join evidence staged
         on staged.source_document_digest = document.source_document_digest)
      as settlement_documents,
    (select count(*)::integer
       from app.provider_payment_evidence payment_evidence
       join target job on payment_evidence.payment_provider_id = job.payment_provider_id
       left join prior_job old_job on old_job.payment_provider_id = job.payment_provider_id
      where payment_evidence.canonical_reference_fingerprint in (
        job.candidate_reference_fingerprint,
        old_job.candidate_reference_fingerprint
      )) as used_payments,
    (select count(*)::integer
       from current_proof proof
      where proof.origin_channel = 'telegram'
        and proof.input_kind = 'direct_transaction_id'
        and proof.submitted_at + interval '24 hours' >=
            pg_catalog.clock_timestamp() + interval '12 hours 5 minutes') as proof_windows,
    (select count(*)::integer
       from authority completion
      where completion.expired_activation_epoch = :'target_activation_epoch'::bigint
        and app.is_private_live_telebirr_source_binding_post_emergency_ready(
          completion.request_key
        )) as post_emergency_boundaries,
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
        and feature_switch.settings = '{}'::jsonb) as disabled_financial_switches,
    (select count(*)::integer from pg_catalog.pg_authid role
      where role.rolname in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime'
      ) and (role.rolcanlogin or role.rolpassword is not null)) as verifier_credentials,
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
    (select count(*)::integer
       from app.private_live_telebirr_verification_attempts attempt
       join prior_job job on job.id = attempt.verification_job_id)
      as prior_attempts,
    (select count(*)::integer
       from app.private_live_telebirr_assignment_transcripts transcript
       join app.private_live_telebirr_verification_attempts attempt
         on attempt.id = transcript.verification_attempt_id
       join prior_job job on job.id = attempt.verification_job_id)
      as prior_transcripts,
    (select count(*)::integer
       from app.private_live_telebirr_assignment_deliveries delivery
       join app.private_live_telebirr_verification_attempts attempt
         on attempt.id = delivery.verification_attempt_id
       join prior_job job on job.id = attempt.verification_job_id)
      as prior_deliveries,
    (select count(*)::integer
       from app.private_live_telebirr_device_evidence_staging staged
       join app.private_live_telebirr_verification_attempts attempt
         on attempt.id = staged.verification_attempt_id
       join prior_job job on job.id = attempt.verification_job_id)
      as prior_evidence
), classified as materialized (
  select summary.*,
    case
      when targets <> 1 then 'target_not_exact'
      when attempts <> 1 or expired_attempts <> 1 or transcripts <> 1
        or deliveries <> 1 or evidence <> 1 or on_time_evidence <> 1
        then 'current_attempt_shape_mismatch'
      when authorities <> 1 or operator_closures <> 1 or authority_consumptions <> 0
        then 'closed_authority_shape_mismatch'
      when bindings <> 1 or prior_jobs <> 1 or exact_lineages <> 1
        or matching_facts <> 1 then 'source_binding_lineage_mismatch'
      when prior_attempts <> 3 or prior_transcripts <> 2 or prior_deliveries <> 2
        or prior_evidence <> 1 or prior_observations <> 1
        or prior_nonfinancial_reviews <> 1 then 'prior_review_shape_mismatch'
      when current_outcomes <> 0 or reservations <> 0 or receipts <> 0
        or execution_jobs <> 0 or settlement_documents <> 0 or used_payments <> 0
        then 'financial_or_downstream_rows_present'
      when retries <> 0 then 'recovery_already_recorded'
      when proof_windows <> 1 then 'proof_window_unavailable'
      when post_emergency_boundaries <> 1
        then 'post_emergency_boundary_unavailable'
      when live_financial_switches <> 0 or disabled_financial_switches <> 7
        then 'switch_boundary_unavailable'
      when verifier_credentials <> 0 or verifier_sessions <> 0
        then 'verifier_not_inert'
      when kemer_logins <> 0 or kemer_sessions <> 0 then 'kemerbet_enabled'
      else 'eligible'
    end as reason_code
  from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_source_binding_recovery_eligibility',
  'deploymentTarget', 'production',
  'eligibilityState', case when classified.reason_code = 'eligible'
    then 'eligible' else 'ineligible' end,
  'reasonCode', classified.reason_code,
  'authorityBoundary', case when classified.post_emergency_boundaries = 1
    then 'post_emergency' else 'unavailable' end,
  'targetCount', classified.targets,
  'attempts', classified.attempts,
  'assignmentTranscripts', classified.transcripts,
  'assignmentDeliveries', classified.deliveries,
  'deviceEvidence', classified.evidence,
  'historicalAuthorities', classified.authorities,
  'historicalAuthorityClosures', classified.operator_closures,
  'priorAttempts', classified.prior_attempts,
  'priorAssignmentTranscripts', classified.prior_transcripts,
  'priorAssignmentDeliveries', classified.prior_deliveries,
  'priorDeviceEvidence', classified.prior_evidence,
  'priorObservations', classified.prior_observations,
  'priorNonfinancialReviews', classified.prior_nonfinancial_reviews,
  'reservations', classified.reservations,
  'settlementReceipts', classified.receipts,
  'depositExecutionJobs', classified.execution_jobs,
  'trustedVerifierSessions', classified.verifier_sessions,
  'financialSwitchesLive', classified.live_financial_switches,
  'financialSwitchesDisabled', classified.disabled_financial_switches,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.kemer_logins <> 0 or classified.kemer_sessions <> 0,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
