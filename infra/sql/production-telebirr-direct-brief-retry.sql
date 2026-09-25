\set ON_ERROR_STOP on
\set QUIET on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The exact production target was not confirmed.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '30s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '30s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The exact production administrator identity was not confirmed.'
  select 1 / 0 as rejected;
\endif

with assessed as materialized (
  select pg_catalog.clock_timestamp() as at_time
), pilot as materialized (
  select candidate.*
    from app.private_live_deposit_pilot_revisions candidate
    cross join assessed
   where candidate.status = 'armed'
     and candidate.expires_at = candidate.active_from + interval '12 hours'
     and candidate.expires_at > assessed.at_time + interval '1 hour'
), source as materialized (
  select proof.id, proof.pilot_revision_id, proof.payment_provider_id,
         proof.candidate_reference_fingerprint
    from app.private_telebirr_shadow_proof_requests proof
    join pilot on pilot.id = proof.pilot_revision_id
    cross join assessed
   where proof.submitted_at < assessed.at_time
     and proof.submitted_at + interval '12 hours' >
         assessed.at_time + interval '1 hour'
     and app.private_telebirr_direct_brief_source_is_valid(proof.id)
     and not exists (
       select 1
         from app.private_telebirr_shadow_source_unavailable_retries retry
        where retry.source_shadow_proof_request_id = proof.id
     )
), ready_phone as materialized (
  select enrollment.id
    from app.private_live_telebirr_device_enrollments enrollment
    join pilot on pilot.id = enrollment.pilot_revision_id
    join app.private_live_telebirr_device_heartbeats heartbeat
      on heartbeat.device_enrollment_id = enrollment.id
    cross join assessed
   where enrollment.valid_from <= assessed.at_time
     and enrollment.valid_until > assessed.at_time + interval '1 hour'
     and heartbeat.runtime_state = 'ready'
     and heartbeat.status_code = 'no_assignment'
     and heartbeat.app_version = '0.5.11-evidence-only'
     and heartbeat.last_seen_at > assessed.at_time - interval '5 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= assessed.at_time
     )
), safety as materialized (
  select
    (select pg_catalog.count(*) from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'telebirr_authoritative_verification',
        'withdrawal_collection', 'withdrawal_validation'
      )
        and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb) as disabled_switches,
    (select pg_catalog.count(*) from app.feature_switches feature_switch
      join pilot on true
     where feature_switch.feature_key = 'private_live_deposit_pilot'
       and feature_switch.mode = 'dry_run'
       and feature_switch.settings = pg_catalog.jsonb_build_object(
         'contract_version', 1,
         'pilot_revision_id', pilot.id,
         'configuration_digest', pilot.configuration_digest
       )) as dry_run_switches,
    (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations)
      as reservations,
    (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts)
      as settlements,
    (select pg_catalog.count(*) from app.deposit_intents) as deposit_intents,
    (select pg_catalog.count(*) from app.deposit_payment_claims) as payment_claims,
    (select pg_catalog.count(*) from app.deposit_jobs) as deposit_jobs,
    (select pg_catalog.count(*) from app.provider_payment_evidence evidence
      join source on source.payment_provider_id = evidence.payment_provider_id
       and source.candidate_reference_fingerprint =
           evidence.canonical_reference_fingerprint) as provider_evidence,
    (select pg_catalog.count(*) from app.deposit_execution_attempts)
      as execution_attempts,
    (select pg_catalog.count(*) from app.execution_reconciliations)
      as reconciliations,
    (select pg_catalog.count(*) from app.agent_platform_companion_execution_control control
      where control.singleton and control.control_state = 'disabled')
      as disabled_companion_controls,
    (select pg_catalog.count(*) from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and role.rolcanlogin) as execution_login_roles,
    (select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_telebirr_shadow_verifier',
        'fetanagent_telebirr_shadow_verifier_runtime'
      ) and activity.pid <> pg_catalog.pg_backend_pid()) as execution_sessions,
    case when app.current_private_trusted_telebirr_activation_epoch() is null
      then 0 else 1 end as activation_epochs
)
select (select pg_catalog.count(*) from pilot) = 1
   and (select pg_catalog.count(*) from source) = 1
   and (select pg_catalog.count(*) from ready_phone) = 1
   and (select pg_catalog.count(*) from app.private_telebirr_shadow_source_unavailable_retries retry
         where retry.reason_code = 'reviewed_direct_brief_receipt_retry_no_credit') = 0
   and safety.disabled_switches = 6
   and safety.dry_run_switches = 1
   and safety.reservations = 0
   and safety.settlements = 0
   and safety.deposit_intents = 0
   and safety.payment_claims = 0
   and safety.deposit_jobs = 0
   and safety.provider_evidence = 0
   and safety.execution_attempts = 0
   and safety.reconciliations = 0
   and safety.disabled_companion_controls = 1
   and safety.execution_login_roles = 0
   and safety.execution_sessions = 0
   and safety.activation_epochs = 0 as exact_no_money_source_ready
  from safety
\gset
\if :exact_no_money_source_ready
\else
  \warn 'The exact signed source, phone, pilot, or no-money boundary is unavailable.'
  select 1 / 0 as rejected;
\endif

with pilot as materialized (
  select id from app.private_live_deposit_pilot_revisions where status = 'armed'
), source as materialized (
  select proof.id, proof.pilot_revision_id
    from app.private_telebirr_shadow_proof_requests proof
    join pilot on pilot.id = proof.pilot_revision_id
   where app.private_telebirr_direct_brief_source_is_valid(proof.id)
     and not exists (
       select 1 from app.private_telebirr_shadow_source_unavailable_retries retry
        where retry.source_shadow_proof_request_id = proof.id
     )
)
select source.id::text as exact_source_id,
       source.pilot_revision_id::text as exact_pilot_id,
       pg_catalog.gen_random_uuid()::text as exact_retry_key
  from source
\gset

select pg_catalog.count(*) = 1 and pg_catalog.bool_and(not retried.already_retried)
  as created_once
  from app.retry_private_telebirr_shadow_after_source_unavailable(
    :'exact_source_id'::uuid,
    :'exact_pilot_id'::uuid,
    :'exact_retry_key'::uuid,
    'reviewed_direct_brief_receipt_retry_no_credit'
  ) retried
\gset
\if :created_once
\else
  \warn 'The append-only no-credit child was not created exactly once.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.count(*) = 1
   and pg_catalog.bool_and(
     app.private_telebirr_shadow_source_unavailable_retry_is_valid(
       retry.replacement_shadow_proof_request_id,
       retry.retry_request_key
     )
     and retry.reason_code = 'reviewed_direct_brief_receipt_retry_no_credit'
     and retry.pilot_revision_id = :'exact_pilot_id'::uuid
     and retry.source_shadow_proof_request_id = :'exact_source_id'::uuid
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id =
              retry.replacement_shadow_proof_request_id
     )
   )
   and (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations) = 0
   and (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts) = 0
   and (select pg_catalog.count(*) from app.deposit_intents) = 0
   and (select pg_catalog.count(*) from app.deposit_payment_claims) = 0
   and (select pg_catalog.count(*) from app.deposit_jobs) = 0
   and (select pg_catalog.count(*) from app.provider_payment_evidence) = 0
   and (select pg_catalog.count(*) from app.deposit_execution_attempts) = 0
   and (select pg_catalog.count(*) from app.execution_reconciliations) = 0
   and (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'cbe_birr_authoritative_verification', 'deposit_execution',
           'payment_verification', 'telebirr_authoritative_verification',
           'withdrawal_collection', 'withdrawal_validation'
         )
           and feature_switch.mode = 'disabled'
           and feature_switch.settings = '{}'::jsonb) = 6
  as exact_no_money_child_ready
  from app.private_telebirr_shadow_source_unavailable_retries retry
 where retry.retry_request_key = :'exact_retry_key'::uuid
\gset
\if :exact_no_money_child_ready
\else
  \warn 'The immutable child or post-transition no-money boundary failed.'
  select 1 / 0 as rejected;
\endif

commit;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'telebirr_direct_brief_retry',
  'childCreated', true,
  'financialBoundary', 'dry_run',
  'moneyMoved', false
)::text;
