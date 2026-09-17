\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH
\getenv network_binding_recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY
\getenv source_document_recovery_request_key SOURCE_DOCUMENT_RECOVERY_REQUEST_KEY
\getenv reviewed_main_commit_sha REVIEWED_MAIN_COMMIT_SHA

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'reviewed_main_commit_sha' ~ '^[0-9a-f]{40}$'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'network_binding_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'source_document_recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_recovery_contract
\gset
\if :exact_recovery_contract
\else
  \warn 'The exact live TeleBirr source-document recovery contract is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '45s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '45s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

with source_binding_guard as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.enforce_private_live_telebirr_source_document_binding()'
   )
), settlement_guard as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.register_private_live_telebirr_settlement_document()'
   )
), mutation_guard as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.reject_private_live_telebirr_network_retry_mutation()'
   )
), recovery_digest as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.private_live_telebirr_source_document_retry_digest(uuid,uuid,uuid,bigint,text,timestamptz,timestamptz,timestamptz,text)'
   )
), recovery_function as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.recover_private_live_telebirr_source_document_collision(uuid,uuid,bigint,uuid,text)'
   )
)
select (select count(*) from supabase_migrations.schema_migrations migration
         where migration.version = '20260918021500') = 1
   and (select count(*) from supabase_migrations.schema_migrations migration
         where migration.version = '20260918023000') = 1
   and (select count(*) from source_binding_guard) = 1
   and (select count(*) from settlement_guard) = 1
   and (select count(*) from mutation_guard) = 1
   and (select count(*) from recovery_digest) = 1
   and (select count(*) from recovery_function) = 1
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'
                ), 'hex'
              ) = 'cf004b38b587d4a3894217d1db721af3a6217481a791297f35a0017f3a888a4f'
        ) from source_binding_guard routine)
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'
                ), 'hex'
              ) = '682c4c2347d73fed98cd5839a8a0702dae1fc5714973a437a70015892b84aa6a'
        ) from settlement_guard routine)
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'
                ), 'hex'
              ) = '170a1b727b58b965fe2a935c87c64aed2ff83ac527da2389b1af13597e3ff567'
        ) from mutation_guard routine)
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.provolatile = 'i'
          and routine.pronargs = 9
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'
                ), 'hex'
              ) = 'be5588fd9107174dcf7251e4adeb9f518c508d8ac59fefd78194248013655cbb'
        ) from recovery_digest routine)
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and routine.proretset
          and routine.pronargs = 5
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'
                ), 'hex'
              ) = '0431435bcb3f0ca3e3cd9a3f525a6a5cd6dc2a17a6cbe4a72e750ba858ffc52c'
        ) from recovery_function routine)
  as reviewed_catalog_ready
\gset
\if :reviewed_catalog_ready
\else
  \warn 'The reviewed live TeleBirr source-document recovery catalog does not match.'
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
   and (
     job.source_document_retry_request_key is null
     or job.source_document_retry_request_key =
        :'source_document_recovery_request_key'::uuid
   )
\gset target_
\if :target_exact_target_ready
\else
  \warn 'Exactly one live TeleBirr source-document recovery target was not found.'
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
          from app.deposit_jobs deposit_job
          join app.private_live_telebirr_settlement_receipts receipt
            on receipt.execution_job_id = deposit_job.id
          join app.private_live_telebirr_verification_outcomes outcome
            on outcome.id = receipt.verification_outcome_id
         where outcome.verification_job_id = :'target_verification_job_id'::uuid)
         as execution_jobs
\gset before_

select recovered.*
  from app.recover_private_live_telebirr_source_document_collision(
    :'target_verification_job_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'target_activation_epoch'::bigint,
    :'source_document_recovery_request_key'::uuid,
    'source_document_digest_collision'
  ) recovered
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
            from app.deposit_jobs deposit_job
            join app.private_live_telebirr_settlement_receipts receipt
              on receipt.execution_job_id = deposit_job.id
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
           )) as kemer_sessions
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
  'operation', 'live_telebirr_source_document_recovery',
  'deploymentTarget', 'production',
  'recoveryState', case
    when :'recovery_already_recovered'::boolean then 'replayed'
    else 'armed'
  end,
  'alreadyRecovered', :'recovery_already_recovered'::boolean,
  'remainingSeconds', greatest(0, floor(extract(epoch from (
    :'recovery_recovered_expires_at'::timestamptz - pg_catalog.clock_timestamp()
  )))::integer),
  'financialRowsCreated', not summary.financial_rows_unchanged,
  'kemerBetLoginRoles', summary.kemer_logins,
  'kemerBetSessions', summary.kemer_sessions,
  'executionEnabled', summary.kemer_logins <> 0 or summary.kemer_sessions <> 0
)::text
from summary;

commit;
