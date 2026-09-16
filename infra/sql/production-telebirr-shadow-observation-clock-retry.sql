\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv source_shadow_proof_request_id SOURCE_SHADOW_PROOF_REQUEST_ID
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv retry_request_key OBSERVATION_CLOCK_RETRY_REQUEST_KEY
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

select :'source_shadow_proof_request_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'reviewed_main_commit_sha' ~ '^[0-9a-f]{40}$'
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The exact observation-clock retry identifiers are invalid.'
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
         )
       )::text as no_money_snapshot_before
\gset

select count(*) = 1 as retry_transition_ready
  from app.retry_private_telebirr_shadow_after_observation_clock_fix(
    :'source_shadow_proof_request_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'retry_request_key'::uuid,
    :'reviewed_main_commit_sha',
    'observation_clock_mismatch_retry_no_credit'
  )
\gset
\if :retry_transition_ready
\else
  \warn 'The observation-clock no-money retry transition did not complete.'
  select 1 / 0 as rejected;
\endif

with exact_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_observation_clock_retries retry
   where retry.retry_request_key = :'retry_request_key'::uuid
     and retry.source_shadow_proof_request_id =
         :'source_shadow_proof_request_id'::uuid
     and retry.target_pilot_revision_id = :'target_pilot_revision_id'::uuid
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
), exact_outcome as materialized (
  select outcome.*
    from app.private_telebirr_shadow_verification_outcomes outcome
    join exact_retry retry on retry.source_outcome_id = outcome.id
   for share of outcome
), exact_attempt as materialized (
  select attempt.*
    from app.private_telebirr_shadow_verification_attempts attempt
    join exact_retry retry on retry.source_verification_attempt_id = attempt.id
   for share of attempt
), exact_staged as materialized (
  select staged.*
    from app.private_telebirr_shadow_device_evidence_staging staged
    join exact_retry retry
      on retry.source_verification_attempt_id = staged.verification_attempt_id
     and retry.source_observation_body_digest = staged.observation_body_digest
   for share of staged
), exact_pilot as materialized (
  select pilot.*
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = :'target_pilot_revision_id'::uuid
   for share
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
), pilot_switch as materialized (
  select feature_switch.*
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot'
   for share
)
select (select count(*) from exact_retry) = 1
   and (select count(*) from exact_source) = 1
   and (select count(*) from exact_replacement) = 1
   and (select count(*) from exact_outcome) = 1
   and (select count(*) from exact_attempt) = 1
   and (select count(*) from exact_staged) = 1
   and (select count(*) from exact_pilot) = 1
   and (select count(*) from financial_switches) = 6
   and (select count(*) from financial_switches
         where mode = 'disabled' and settings = '{}'::jsonb) = 6
   and (select count(*) from pilot_switch
         where mode = 'dry_run'
           and settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', :'target_pilot_revision_id'::uuid,
             'configuration_digest', (select configuration_digest from exact_pilot)
           )) = 1
   and (select pg_catalog.bool_and(
          pilot.status = 'armed'
          and pilot.active_from <= pg_catalog.clock_timestamp()
          and pilot.expires_at > pg_catalog.clock_timestamp() + interval '10 minutes'
        ) from exact_pilot pilot)
   and (select pg_catalog.bool_and(
          outcome.disposition = 'review_required'
          and outcome.reason_code = 'parser_uncertain'
          and outcome.protocol_disposition = 'would_review'
          and outcome.protocol_reason_code = 'receipt_semantics_incomplete'
          and not outcome.would_verify
          and outcome.principal_amount_minor is null
          and outcome.occurred_at is null
          and outcome.receiver_identity_digest is null
          and outcome.retrieved_at < outcome.observed_at
          and outcome.observed_at - outcome.retrieved_at <= interval '1 second'
        ) from exact_outcome outcome)
   and (select pg_catalog.bool_and(
          retry.source_retrieved_at = outcome.retrieved_at
          and retry.source_observed_at = outcome.observed_at
          and retry.source_staged_at = staged.staged_at
          and retry.source_observation_body_digest = staged.observation_body_digest
          and retry.mismatch_microseconds =
              (extract(epoch from outcome.observed_at - outcome.retrieved_at)
                * 1000000)::bigint
          and retry.reviewed_main_commit_sha = :'reviewed_main_commit_sha'
          and retry.reason_code = 'observation_clock_mismatch_retry_no_credit'
          and (staged.signed_observation #>> '{body,observedAt}')::timestamptz =
              staged.observed_at
          and (staged.signed_observation #>> '{body,facts,retrievedAt}')::timestamptz =
              outcome.retrieved_at
          and staged.signed_observation #>> '{body,facts,lookupOutcome}' = 'found'
          and staged.signed_observation #>> '{body,facts,amountMinor}' = '2500'
          and staged.signed_observation #>> '{body,facts,currencyCode}' = 'ETB'
          and staged.signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
          and staged.signed_observation #>> '{body,facts,receiverMatch}' = 'matched'
          and staged.signed_observation #>> '{body,facts,providerFinalStatus}' = 'completed'
        )
          from exact_retry retry
          cross join exact_outcome outcome
          cross join exact_staged staged)
   and (select pg_catalog.bool_and(
          replacement.observation_clock_retry_source_id = source.id
          and replacement.source_unavailable_retry_source_id is null
          and replacement.payment_provider_id = source.payment_provider_id
          and replacement.candidate_reference_fingerprint =
              source.candidate_reference_fingerprint
          and replacement.candidate_reference_ciphertext =
              source.candidate_reference_ciphertext
          and replacement.proof_status = 'verification_queued'
        )
          from exact_source source cross join exact_replacement replacement)
   and (select pg_catalog.bool_and(
          app.private_telebirr_shadow_observation_clock_retry_is_valid(
            replacement.id,
            retry.retry_request_key
          )
        )
          from exact_retry retry cross join exact_replacement replacement)
   and not exists (
     select 1
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_replacement replacement
         on replacement.id = outcome.shadow_proof_request_id
   )
   and pg_catalog.jsonb_build_object(
         'depositIntents', (select count(*) from app.deposit_intents),
         'paymentClaims', (select count(*) from app.deposit_payment_claims),
         'depositJobs', (select count(*) from app.deposit_jobs),
         'providerEvidence', (select count(*) from app.provider_payment_evidence),
         'executionAttempts', (select count(*) from app.deposit_execution_attempts),
         'reconciliations', (select count(*) from app.execution_reconciliations),
         'privatePilotReservations', (
           select count(*) from app.private_live_deposit_pilot_reservations
         )
       ) = :'no_money_snapshot_before'::jsonb
  as exact_no_money_postcondition
\gset
\if :exact_no_money_postcondition
\else
  \warn 'The observation-clock no-money retry postcondition failed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'telebirr_shadow_observation_clock_retry',
  'deploymentTarget', 'production',
  'retryState', 'armed',
  'financialBoundary', 'dry_run',
  'moneyMoved', false
)::text;

commit;
