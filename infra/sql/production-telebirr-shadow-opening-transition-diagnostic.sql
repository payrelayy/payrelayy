\set ON_ERROR_STOP on
\set QUIET on

begin isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

with assessment_clock as materialized (
  select pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) as assessed_at
), retry_count_state as materialized (
  select least(pg_catalog.count(*)::integer, 2) as retry_count
    from app.private_telebirr_shadow_receipt_cell_opening_retries
), retry_context as materialized (
  select retry.*,
         proof.id as shadow_proof_request_id,
         proof.verification_job_id,
         proof.payment_provider_id,
         proof.candidate_reference_fingerprint,
         proof.proof_status,
         proof.submitted_at,
         proof.not_before,
         proof.expires_at,
         proof.source_live_verification_job_id,
         proof.source_live_proof_id,
         proof.source_pilot_revision_id,
         proof.source_receiver_profile_id,
         proof.recovery_request_key,
         proof.retry_request_key as proof_retry_request_key,
         proof.infrastructure_retry_request_key,
         proof.runtime_retry_request_key
    from app.private_telebirr_shadow_receipt_cell_opening_retries retry
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.reason_code = 'reviewed_receipt_cell_opening_retry_no_credit'
   order by retry.authorized_at desc, proof.id
   limit 1
), lineage_context as materialized (
  select retry.*,
         source_retry.pilot_revision_id as historical_pilot_revision_id,
         source_retry.receiver_profile_id as historical_receiver_profile_id
    from retry_context retry
    join app.private_telebirr_shadow_receipt_cell_binding_retries source_retry
      on source_retry.retry_request_key = retry.source_cell_binding_retry_request_key
    join app.private_telebirr_shadow_proof_requests source_proof
      on source_proof.id = retry.source_shadow_proof_request_id
     and source_proof.verification_job_id = retry.source_shadow_verification_job_id
), validator_shape_state as materialized (
  select coalesce(pg_catalog.bool_and(
           routine.prosecdef
           and routine.proconfig = array['search_path=pg_catalog']::text[]
           and pg_catalog.strpos(
                 routine.prosrc,
                 'app.private_tbirr_cell_binding_retry_history_is_valid'
               ) > 0
           and pg_catalog.strpos(
                 routine.prosrc,
                 'app.private_live_telebirr_shadow_pilot_contract_matches'
               ) > 0
           and pg_catalog.strpos(
                 routine.prosrc,
                 'app.private_live_telebirr_shadow_profile_contract_matches'
               ) > 0
           and pg_catalog.strpos(
                 routine.prosrc,
                 'and pilot.id = source_proof.pilot_revision_id'
               ) = 0
         ), false)
         and pg_catalog.count(*) = 1 as validator_shape_ready
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.private_telebirr_shadow_receipt_cell_opening_retry_child_is_valid(app.private_telebirr_shadow_proof_requests,uuid)'
         )
), validator_component_state as materialized (
  select
    coalesce((
      select app.private_tbirr_cell_binding_retry_history_is_valid(
               lineage.source_shadow_proof_request_id,
               lineage.source_cell_binding_retry_request_key
             )
        from lineage_context lineage
    ), false) as historical_lineage_ready,
    coalesce((
      select app.private_live_telebirr_shadow_pilot_contract_matches(
               lineage.historical_pilot_revision_id,
               lineage.pilot_revision_id
             )
        from lineage_context lineage
    ), false) as pilot_contract_ready,
    coalesce((
      select app.private_live_telebirr_shadow_profile_contract_matches(
               lineage.historical_receiver_profile_id,
               lineage.receiver_profile_id
             )
        from lineage_context lineage
    ), false) as profile_contract_ready,
    coalesce((
      select app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
               lineage.pilot_revision_id,
               lineage.receiver_profile_id,
               lineage.device_enrollment_id,
               lineage.assignment_signer_id,
               clock.assessed_at + interval '5 minutes'
             )
        from lineage_context lineage
       cross join assessment_clock clock
    ), false) as enrollment_authority_ready,
    coalesce((
      select app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
               retry.pilot_revision_id
             )
        from retry_context retry
    ), false) as shadow_boundary_ready,
    coalesce((
      select app.private_telebirr_shadow_receipt_cell_opening_retry_is_valid(
               retry.shadow_proof_request_id,
               retry.retry_request_key
             )
        from retry_context retry
    ), false) as runtime_validator_ready
), proof_state as materialized (
  select
    coalesce((
      select retry.proof_status = 'verification_queued'
         and retry.source_live_verification_job_id is null
         and retry.source_live_proof_id is null
         and retry.source_pilot_revision_id is null
         and retry.source_receiver_profile_id is null
         and retry.recovery_request_key is null
         and retry.proof_retry_request_key is null
         and retry.infrastructure_retry_request_key is null
         and retry.runtime_retry_request_key is null
         and retry.not_before <= clock.assessed_at
         and retry.expires_at = retry.retry_expires_at
         and retry.expires_at > clock.assessed_at + interval '5 minutes'
        from retry_context retry
       cross join assessment_clock clock
    ), false) as child_shape_ready,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_outcomes outcome
        join retry_context retry
          on outcome.shadow_proof_request_id = retry.shadow_proof_request_id
    ), 2) as outcome_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
    ), 101) as quarantine_count,
    least((
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
        join retry_context retry
          on attempt.shadow_proof_request_id = retry.shadow_proof_request_id
         and attempt.verification_job_id = retry.verification_job_id
       where staged.staged_at < retry.expires_at
         and staged.staged_at < attempt.expires_at
         and staged.observed_at >= attempt.issued_at
         and staged.observed_at < attempt.expires_at
         and staged.staged_at >= retry.authorized_at
         and not exists (
           select 1
             from app.private_telebirr_shadow_evidence_quarantine quarantine
            where quarantine.verification_attempt_id = attempt.id
               or quarantine.observation_body_digest = staged.observation_body_digest
         )
    ), 101) as associated_evidence_count
), execution_state as materialized (
  select
    least((
      select pg_catalog.count(*)::integer
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and role.rolcanlogin
    ), 7) as execution_login_role_count,
    least((
      select pg_catalog.count(*)::integer
        from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
         and role.rolpassword is not null
    ), 2) as shadow_runtime_password_count,
    least((
      select pg_catalog.count(*)::integer
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ), 7) as execution_session_count
), money_state as materialized (
  select
    least((select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_reservations), 1) as reservation_count,
    least((select pg_catalog.count(*)::integer
             from app.private_live_telebirr_settlement_receipts), 1) as settlement_receipt_count,
    least((select pg_catalog.count(*)::integer from app.deposit_jobs), 1) as deposit_job_count,
    least((
      select pg_catalog.count(*)::integer
        from app.provider_payment_evidence evidence
        join retry_context retry
          on evidence.payment_provider_id = retry.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             retry.candidate_reference_fingerprint
    ), 1) as provider_evidence_count
), predicate_matrix as materialized (
  select
    session_user = 'postgres' as caller_is_postgres,
    retry_count.retry_count,
    shape.validator_shape_ready,
    component.historical_lineage_ready,
    component.pilot_contract_ready,
    component.profile_contract_ready,
    component.enrollment_authority_ready,
    component.shadow_boundary_ready,
    component.runtime_validator_ready,
    proof.child_shape_ready,
    proof.outcome_count,
    proof.quarantine_count,
    proof.associated_evidence_count,
    execution.execution_login_role_count,
    execution.shadow_runtime_password_count,
    execution.execution_session_count,
    money.reservation_count,
    money.settlement_receipt_count,
    money.deposit_job_count,
    money.provider_evidence_count,
    coalesce((
      select greatest(
               0,
               least(
                 43205,
                 extract(epoch from (pilot.expires_at - clock.assessed_at))::integer
               )
             )
        from app.private_live_deposit_pilot_revisions pilot
        join retry_context retry on retry.pilot_revision_id = pilot.id
       cross join assessment_clock clock
    ), 0) as remaining_seconds
  from retry_count_state retry_count
 cross join validator_shape_state shape
 cross join validator_component_state component
 cross join proof_state proof
 cross join execution_state execution
 cross join money_state money
), result as materialized (
  select predicates.*,
    predicates.historical_lineage_ready
      and predicates.pilot_contract_ready
      and predicates.profile_contract_ready
      and predicates.enrollment_authority_ready
      and predicates.shadow_boundary_ready as manual_validator_components_ready,
    predicates.child_shape_ready
      and predicates.runtime_validator_ready
      and predicates.associated_evidence_count between 1 and 100
      and predicates.outcome_count = 0
      and predicates.quarantine_count = 0 as transition_predicate_ready,
    predicates.execution_login_role_count = 0
      and predicates.shadow_runtime_password_count = 0
      and predicates.execution_session_count = 0
      and predicates.reservation_count = 0
      and predicates.settlement_receipt_count = 0
      and predicates.deposit_job_count = 0
      and predicates.provider_evidence_count = 0 as no_money_state_ready
  from predicate_matrix predicates
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'shadow_opening_transition_diagnostic',
  'deploymentTarget', 'production',
  'noWrite', true,
  'rolledBack', true,
  'shareLocksOnly', true,
  'identifiersRedacted', true,
  'callerIsPostgres', result.caller_is_postgres,
  'retryCount', result.retry_count,
  'validatorShapeReady', result.validator_shape_ready,
  'historicalLineageReady', result.historical_lineage_ready,
  'pilotContractReady', result.pilot_contract_ready,
  'profileContractReady', result.profile_contract_ready,
  'enrollmentAuthorityReady', result.enrollment_authority_ready,
  'shadowBoundaryReady', result.shadow_boundary_ready,
  'runtimeValidatorReady', result.runtime_validator_ready,
  'manualValidatorComponentsReady', result.manual_validator_components_ready,
  'childShapeReady', result.child_shape_ready,
  'associatedEvidenceCount', result.associated_evidence_count,
  'outcomeCount', result.outcome_count,
  'quarantineCount', result.quarantine_count,
  'transitionPredicateReady', result.transition_predicate_ready,
  'executionLoginRoleCount', result.execution_login_role_count,
  'shadowRuntimePasswordCount', result.shadow_runtime_password_count,
  'executionSessionCount', result.execution_session_count,
  'reservationCount', result.reservation_count,
  'settlementReceiptCount', result.settlement_receipt_count,
  'depositJobCount', result.deposit_job_count,
  'providerEvidenceCount', result.provider_evidence_count,
  'remainingSeconds', result.remaining_seconds,
  'noMoneyStateReady', result.no_money_state_ready,
  'allReady',
    result.caller_is_postgres
    and result.retry_count = 1
    and result.validator_shape_ready
    and result.transition_predicate_ready
    and result.no_money_state_ready
    and result.remaining_seconds > 3600,
  'moneyMoved', false
)::text
  from result;

rollback;
