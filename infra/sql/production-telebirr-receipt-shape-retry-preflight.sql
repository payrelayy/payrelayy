\set ON_ERROR_STOP on
\set QUIET on

-- The reviewed lineage helper takes SELECT FOR SHARE internally; keep the query no-write
-- and roll back the transaction instead of using PostgreSQL's read-only transaction mode.
begin isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

with assessed as materialized (
  select pg_catalog.clock_timestamp() as at_time
), source_count as materialized (
  select pg_catalog.count(*)::integer as opening_retries
    from app.private_telebirr_shadow_receipt_cell_opening_retries
), source as materialized (
  select opening.retry_request_key,
         opening.pilot_revision_id,
         opening.receiver_profile_id,
         opening.device_enrollment_id,
         opening.assignment_signer_id,
         opening.reason_code as opening_reason,
         proof.id as proof_id,
         proof.verification_job_id,
         proof.payment_provider_id,
         proof.candidate_reference_fingerprint,
         proof.proof_status,
         outcome.id as outcome_id,
         outcome.verification_job_id as outcome_job_id,
         outcome.protocol_disposition,
         outcome.protocol_reason_code,
         outcome.disposition,
         outcome.reason_code as outcome_reason,
         outcome.principal_amount_minor,
         outcome.occurred_at,
         outcome.receiver_identity_digest,
         outcome.observation_body_digest
    from app.private_telebirr_shadow_receipt_cell_opening_retries opening
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = opening.replacement_shadow_proof_request_id
     and proof.verification_job_id = opening.replacement_shadow_verification_job_id
    left join app.private_telebirr_shadow_verification_outcomes outcome
      on outcome.shadow_proof_request_id = proof.id
   where (select opening_retries from source_count) = 1
), source_facts as materialized (
  select (select opening_retries from source_count) as opening_retries,
         (select pg_catalog.count(*)::integer
            from app.private_telebirr_shadow_receipt_shape_diag_retries) as diagnostic_retries,
         (select pg_catalog.count(*)::integer from source) as source_rows,
         (select pg_catalog.count(*)::integer
            from app.private_telebirr_shadow_verification_attempts attempt
            join source on source.proof_id = attempt.shadow_proof_request_id) as attempts,
         (select pg_catalog.count(*)::integer
            from app.private_telebirr_shadow_device_evidence_staging staged
            join app.private_telebirr_shadow_verification_attempts attempt
              on attempt.id = staged.verification_attempt_id
            join source on source.proof_id = attempt.shadow_proof_request_id) as staged,
         (select pg_catalog.count(*)::integer
            from app.private_telebirr_shadow_device_evidence_staging staged
            join app.private_telebirr_shadow_verification_attempts attempt
              on attempt.id = staged.verification_attempt_id
            join source on source.proof_id = attempt.shadow_proof_request_id
           where staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
                 'unknown_layout_invoice_number') as invoice_reviews,
         (select pg_catalog.count(*)::integer
            from app.private_telebirr_shadow_verification_outcomes outcome
            join source on source.proof_id = outcome.shadow_proof_request_id) as outcomes,
         coalesce((select source.opening_reason =
                   'reviewed_receipt_cell_opening_retry_no_credit'
                   and source.proof_status = 'verification_queued'
                   and source.outcome_id is not null
                   and source.outcome_job_id = source.verification_job_id
                   and source.protocol_disposition = 'would_review'
                   and source.protocol_reason_code = 'receipt_requires_review'
                   and source.disposition = 'review_required'
                   and source.outcome_reason = 'parser_uncertain'
                   and source.principal_amount_minor is null
                   and source.occurred_at is null
                   and source.receiver_identity_digest is null
                   from source), false) as outcome_shape_ready,
         coalesce((select exists (
                   select 1
                     from app.private_telebirr_shadow_device_evidence_staging staged
                     join app.private_telebirr_shadow_verification_attempts attempt
                       on attempt.id = staged.verification_attempt_id
                    where attempt.shadow_proof_request_id = source.proof_id
                      and staged.observation_body_digest = source.observation_body_digest
                      and staged.signed_observation -> 'body' -> 'facts' ->> 'reviewReason' =
                          'unknown_layout_invoice_number'
                 ) from source), false) as terminal_observation_bound,
         coalesce((select app.private_telebirr_shadow_receipt_cell_opening_retry_is_valid(
                   source.proof_id, source.retry_request_key
                 ) from source), false) as opening_lineage_valid,
         coalesce((select pilot.status = 'armed'
                   and pilot.expires_at = pilot.active_from + interval '12 hours'
                   and pilot.expires_at > assessed.at_time + interval '1 hour'
                   from source
                   join app.private_live_deposit_pilot_revisions pilot
                     on pilot.id = source.pilot_revision_id
                   cross join assessed), false) as pilot_fresh,
         coalesce((select greatest(0, extract(epoch from (
                   pilot.expires_at - assessed.at_time
                 ))::integer)
                   from source
                   join app.private_live_deposit_pilot_revisions pilot
                     on pilot.id = source.pilot_revision_id
                   cross join assessed), 0) as pilot_remaining_seconds,
         coalesce((select exists (
                   select 1 from app.private_live_telebirr_device_heartbeats heartbeat
                    where heartbeat.device_enrollment_id = source.device_enrollment_id
                      and heartbeat.runtime_state = 'ready'
                      and heartbeat.status_code = 'no_assignment'
                      and heartbeat.app_version = '0.5.9-evidence-only'
                      and heartbeat.last_seen_at > assessed.at_time - interval '5 minutes'
                 ) from source cross join assessed), false) as recent_ready_heartbeat
), safety as materialized (
  select (select pg_catalog.count(*)::integer from app.feature_switches switch_state
           where switch_state.feature_key in (
             'cbe_birr_authoritative_verification', 'deposit_execution',
             'payment_verification', 'telebirr_authoritative_verification',
             'withdrawal_collection', 'withdrawal_validation'
           ) and switch_state.mode = 'disabled'
             and switch_state.settings = '{}'::jsonb) as disabled_financial_switches,
         (select pg_catalog.count(*)::integer from app.feature_switches switch_state
            join source on true
            join app.private_live_deposit_pilot_revisions pilot
              on pilot.id = source.pilot_revision_id
           where switch_state.feature_key = 'private_live_deposit_pilot'
             and switch_state.mode = 'dry_run'
             and switch_state.settings = pg_catalog.jsonb_build_object(
               'contract_version', 1, 'pilot_revision_id', pilot.id,
               'configuration_digest', pilot.configuration_digest
             )) as dry_run_switches,
         (select pg_catalog.count(*)::integer
            from app.private_live_deposit_pilot_reservations) as reservations,
         (select pg_catalog.count(*)::integer
            from app.private_live_telebirr_settlement_receipts) as settlements,
         (select pg_catalog.count(*)::integer from app.deposit_jobs) as deposit_jobs,
         (select pg_catalog.count(*)::integer
            from app.provider_payment_evidence evidence
            join source on source.payment_provider_id = evidence.payment_provider_id
             and source.candidate_reference_fingerprint =
                 evidence.canonical_reference_fingerprint) as provider_evidence,
         (select pg_catalog.count(*)::integer from pg_catalog.pg_roles role
           where role.rolname in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
             'fetanagent_trusted_telebirr_verifier',
             'fetanagent_trusted_telebirr_verifier_runtime',
             'fetanagent_telebirr_shadow_verifier',
             'fetanagent_telebirr_shadow_verifier_runtime'
           ) and role.rolcanlogin) as execution_login_roles,
         (select pg_catalog.count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
             'fetanagent_trusted_telebirr_verifier',
             'fetanagent_trusted_telebirr_verifier_runtime',
             'fetanagent_telebirr_shadow_verifier',
             'fetanagent_telebirr_shadow_verifier_runtime'
           ) and activity.pid <> pg_catalog.pg_backend_pid()) as execution_sessions,
         (select pg_catalog.count(*)::integer
            from app.agent_platform_companion_execution_control control
           where control.singleton and control.control_state = 'disabled')
           as disabled_companion_controls,
         case when app.current_private_trusted_telebirr_activation_epoch() is null
           then 0 else 1 end as active_activation_epochs
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'receipt_shape_retry_preflight',
  'noWrite', true,
  'rolledBack', true,
  'identifiersRedacted', true,
  'openingRetryCount', source_facts.opening_retries,
  'diagnosticRetryCount', source_facts.diagnostic_retries,
  'sourceRowCount', source_facts.source_rows,
  'attemptCount', source_facts.attempts,
  'stagedCount', source_facts.staged,
  'invoiceReviewCount', source_facts.invoice_reviews,
  'outcomeCount', source_facts.outcomes,
  'outcomeShapeReady', source_facts.outcome_shape_ready,
  'terminalObservationBound', source_facts.terminal_observation_bound,
  'openingLineageValid', source_facts.opening_lineage_valid,
  'pilotFresh', source_facts.pilot_fresh,
  'pilotRemainingSeconds', source_facts.pilot_remaining_seconds,
  'recentReadyHeartbeat', source_facts.recent_ready_heartbeat,
  'disabledFinancialSwitches', safety.disabled_financial_switches,
  'dryRunSwitches', safety.dry_run_switches,
  'reservations', safety.reservations,
  'settlements', safety.settlements,
  'depositJobs', safety.deposit_jobs,
  'providerEvidence', safety.provider_evidence,
  'executionLoginRoles', safety.execution_login_roles,
  'executionSessions', safety.execution_sessions,
  'disabledCompanionControls', safety.disabled_companion_controls,
  'activeActivationEpochs', safety.active_activation_epochs
)::text
  from source_facts cross join safety;

rollback;
