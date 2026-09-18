\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv source_shadow_proof_request_id SOURCE_SHADOW_PROOF_REQUEST_ID
\getenv source_shadow_verification_job_id SOURCE_SHADOW_VERIFICATION_JOB_ID
\getenv pilot_revision_id PILOT_REVISION_ID
\getenv retry_request_key AUTHORITY_DEADLINE_RETRY_REQUEST_KEY
\getenv reviewed_main_commit_sha REVIEWED_MAIN_COMMIT_SHA

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The workflow-supplied production project assertion is missing or incorrect.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '30s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'source_shadow_proof_request_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'source_shadow_verification_job_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'reviewed_main_commit_sha' ~ '^[0-9a-f]{40}$'
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The exact authority-deadline retry identifiers are invalid.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.jsonb_build_object(
         'depositIntents', (select count(*) from app.deposit_intents),
         'paymentClaims', (select count(*) from app.deposit_payment_claims),
         'depositJobs', (select count(*) from app.deposit_jobs),
         'providerEvidence', (select count(*) from app.provider_payment_evidence),
         'executionAttempts', (select count(*) from app.deposit_execution_attempts),
         'reconciliations', (select count(*) from app.execution_reconciliations),
         'privatePilotReservations', (
           select count(*) from app.private_live_deposit_pilot_reservations
         ),
         'settlementReceipts', (
           select count(*) from app.private_live_telebirr_settlement_receipts
         )
       )::text as no_money_snapshot_before
\gset

select *
  from app.retry_private_telebirr_shadow_after_authority_deadline_fix(
    :'source_shadow_proof_request_id'::uuid,
    :'source_shadow_verification_job_id'::uuid,
    :'pilot_revision_id'::uuid,
    :'retry_request_key'::uuid,
    :'reviewed_main_commit_sha'::text,
    'source_recovery_authority_deadline_retry_no_credit'
  )
\gset recovery_

with exact_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_authority_deadline_retries retry
   where retry.retry_request_key = :'retry_request_key'::uuid
     and retry.source_shadow_proof_request_id =
         :'source_shadow_proof_request_id'::uuid
     and retry.source_shadow_verification_job_id =
         :'source_shadow_verification_job_id'::uuid
     and retry.pilot_revision_id = :'pilot_revision_id'::uuid
     and retry.reviewed_main_commit_sha = :'reviewed_main_commit_sha'::text
     and retry.reason_code =
         'source_recovery_authority_deadline_retry_no_credit'
), exact_source as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join exact_retry retry on retry.source_shadow_proof_request_id = proof.id
   for share of proof
), exact_replacement as materialized (
  select proof.*
    from app.private_telebirr_shadow_proof_requests proof
    join exact_retry retry on retry.replacement_shadow_proof_request_id = proof.id
   for share of proof
), exact_source_attempts as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join exact_source source on source.id = attempt.shadow_proof_request_id
), exact_source_quarantines as materialized (
  select quarantine.*
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join exact_source_attempts attempt on attempt.id = quarantine.verification_attempt_id
), financial_switches as materialized (
  select feature_switch.feature_key,
         feature_switch.mode,
         feature_switch.settings
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for share
)
select (select count(*) from exact_retry) = 1
   and (select count(*) from exact_source) = 1
   and (select count(*) from exact_replacement) = 1
   and (select count(*) from financial_switches) = 6
   and (select count(*) from financial_switches
         where mode = 'disabled' and settings = '{}'::jsonb) = 6
   and (select pg_catalog.bool_and(
          retry.prior_attempt_count = retry.prior_quarantine_count
          and retry.prior_attempt_count = (select count(*) from exact_source_attempts)
          and retry.prior_quarantine_count = (select count(*) from exact_source_quarantines)
          and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
          and retry.retry_expires_at = :'recovery_retry_expires_at'::timestamptz
        ) from exact_retry retry)
   and (select pg_catalog.bool_and(
          quarantine.reason_code = 'trusted_evidence_invalid'
        ) from exact_source_quarantines quarantine)
   and (select pg_catalog.bool_and(
          replacement.id = :'recovery_shadow_proof_request_id'::uuid
          and replacement.verification_job_id =
              :'recovery_shadow_verification_job_id'::uuid
          and replacement.authority_deadline_retry_source_id = source.id
          and replacement.submitted_at + interval '12 hours' = replacement.expires_at
          and replacement.proof_status = 'verification_queued'
          and replacement.payment_provider_id = source.payment_provider_id
          and replacement.candidate_reference_fingerprint =
              source.candidate_reference_fingerprint
          and replacement.candidate_reference_ciphertext =
              source.candidate_reference_ciphertext
        ) from exact_source source cross join exact_replacement replacement)
   and (select pg_catalog.bool_and(
          app.private_telebirr_shadow_authority_deadline_retry_is_valid(
            replacement.id,
            retry.retry_request_key
          )
        ) from exact_retry retry cross join exact_replacement replacement)
   and not exists (
     select 1
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_source source on source.id = outcome.shadow_proof_request_id
   )
   and not exists (
     select 1
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_replacement replacement
         on replacement.id = outcome.shadow_proof_request_id
   )
   and app.current_private_trusted_telebirr_activation_epoch() is null
   and pg_catalog.jsonb_build_object(
         'depositIntents', (select count(*) from app.deposit_intents),
         'paymentClaims', (select count(*) from app.deposit_payment_claims),
         'depositJobs', (select count(*) from app.deposit_jobs),
         'providerEvidence', (select count(*) from app.provider_payment_evidence),
         'executionAttempts', (select count(*) from app.deposit_execution_attempts),
         'reconciliations', (select count(*) from app.execution_reconciliations),
         'privatePilotReservations', (
           select count(*) from app.private_live_deposit_pilot_reservations
         ),
         'settlementReceipts', (
           select count(*) from app.private_live_telebirr_settlement_receipts
         )
       ) = :'no_money_snapshot_before'::jsonb
  as exact_no_money_postcondition
\gset
\if :exact_no_money_postcondition
\else
  \warn 'The production TeleBirr authority-deadline recovery postcondition failed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'telebirr_shadow_authority_deadline_recovery',
  'deploymentTarget', 'production',
  'retryState', 'armed',
  'reviewWindowHours', 12,
  'priorEvidencePreserved', true,
  'priorQuarantinePreserved', true,
  'financialBoundary', 'dry_run',
  'kemerBetExecutionEnabled', false,
  'moneyMoved', false
)::text;

commit;
