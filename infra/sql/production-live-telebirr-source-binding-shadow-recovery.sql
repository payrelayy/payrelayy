\set ON_ERROR_STOP on
\set QUIET on

begin isolation level read committed;

create temp table reviewed_source_binding_shadow_result
on commit drop
as
select *
  from app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(
    'reviewed_source_binding_source_unavailable_recovery_no_credit'
  );

do $validate_redacted_reviewed_source_binding_shadow_result$
begin
  if (select pg_catalog.count(*) from reviewed_source_binding_shadow_result) <> 1
    or not exists (
      select 1
        from reviewed_source_binding_shadow_result result
       where result.shadow_request_count = 1
         and result.configured_window_seconds = 43200
         and result.remaining_seconds between 42601 and 43205
         and not result.money_moved
    ) then
    raise exception 'The redacted reviewed source-binding shadow result is invalid.';
  end if;
end;
$validate_redacted_reviewed_source_binding_shadow_result$;

with exact_recovery as (
  select recovery.*
    from app.private_live_telebirr_source_binding_shadow_recoveries recovery
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = recovery.replacement_shadow_verification_job_id
   where recovery.reason_code =
         'reviewed_source_binding_source_unavailable_recovery_no_credit'
     and proof.proof_status = 'verification_queued'
     and proof.expires_at > pg_catalog.clock_timestamp()
     and app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
           proof.id,
           recovery.recovery_request_key
         )
), source_money as (
  select
    (select pg_catalog.count(*)
       from app.private_live_deposit_pilot_reservations reservation
       join exact_recovery recovery
         on recovery.source_live_proof_id =
            reservation.private_live_deposit_pilot_proof_id) as reservations,
    (select pg_catalog.count(*)
       from app.private_live_telebirr_settlement_receipts receipt
       join exact_recovery recovery
         on recovery.source_live_outcome_id = receipt.verification_outcome_id)
      as settlement_receipts,
    (select pg_catalog.count(*)
       from app.deposit_jobs job
       join app.private_live_telebirr_settlement_receipts receipt
         on receipt.execution_job_id = job.id
       join exact_recovery recovery
         on recovery.source_live_outcome_id = receipt.verification_outcome_id)
      as deposit_jobs
), boundary as (
  select
    (select pg_catalog.count(*)
       from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification',
        'deposit_execution',
        'payment_verification',
        'telebirr_authoritative_verification',
        'withdrawal_collection',
        'withdrawal_validation'
      )
        and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb) as disabled_financial_switches,
    (select pg_catalog.count(*)
       from app.feature_switches feature_switch
       join exact_recovery recovery on true
      where feature_switch.feature_key = 'private_live_deposit_pilot'
        and feature_switch.mode = 'dry_run'
        and feature_switch.settings = pg_catalog.jsonb_build_object(
          'contract_version', 1,
          'pilot_revision_id', recovery.target_pilot_revision_id,
          'configuration_digest', (
            select pilot.configuration_digest
              from app.private_live_deposit_pilot_revisions pilot
             where pilot.id = recovery.target_pilot_revision_id
          )
        )) as dry_run_pilot_switches,
    (select pg_catalog.count(*)
       from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin) as executor_login_roles,
    (select pg_catalog.count(*)
       from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      ) and activity.pid <> pg_catalog.pg_backend_pid()) as executor_sessions,
    case when app.current_private_trusted_telebirr_activation_epoch() is null
      then 0 else 1 end as active_telebirr_epochs
), shadow_state as (
  select
    (select pg_catalog.count(*) from exact_recovery) as recoveries,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_proof_requests proof
       join exact_recovery recovery
         on recovery.replacement_shadow_proof_request_id = proof.id)
      as shadow_requests,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_attempts attempt
       join exact_recovery recovery
         on recovery.replacement_shadow_proof_request_id =
            attempt.shadow_proof_request_id) as shadow_attempts,
    (select pg_catalog.count(*)
       from app.private_telebirr_shadow_verification_outcomes outcome
       join exact_recovery recovery
         on recovery.replacement_shadow_proof_request_id =
            outcome.shadow_proof_request_id) as shadow_outcomes
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'reviewed_source_binding_shadow_recovery',
  'deploymentTarget', 'production',
  'created', result.created,
  'shadowRequestCount', state.shadow_requests,
  'shadowAttemptCount', state.shadow_attempts,
  'shadowOutcomeCount', state.shadow_outcomes,
  'configuredWindowSeconds', result.configured_window_seconds,
  'remainingSeconds', result.remaining_seconds,
  'disabledFinancialSwitches', boundary.disabled_financial_switches,
  'dryRunPilotSwitches', boundary.dry_run_pilot_switches,
  'activeTelebirrEpochs', boundary.active_telebirr_epochs,
  'executorLoginRoles', boundary.executor_login_roles,
  'executorSessions', boundary.executor_sessions,
  'reservations', money.reservations,
  'settlementReceipts', money.settlement_receipts,
  'depositJobs', money.deposit_jobs,
  'moneyMoved', result.money_moved,
  'identifiersRedacted', true
)::text
  from reviewed_source_binding_shadow_result result
 cross join shadow_state state
 cross join boundary
 cross join source_money money;

commit;
