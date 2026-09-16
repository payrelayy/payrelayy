\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv source_shadow_proof_request_id SOURCE_SHADOW_PROOF_REQUEST_ID
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv retry_request_key SOURCE_UNAVAILABLE_RETRY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The workflow-supplied production project assertion is missing or incorrect.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
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
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The exact source-unavailable retry identifiers are invalid.'
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
  from app.retry_private_telebirr_shadow_after_source_unavailable(
    :'source_shadow_proof_request_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'retry_request_key'::uuid,
    'source_unavailable_review_retry_no_credit'
  )
\gset
\if :retry_transition_ready
\else
  \warn 'The source-unavailable no-money retry transition did not complete.'
  select 1 / 0 as rejected;
\endif

with exact_retry as materialized (
  select retry.*
    from app.private_telebirr_shadow_source_unavailable_retries retry
   where retry.retry_request_key = :'retry_request_key'::uuid
     and retry.source_shadow_proof_request_id =
         :'source_shadow_proof_request_id'::uuid
     and retry.pilot_revision_id = :'target_pilot_revision_id'::uuid
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
   and (select count(*) from exact_outcome) = 1
   and (select count(*) from financial_switches) = 6
   and (select count(*) from financial_switches
         where mode = 'disabled' and settings = '{}'::jsonb) = 6
   and (select pg_catalog.bool_and(
          outcome.disposition = 'review_required'
          and outcome.reason_code = 'source_unavailable'
          and outcome.protocol_disposition = 'would_review'
          and outcome.protocol_reason_code = 'receipt_requires_review'
          and not outcome.would_verify
          and outcome.principal_amount_minor is null
          and outcome.occurred_at is null
          and outcome.receiver_identity_digest is null
        ) from exact_outcome outcome)
   and (select pg_catalog.bool_and(
          replacement.source_unavailable_retry_source_id = source.id
          and replacement.payment_provider_id = source.payment_provider_id
          and replacement.candidate_reference_fingerprint =
              source.candidate_reference_fingerprint
          and replacement.candidate_reference_ciphertext =
              source.candidate_reference_ciphertext
          and replacement.proof_status = 'verification_queued'
        )
          from exact_source source cross join exact_replacement replacement)
   and (select pg_catalog.bool_and(
          app.private_telebirr_shadow_source_unavailable_retry_is_valid(
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
  \warn 'The source-unavailable no-money retry postcondition failed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'telebirr_shadow_source_unavailable_retry',
  'deploymentTarget', 'production',
  'retryState', 'armed',
  'financialBoundary', 'dry_run',
  'moneyMoved', false
)::text;

commit;
