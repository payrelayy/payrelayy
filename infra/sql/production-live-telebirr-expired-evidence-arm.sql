\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_expired_activation_epoch TARGET_EXPIRED_ACTIVATION_EPOCH
\getenv network_binding_recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY
\getenv historical_completion_request_key HISTORICAL_COMPLETION_REQUEST_KEY
\getenv trusted_telebirr_scram_verifier TRUSTED_TELEBIRR_SCRAM_VERIFIER

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_expired_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'network_binding_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'historical_completion_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'trusted_telebirr_scram_verifier'
         ~ '^SCRAM-SHA-256[$]4096:[A-Za-z0-9+/]{22}==[$][A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'
  as exact_arm_contract
\gset
\if :exact_arm_contract
\else
  \warn 'The expired-evidence arm contract is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '45s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as exact_target_ready,
       (pg_catalog.array_agg(job.id))[1] as verification_job_id
  from app.private_live_telebirr_verification_jobs job
 where job.pilot_revision_id = :'target_pilot_revision_id'::uuid
   and job.network_retry_reason_code = 'official_receipt_network_unavailable'
   and job.network_binding_recovery_request_key =
       :'network_binding_recovery_request_key'::uuid
   and job.network_binding_recovery_reason_code =
       'network_retry_reference_binding_registry'
\gset target_
\if :target_exact_target_ready
\else
  \warn 'Exactly one expired live TeleBirr target was not found.'
  select 1 / 0 as rejected;
\endif

select (select count(*)::integer
          from app.private_live_telebirr_verification_outcomes outcome
         where outcome.verification_job_id = :'target_verification_job_id'::uuid)
         as outcomes,
       (select count(*)::integer
          from app.private_live_deposit_pilot_reservations reservation
          join app.private_live_telebirr_verification_jobs job
            on job.private_live_deposit_pilot_proof_id =
               reservation.private_live_deposit_pilot_proof_id
         where job.id = :'target_verification_job_id'::uuid) as reservations,
       (select count(*)::integer
          from app.private_live_telebirr_settlement_receipts receipt
          join app.private_live_telebirr_verification_outcomes outcome
            on outcome.id = receipt.verification_outcome_id
         where outcome.verification_job_id = :'target_verification_job_id'::uuid)
         as settlements,
       (select count(*)::integer
          from app.deposit_jobs execution_job
          join app.private_live_telebirr_settlement_receipts receipt
            on receipt.execution_job_id = execution_job.id
          join app.private_live_telebirr_verification_outcomes outcome
            on outcome.id = receipt.verification_outcome_id
         where outcome.verification_job_id = :'target_verification_job_id'::uuid)
         as execution_jobs
\gset before_

select armed.*
  from app.arm_private_live_telebirr_historical_completion(
    :'target_verification_job_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'target_expired_activation_epoch'::bigint,
    :'historical_completion_request_key'::uuid,
    :'trusted_telebirr_scram_verifier',
    'expired_authority_staged_evidence_completion'
  ) armed
\gset recovery_

\pset format unaligned
\pset tuples_only on
with after_counts as materialized (
  select (select count(*)::integer
            from app.private_live_telebirr_verification_outcomes outcome
           where outcome.verification_job_id = :'target_verification_job_id'::uuid)
           as outcomes,
         (select count(*)::integer
            from app.private_live_deposit_pilot_reservations reservation
            join app.private_live_telebirr_verification_jobs job
              on job.private_live_deposit_pilot_proof_id =
                 reservation.private_live_deposit_pilot_proof_id
           where job.id = :'target_verification_job_id'::uuid) as reservations,
         (select count(*)::integer
            from app.private_live_telebirr_settlement_receipts receipt
            join app.private_live_telebirr_verification_outcomes outcome
              on outcome.id = receipt.verification_outcome_id
           where outcome.verification_job_id = :'target_verification_job_id'::uuid)
           as settlements,
         (select count(*)::integer
            from app.deposit_jobs execution_job
            join app.private_live_telebirr_settlement_receipts receipt
              on receipt.execution_job_id = execution_job.id
            join app.private_live_telebirr_verification_outcomes outcome
              on outcome.id = receipt.verification_outcome_id
           where outcome.verification_job_id = :'target_verification_job_id'::uuid)
           as execution_jobs
), runtime as materialized (
  select (select count(*)::integer from pg_catalog.pg_roles role
           where role.rolname in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           ) and role.rolcanlogin) as kemer_logins,
         (select count(*)::integer from pg_catalog.pg_stat_activity activity
           where activity.usename in (
             'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
           )) as kemer_sessions,
         (select count(*)::integer from pg_catalog.pg_authid role
           where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
             and role.rolcanlogin
             and role.rolvaliduntil is not distinct from
                 :'recovery_expires_at'::timestamptz
             and role.rolpassword is not distinct from
                 :'trusted_telebirr_scram_verifier') as bounded_verifier_logins
), summary as materialized (
  select after_counts.*,
         :'before_outcomes'::integer = after_counts.outcomes
           and :'before_reservations'::integer = after_counts.reservations
           and :'before_settlements'::integer = after_counts.settlements
           and :'before_execution_jobs'::integer = after_counts.execution_jobs
           as financial_rows_unchanged,
         runtime.*
    from after_counts
    cross join runtime
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_expired_evidence_arm',
  'deploymentTarget', 'production',
  'recoveryState', case when :'recovery_already_armed'::boolean
    then 'replayed' else 'armed' end,
  'alreadyArmed', :'recovery_already_armed'::boolean,
  'remainingSeconds', greatest(0, floor(extract(epoch from (
    :'recovery_expires_at'::timestamptz - pg_catalog.clock_timestamp()
  )))::integer),
  'verifierLoginBounded', summary.bounded_verifier_logins = 1,
  'financialRowsCreated', not summary.financial_rows_unchanged,
  'kemerBetLoginRoles', summary.kemer_logins,
  'kemerBetSessions', summary.kemer_sessions,
  'executionEnabled', summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
)::text
from summary;

commit;
